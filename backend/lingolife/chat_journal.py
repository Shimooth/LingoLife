from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import dataclass
from typing import Sequence

from .events import ActiveEvent, EventEngine, EventTransition, InMemoryEventRepository


class ChatRequestConflict(ValueError):
    """An idempotency key was reused for a different logical request."""


class ChatTurnLeaseLost(RuntimeError):
    """A generator tried to publish after its durable lease was replaced."""


@dataclass(frozen=True)
class ChatTurnClaim:
    state: str
    owner_token: str | None = None
    blocking_key: str | None = None

    @property
    def acquired(self) -> bool:
        return self.state == "acquired"


def request_fingerprint(npc_id: str, message: str) -> str:
    """Canonical identity for one chat command, independent of JSON encoding."""
    payload = json.dumps(
        {"npc_id": npc_id, "message": message},
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def preview_event_advance(
    engine: EventEngine,
    active: ActiveEvent,
    semantic_signals: Sequence[str],
) -> EventTransition:
    """Evaluate a legacy event turn without touching its real repository.

    Chat response generation must be side-effect free until its response and
    outbox are committed together.  The event rules are deterministic after an
    event has been selected, so a private in-memory repository gives us the
    exact transition while deferring persistence to the chat transaction.
    """
    candidate = copy.deepcopy(active)
    repository = InMemoryEventRepository()
    repository.save_active_event(candidate)
    preview = EventEngine(repository, templates=engine.templates)
    return preview.advance(candidate, semantic_signals)
