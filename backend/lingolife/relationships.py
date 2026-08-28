"""Deterministic, database-independent rules for resident relationships.

The relationship model deliberately separates three ideas which are easy to
conflate in a life simulation:

* structural bonds are objective facts (housemates, colleagues, relatives);
* directional edges are what one resident currently feels about another;
* pair channels are emergent or explicitly acknowledged states such as
  friendship, rivalry, conflict and romance.

World systems submit immutable :class:`RelationshipEvidence`.  The engine
turns that evidence into bounded directional changes and derived labels.  It
does not call an LLM, read a clock, or persist anything, so the same state and
evidence always produce the same result.
"""

from __future__ import annotations

import copy
import hashlib
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Literal, Mapping, Sequence


Dimension = Literal[
    "familiarity", "affinity", "trust", "respect", "comfort", "tension",
    "resentment", "attraction", "dependency", "fear",
]

DIMENSIONS: tuple[Dimension, ...] = (
    "familiarity", "affinity", "trust", "respect", "comfort", "tension",
    "resentment", "attraction", "dependency", "fear",
)

EvidenceKind = Literal[
    "shared_positive_experience",
    "kept_promise",
    "received_help",
    "support_in_crisis",
    "vulnerability_honored",
    "boundary_respected",
    "boundary_violation",
    "broken_promise",
    "neglect",
    "conflict",
    "hostile_act",
    "betrayal",
    "public_humiliation",
    "apology",
    "restitution",
    "sustained_change",
    "fair_competition",
    "unfair_competition",
    "romantic_interest",
    "romantic_reciprocity",
    "romantic_rejection",
    "respectful_rejection",
    "separation",
    "jealousy_context",
]

EVIDENCE_KINDS = frozenset({
    "shared_positive_experience", "kept_promise", "received_help",
    "support_in_crisis", "vulnerability_honored", "boundary_respected",
    "boundary_violation", "broken_promise", "neglect", "conflict",
    "hostile_act", "betrayal", "public_humiliation", "apology",
    "restitution", "sustained_change", "fair_competition",
    "unfair_competition", "romantic_interest", "romantic_reciprocity",
    "romantic_rejection", "respectful_rejection", "separation",
    "jealousy_context",
})

Intent = Literal["beneficial", "neutral", "careless", "accidental", "hostile", "unknown"]
INTENTS = frozenset({"beneficial", "neutral", "careless", "accidental", "hostile", "unknown"})

FriendshipState = Literal["none", "emerging", "friend", "close_friend", "estranged"]
ConflictState = Literal["none", "friction", "open_conflict", "feud", "truce"]
RivalryState = Literal["none", "friendly", "competitive", "hostile"]
RomanceState = Literal["none", "one_sided_interest", "mutual_interest", "dating", "partner", "separated"]

STRUCTURAL_KINDS = frozenset({"family", "household", "work", "school", "neighbor", "community"})
SCOPED_STRUCTURAL_KINDS = frozenset({"household", "work", "school", "community"})
FAMILY_ROLE_PAIRS = frozenset({
    frozenset({"sibling"}), frozenset({"cousin"}),
    frozenset({"parent", "child"}), frozenset({"guardian", "dependent"}),
})
SYMMETRIC_ROLES = {
    "household": "housemate",
    "neighbor": "neighbor",
    "community": "member",
}

UTC_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _aware(value: datetime, field_name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")
    return value.astimezone(timezone.utc)


def _datetime(value: object, field_name: str) -> datetime:
    if isinstance(value, datetime):
        return _aware(value, field_name)
    if isinstance(value, str):
        try:
            return _aware(datetime.fromisoformat(value.replace("Z", "+00:00")), field_name)
        except ValueError as exc:
            raise ValueError(f"{field_name} must be an ISO datetime") from exc
    raise ValueError(f"{field_name} must be a datetime")


def _bounded_score(value: float) -> int:
    return max(0, min(100, round(value)))


@dataclass(frozen=True)
class Appraisal:
    """A rule-owned subjective interpretation of an objective fact."""

    perceived_intent: Intent = "neutral"
    responsibility: float = 1.0
    fairness: float = 0.0
    confidence: float = 1.0
    boundary_impact: float = 0.0

    def __post_init__(self) -> None:
        if self.perceived_intent not in INTENTS:
            raise ValueError("unsupported perceived_intent")
        if not 0 <= self.responsibility <= 1:
            raise ValueError("responsibility must be between 0 and 1")
        if not -1 <= self.fairness <= 1:
            raise ValueError("fairness must be between -1 and 1")
        if not 0 <= self.confidence <= 1:
            raise ValueError("confidence must be between 0 and 1")
        if not 0 <= self.boundary_impact <= 1:
            raise ValueError("boundary_impact must be between 0 and 1")


@dataclass(frozen=True)
class JealousyContext:
    """A traceable three-person concern; jealousy is intentionally not a score."""

    context_id: str
    owner_id: str
    focus_id: str
    third_party_id: str
    source_event_id: str
    thread_id: str
    intensity: float

    def __post_init__(self) -> None:
        if not all((self.context_id, self.owner_id, self.focus_id, self.third_party_id,
                    self.source_event_id, self.thread_id)):
            raise ValueError("a jealousy context requires ids, a source event and a thread")
        if len({self.owner_id, self.focus_id, self.third_party_id}) != 3:
            raise ValueError("jealousy context participants must be three different residents")
        if not 0 <= self.intensity <= 1:
            raise ValueError("jealousy intensity must be between 0 and 1")


@dataclass(frozen=True)
class RelationshipEvidence:
    """One idempotent appraisal applied to one directional edge."""

    evidence_id: str
    owner_id: str
    target_id: str
    kind: EvidenceKind
    magnitude: float
    occurred_at: datetime
    appraisal: Appraisal = field(default_factory=Appraisal)
    source_event_id: str | None = None
    thread_id: str | None = None
    jealousy: JealousyContext | None = None

    def __post_init__(self) -> None:
        if not self.evidence_id or not self.owner_id or not self.target_id:
            raise ValueError("evidence requires stable and participant ids")
        if self.owner_id == self.target_id:
            raise ValueError("relationship evidence requires two different residents")
        if self.kind not in EVIDENCE_KINDS:
            raise ValueError("unsupported relationship evidence kind")
        if not 0 <= self.magnitude <= 1:
            raise ValueError("evidence magnitude must be between 0 and 1")
        _aware(self.occurred_at, "occurred_at")
        if self.kind == "jealousy_context":
            if self.jealousy is None:
                raise ValueError("jealousy evidence requires a structured context")
            if self.owner_id != self.jealousy.owner_id or self.target_id != self.jealousy.focus_id:
                raise ValueError("jealousy evidence must update owner -> focus")
            if self.source_event_id != self.jealousy.source_event_id or self.thread_id != self.jealousy.thread_id:
                raise ValueError("jealousy evidence must preserve its event and thread provenance")
        elif self.jealousy is not None:
            raise ValueError("a jealousy context is only valid for jealousy_context evidence")


@dataclass(frozen=True)
class StructuralBond:
    bond_id: str
    kind: str
    participant_ids: tuple[str, str]
    roles: Mapping[str, str]
    scope_id: str | None = None
    active: bool = True

    def __post_init__(self) -> None:
        if not self.bond_id:
            raise ValueError("bond_id is required")
        if self.kind not in STRUCTURAL_KINDS:
            raise ValueError("unsupported structural bond kind")
        if len(self.participant_ids) != 2 or len(set(self.participant_ids)) != 2:
            raise ValueError("a structural bond requires two different residents")
        if set(self.roles) != set(self.participant_ids) or not all(str(value).strip() for value in self.roles.values()):
            raise ValueError("structural bond roles must describe both participants")
        if self.kind in SCOPED_STRUCTURAL_KINDS and not self.scope_id:
            raise ValueError(f"{self.kind} bonds require scope_id")
        role_values = frozenset(str(value) for value in self.roles.values())
        if self.kind == "family" and role_values not in FAMILY_ROLE_PAIRS:
            raise ValueError("unsupported family role pairing")
        expected = SYMMETRIC_ROLES.get(self.kind)
        if expected and role_values != {expected}:
            raise ValueError(f"{self.kind} bonds require the {expected!r} role")
        if self.kind == "work" and role_values not in {
            frozenset({"coworker"}), frozenset({"manager", "report"}),
        }:
            raise ValueError("unsupported work role pairing")
        if self.kind == "school" and role_values not in {
            frozenset({"classmate"}), frozenset({"teacher", "student"}),
        }:
            raise ValueError("unsupported school role pairing")


@dataclass
class DirectionalRelationship:
    owner_id: str
    target_id: str
    familiarity: int = 15
    affinity: int = 50
    trust: int = 50
    respect: int = 50
    comfort: int = 35
    tension: int = 5
    resentment: int = 0
    attraction: int = 0
    dependency: int = 0
    fear: int = 0
    labels: set[str] = field(default_factory=lambda: {"stranger"})
    evidence_counts: dict[str, int] = field(default_factory=dict)
    meaningful_days: set[str] = field(default_factory=set)
    last_evidence_at: dict[str, datetime] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.owner_id or not self.target_id or self.owner_id == self.target_id:
            raise ValueError("a directional relationship requires two different residents")
        for dimension in DIMENSIONS:
            value = getattr(self, dimension)
            if not isinstance(value, int) or not 0 <= value <= 100:
                raise ValueError(f"{dimension} must be an integer between 0 and 100")
        if any(count < 0 for count in self.evidence_counts.values()):
            raise ValueError("evidence counts cannot be negative")
        for value in self.last_evidence_at.values():
            _aware(value, "last_evidence_at")

    def scores(self) -> dict[Dimension, int]:
        return {dimension: getattr(self, dimension) for dimension in DIMENSIONS}

    def to_dict(self) -> dict[str, object]:
        value = asdict(self)
        value["labels"] = sorted(self.labels)
        value["meaningful_days"] = sorted(self.meaningful_days)
        value["last_evidence_at"] = {
            key: moment.astimezone(timezone.utc).isoformat()
            for key, moment in self.last_evidence_at.items()
        }
        return value

    @classmethod
    def from_dict(cls, value: Mapping[str, object]) -> "DirectionalRelationship":
        timestamps = value.get("last_evidence_at") or {}
        if not isinstance(timestamps, Mapping):
            raise ValueError("last_evidence_at must be an object")
        owner_id, target_id = str(value["owner_id"]), str(value["target_id"])
        defaults = cls(owner_id, target_id)
        return cls(
            owner_id=owner_id, target_id=target_id,
            **{dimension: int(value.get(dimension, getattr(defaults, dimension)))
               for dimension in DIMENSIONS},
            labels={str(item) for item in value.get("labels", [])},
            evidence_counts={str(key): int(count) for key, count in dict(value.get("evidence_counts") or {}).items()},
            meaningful_days={str(item) for item in value.get("meaningful_days", [])},
            last_evidence_at={str(key): _datetime(moment, "last_evidence_at")
                              for key, moment in timestamps.items()},
        )


@dataclass
class RelationshipChannels:
    friendship: FriendshipState = "none"
    conflict: ConflictState = "none"
    rivalry: RivalryState = "none"
    romance: RomanceState = "none"
    history: set[str] = field(default_factory=set)

    def __post_init__(self) -> None:
        if self.friendship not in {"none", "emerging", "friend", "close_friend", "estranged"}:
            raise ValueError("invalid friendship channel state")
        if self.conflict not in {"none", "friction", "open_conflict", "feud", "truce"}:
            raise ValueError("invalid conflict channel state")
        if self.rivalry not in {"none", "friendly", "competitive", "hostile"}:
            raise ValueError("invalid rivalry channel state")
        if self.romance not in {
            "none", "one_sided_interest", "mutual_interest", "dating", "partner", "separated",
        }:
            raise ValueError("invalid romance channel state")

    @classmethod
    def from_dict(cls, value: Mapping[str, object]) -> "RelationshipChannels":
        return cls(
            friendship=str(value.get("friendship", "none")),  # type: ignore[arg-type]
            conflict=str(value.get("conflict", "none")),  # type: ignore[arg-type]
            rivalry=str(value.get("rivalry", "none")),  # type: ignore[arg-type]
            romance=str(value.get("romance", "none")),  # type: ignore[arg-type]
            history={str(item) for item in value.get("history", [])},
        )


@dataclass
class RelationshipPair:
    resident_a_id: str
    resident_b_id: str
    a_to_b: DirectionalRelationship
    b_to_a: DirectionalRelationship
    channels: RelationshipChannels = field(default_factory=RelationshipChannels)
    structural_bonds: list[StructuralBond] = field(default_factory=list)
    applied_evidence_ids: set[str] = field(default_factory=set)
    applied_transition_ids: set[str] = field(default_factory=set)
    evidence_fingerprints: dict[str, str] = field(default_factory=dict)
    transition_fingerprints: dict[str, str] = field(default_factory=dict)
    last_decayed_at: datetime = UTC_EPOCH

    def __post_init__(self) -> None:
        if not self.resident_a_id or not self.resident_b_id or self.resident_a_id == self.resident_b_id:
            raise ValueError("a relationship pair requires two different residents")
        expected = {
            (self.resident_a_id, self.resident_b_id),
            (self.resident_b_id, self.resident_a_id),
        }
        actual = {
            (self.a_to_b.owner_id, self.a_to_b.target_id),
            (self.b_to_a.owner_id, self.b_to_a.target_id),
        }
        if actual != expected:
            raise ValueError("directional edges do not match their relationship pair")
        self.last_decayed_at = _aware(self.last_decayed_at, "last_decayed_at")

    @classmethod
    def initial(cls, resident_a_id: str, resident_b_id: str,
                at: datetime = UTC_EPOCH) -> "RelationshipPair":
        return cls(
            resident_a_id, resident_b_id,
            DirectionalRelationship(resident_a_id, resident_b_id),
            DirectionalRelationship(resident_b_id, resident_a_id),
            last_decayed_at=_aware(at, "at"),
        )

    @property
    def pair_key(self) -> str:
        return ":".join(sorted((self.resident_a_id, self.resident_b_id)))

    def edge(self, owner_id: str, target_id: str) -> DirectionalRelationship:
        if (owner_id, target_id) == (self.a_to_b.owner_id, self.a_to_b.target_id):
            return self.a_to_b
        if (owner_id, target_id) == (self.b_to_a.owner_id, self.b_to_a.target_id):
            return self.b_to_a
        raise ValueError("evidence participants do not belong to this relationship pair")

    def to_dict(self) -> dict[str, object]:
        return {
            "resident_a_id": self.resident_a_id,
            "resident_b_id": self.resident_b_id,
            "a_to_b": self.a_to_b.to_dict(),
            "b_to_a": self.b_to_a.to_dict(),
            "channels": {
                "friendship": self.channels.friendship,
                "conflict": self.channels.conflict,
                "rivalry": self.channels.rivalry,
                "romance": self.channels.romance,
                "history": sorted(self.channels.history),
            },
            "structural_bonds": [asdict(bond) for bond in self.structural_bonds],
            "applied_evidence_ids": sorted(self.applied_evidence_ids),
            "applied_transition_ids": sorted(self.applied_transition_ids),
            "evidence_fingerprints": dict(sorted(self.evidence_fingerprints.items())),
            "transition_fingerprints": dict(sorted(self.transition_fingerprints.items())),
            "last_decayed_at": self.last_decayed_at.isoformat(),
        }

    @classmethod
    def from_dict(cls, value: Mapping[str, object]) -> "RelationshipPair":
        bonds = []
        for raw in value.get("structural_bonds", []):
            if not isinstance(raw, Mapping):
                raise ValueError("structural bond must be an object")
            participants = tuple(str(item) for item in raw.get("participant_ids", []))
            bonds.append(StructuralBond(
                bond_id=str(raw["bond_id"]), kind=str(raw["kind"]),
                participant_ids=participants,  # type: ignore[arg-type]
                roles={str(key): str(role) for key, role in dict(raw.get("roles") or {}).items()},
                scope_id=str(raw["scope_id"]) if raw.get("scope_id") is not None else None,
                active=bool(raw.get("active", True)),
            ))
        a_to_b = value.get("a_to_b")
        b_to_a = value.get("b_to_a")
        channels = value.get("channels") or {}
        if not isinstance(a_to_b, Mapping) or not isinstance(b_to_a, Mapping) or not isinstance(channels, Mapping):
            raise ValueError("relationship pair directions and channels must be objects")
        return cls(
            resident_a_id=str(value["resident_a_id"]), resident_b_id=str(value["resident_b_id"]),
            a_to_b=DirectionalRelationship.from_dict(a_to_b),
            b_to_a=DirectionalRelationship.from_dict(b_to_a),
            channels=RelationshipChannels.from_dict(channels), structural_bonds=bonds,
            applied_evidence_ids={str(item) for item in value.get("applied_evidence_ids", [])},
            applied_transition_ids={str(item) for item in value.get("applied_transition_ids", [])},
            evidence_fingerprints={str(key): str(item) for key, item in dict(value.get("evidence_fingerprints") or {}).items()},
            transition_fingerprints={str(key): str(item) for key, item in dict(value.get("transition_fingerprints") or {}).items()},
            last_decayed_at=_datetime(value.get("last_decayed_at", UTC_EPOCH), "last_decayed_at"),
        )


@dataclass(frozen=True)
class RelationshipTransition:
    transition_id: str
    channel: Literal["romance", "conflict"]
    to_state: str
    source_event_id: str
    initiated_by: str
    consented_by: frozenset[str] = frozenset()

    def __post_init__(self) -> None:
        if not self.transition_id or not self.source_event_id or not self.initiated_by:
            raise ValueError("an explicit transition requires stable ids and an initiator")
        if self.channel not in {"romance", "conflict"}:
            raise ValueError("unsupported explicit relationship channel")


@dataclass(frozen=True)
class RelationshipUpdate:
    state: RelationshipPair
    applied: bool
    deltas: Mapping[Dimension, int] = field(default_factory=dict)


# Coefficients are semantic effects, not final score deltas.  Appraisal,
# recurrence and available score headroom are applied below.
EVIDENCE_EFFECTS: dict[str, dict[Dimension, float]] = {
    "shared_positive_experience": {"familiarity": .75, "affinity": 1, "comfort": .8, "tension": -.2},
    "kept_promise": {"familiarity": .2, "trust": 1, "respect": .7, "tension": -.2},
    "received_help": {"familiarity": .25, "affinity": .45, "trust": .8, "respect": .35, "comfort": .3},
    "support_in_crisis": {"affinity": .5, "trust": 1.25, "respect": .5, "comfort": .9, "dependency": .35, "tension": -.4},
    "vulnerability_honored": {"trust": 1.1, "comfort": .9, "affinity": .3, "tension": -.25},
    "boundary_respected": {"trust": .6, "respect": .8, "comfort": .7, "tension": -.45},
    "boundary_violation": {"trust": -.85, "respect": -.65, "comfort": -.9, "tension": 1, "resentment": .85, "fear": .2},
    "broken_promise": {"trust": -1, "respect": -.55, "comfort": -.25, "tension": .65, "resentment": .7},
    "neglect": {"affinity": -.25, "trust": -.35, "comfort": -.5, "tension": .35, "resentment": .55},
    "conflict": {"affinity": -.2, "comfort": -.45, "tension": 1, "resentment": .4},
    "hostile_act": {"affinity": -.7, "trust": -.9, "respect": -.8, "comfort": -.8, "tension": 1.15, "resentment": 1.1, "fear": .45},
    "betrayal": {"affinity": -.9, "trust": -1.7, "respect": -1.15, "comfort": -1, "tension": 1, "resentment": 1.5, "fear": .5},
    "public_humiliation": {"affinity": -.7, "trust": -.8, "respect": -1, "comfort": -.9, "tension": 1.1, "resentment": 1.25, "fear": .3},
    "apology": {"trust": .2, "respect": .25, "comfort": .15, "tension": -1, "resentment": -.08},
    "restitution": {"trust": .55, "respect": .55, "comfort": .25, "tension": -.65, "resentment": -.55},
    "sustained_change": {"trust": .85, "respect": .7, "comfort": .4, "tension": -.4, "resentment": -.9},
    "fair_competition": {"familiarity": .25, "affinity": .15, "respect": .8, "tension": .15},
    "unfair_competition": {"affinity": -.35, "trust": -.55, "respect": -.85, "tension": .75, "resentment": .6},
    "romantic_interest": {"familiarity": .15, "affinity": .25, "comfort": .15, "attraction": 1},
    "romantic_reciprocity": {"affinity": .45, "trust": .25, "comfort": .5, "attraction": 1.15},
    "romantic_rejection": {"comfort": -.2, "tension": .2, "attraction": -.8, "dependency": -.15},
    "respectful_rejection": {"trust": .1, "respect": .35, "comfort": -.05, "tension": -.1, "attraction": -.65},
    "separation": {"affinity": -.25, "comfort": -.65, "tension": .45, "resentment": .2, "attraction": -.45, "dependency": -.3},
    "jealousy_context": {"comfort": -.2, "tension": .55, "resentment": .25, "dependency": .35, "fear": .15},
}

HARMFUL_KINDS = frozenset({
    "boundary_violation", "broken_promise", "neglect", "conflict",
    "hostile_act", "betrayal", "public_humiliation", "unfair_competition",
    "romantic_rejection", "separation", "jealousy_context",
})
POSITIVE_SOCIAL_KINDS = frozenset({
    "shared_positive_experience", "kept_promise", "received_help",
    "support_in_crisis", "vulnerability_honored", "boundary_respected",
})
SUPPORT_KINDS = frozenset({"received_help", "support_in_crisis", "vulnerability_honored"})
COMPETITION_KINDS = frozenset({"fair_competition", "unfair_competition"})
ROMANTIC_KINDS = frozenset({"romantic_interest", "romantic_reciprocity"})
REPAIR_KINDS = frozenset({"apology", "restitution", "sustained_change"})

DECAY_RULES: dict[Dimension, tuple[float, float]] = {
    # target, half-life in game days
    "familiarity": (10, 540),
    "affinity": (50, 240),
    "trust": (50, 720),
    "respect": (50, 540),
    "comfort": (35, 150),
    "tension": (0, 3),
    "resentment": (0, 120),
    "attraction": (0, 60),
    "dependency": (0, 90),
    "fear": (0, 14),
}


def _count(edge: DirectionalRelationship, kinds: Sequence[str] | frozenset[str]) -> int:
    return sum(edge.evidence_counts.get(kind, 0) for kind in kinds)


def _latest(pair: RelationshipPair, kinds: frozenset[str]) -> datetime | None:
    values = [edge.last_evidence_at[kind] for edge in (pair.a_to_b, pair.b_to_a)
              for kind in kinds if kind in edge.last_evidence_at]
    return max(values) if values else None


def _fingerprint(value: object) -> str:
    def encode(item: object) -> object:
        if isinstance(item, datetime):
            return _aware(item, "fingerprint datetime").isoformat()
        if isinstance(item, frozenset):
            return sorted(item)
        raise TypeError(f"unsupported relationship fingerprint value: {type(item)!r}")

    payload = json.dumps(asdict(value), default=encode, ensure_ascii=False,
                         sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()


class RelationshipEngine:
    """Apply relationship evidence, decay and explicit transitions."""

    _score_scale = 8.0

    def with_structural_bonds(self, state: RelationshipPair,
                              bonds: Sequence[StructuralBond]) -> RelationshipPair:
        result = copy.deepcopy(state)
        pair_ids = {state.resident_a_id, state.resident_b_id}
        seen: set[tuple[str, str, tuple[tuple[str, str], ...]]] = set()
        for bond in bonds:
            if set(bond.participant_ids) != pair_ids:
                raise ValueError("structural bond participants do not match the relationship pair")
            signature = (bond.kind, bond.scope_id or "", tuple(sorted(bond.roles.items())))
            if bond.active and signature in seen:
                raise ValueError("duplicate active structural bond")
            if bond.active:
                seen.add(signature)
        if result.channels.romance in {"dating", "partner"} and any(
            bond.active and bond.kind == "family" for bond in bonds
        ):
            raise ValueError("an active family bond cannot coexist with a romantic partnership")
        result.structural_bonds = list(copy.deepcopy(bonds))
        return result

    def evidence_from_jealousy(self, context: JealousyContext, occurred_at: datetime,
                                appraisal: Appraisal | None = None) -> RelationshipEvidence:
        return RelationshipEvidence(
            evidence_id=f"jealousy:{context.context_id}:{context.owner_id}:{context.focus_id}",
            owner_id=context.owner_id,
            target_id=context.focus_id,
            kind="jealousy_context",
            magnitude=context.intensity,
            occurred_at=_aware(occurred_at, "occurred_at"),
            appraisal=appraisal or Appraisal(perceived_intent="unknown", responsibility=.5),
            source_event_id=context.source_event_id,
            thread_id=context.thread_id,
            jealousy=context,
        )

    def apply(self, state: RelationshipPair,
              evidence: RelationshipEvidence) -> RelationshipUpdate:
        # Validate participants even on replay so a bad integration cannot hide
        # behind a colliding idempotency key.
        state.edge(evidence.owner_id, evidence.target_id)
        fingerprint = _fingerprint(evidence)
        if evidence.evidence_id in state.applied_evidence_ids:
            previous = state.evidence_fingerprints.get(evidence.evidence_id)
            if previous is not None and previous != fingerprint:
                raise ValueError("evidence id was reused with different content")
            return RelationshipUpdate(copy.deepcopy(state), False, {})

        result = copy.deepcopy(state)
        edge = result.edge(evidence.owner_id, evidence.target_id)
        previous_count = edge.evidence_counts.get(evidence.kind, 0)
        coefficients = EVIDENCE_EFFECTS[evidence.kind]
        appraisal_factor = self._appraisal_factor(evidence)
        # Repeated harm escalates unresolved patterns. Repeated pleasant routine
        # has diminishing novelty rather than farming friendship indefinitely.
        recurrence = (1 + min(.5, previous_count * .12)
                      if evidence.kind in HARMFUL_KINDS
                      else 1 / (1 + previous_count * .06)
                      if evidence.kind in ROMANTIC_KINDS
                      else 1 / (1 + previous_count * .1))
        deltas: dict[Dimension, int] = {}
        for dimension, coefficient in coefficients.items():
            old = getattr(edge, dimension)
            raw = coefficient * evidence.magnitude * evidence.appraisal.confidence
            raw *= appraisal_factor * recurrence * self._score_scale
            if evidence.kind == "boundary_violation":
                raw *= 1 + evidence.appraisal.boundary_impact * .5
            headroom = ((100 - old) / 100 if raw > 0 else old / 100)
            proposed = raw * max(.15, headroom)
            delta = round(proposed)
            new = _bounded_score(old + delta)
            actual = new - old
            if actual:
                setattr(edge, dimension, new)
                deltas[dimension] = actual

        edge.evidence_counts[evidence.kind] = previous_count + 1
        moment = _aware(evidence.occurred_at, "occurred_at")
        edge.last_evidence_at[evidence.kind] = max(moment, edge.last_evidence_at.get(evidence.kind, UTC_EPOCH))
        if evidence.kind in POSITIVE_SOCIAL_KINDS:
            edge.meaningful_days.add(moment.date().isoformat())
        result.applied_evidence_ids.add(evidence.evidence_id)
        result.evidence_fingerprints[evidence.evidence_id] = fingerprint
        # A harmful act after an agreed truce makes that truce observable as
        # broken even before numeric thresholds reach open conflict again.
        if result.channels.conflict == "truce" and evidence.kind in HARMFUL_KINDS:
            result.channels.conflict = "friction"
        self._derive(result)
        return RelationshipUpdate(result, True, deltas)

    def decay_to(self, state: RelationshipPair, now: datetime) -> RelationshipPair:
        moment = _aware(now, "now")
        if moment <= state.last_decayed_at:
            return copy.deepcopy(state)
        result = copy.deepcopy(state)
        days = (moment - result.last_decayed_at).total_seconds() / 86400
        for edge in (result.a_to_b, result.b_to_a):
            for dimension, (target, half_life) in DECAY_RULES.items():
                effective_half_life = half_life
                if dimension == "resentment" and result.channels.conflict in {
                    "friction", "open_conflict", "feud",
                }:
                    effective_half_life *= 2
                current = getattr(edge, dimension)
                value = target + (current - target) * 2 ** (-days / effective_half_life)
                if dimension == "resentment" and result.channels.conflict == "feud":
                    value = max(50, value)
                setattr(edge, dimension, _bounded_score(value))
        result.last_decayed_at = moment
        self._derive(result)
        return result

    def transition(self, state: RelationshipPair,
                   transition: RelationshipTransition) -> RelationshipUpdate:
        participants = {state.resident_a_id, state.resident_b_id}
        if transition.initiated_by not in participants or not transition.consented_by <= participants:
            raise ValueError("transition participants do not match the relationship pair")
        fingerprint = _fingerprint(transition)
        if transition.transition_id in state.applied_transition_ids:
            previous = state.transition_fingerprints.get(transition.transition_id)
            if previous is not None and previous != fingerprint:
                raise ValueError("transition id was reused with different content")
            return RelationshipUpdate(copy.deepcopy(state), False, {})

        result = copy.deepcopy(state)
        if transition.channel == "romance":
            self._transition_romance(result, transition, participants)
        elif transition.channel == "conflict":
            self._transition_conflict(result, transition, participants)
        result.applied_transition_ids.add(transition.transition_id)
        result.transition_fingerprints[transition.transition_id] = fingerprint
        self._derive(result)
        return RelationshipUpdate(result, True, {})

    def refresh(self, state: RelationshipPair) -> RelationshipPair:
        result = copy.deepcopy(state)
        self._derive(result)
        return result

    @staticmethod
    def _appraisal_factor(evidence: RelationshipEvidence) -> float:
        appraisal = evidence.appraisal
        if evidence.kind in HARMFUL_KINDS:
            intent = {
                "hostile": 1.35, "careless": 1.1, "unknown": .85,
                "neutral": .75, "accidental": .55, "beneficial": .45,
            }[appraisal.perceived_intent]
            responsibility = .35 + .65 * appraisal.responsibility
            fairness = 1 + max(0, -appraisal.fairness) * .25
        else:
            intent = {
                "beneficial": 1.15, "neutral": 1, "unknown": .85,
                "accidental": .75, "careless": .65, "hostile": .45,
            }[appraisal.perceived_intent]
            responsibility = .5 + .5 * appraisal.responsibility
            fairness = 1 + appraisal.fairness * .15
        return max(.1, intent * responsibility * fairness)

    @staticmethod
    def _derive_labels(edge: DirectionalRelationship) -> None:
        previous = set(edge.labels)
        labels: set[str] = set()
        if edge.familiarity >= 25 or ("acquaintance" in previous and edge.familiarity >= 18):
            labels.add("acquaintance")
        else:
            labels.add("stranger")

        positive = _count(edge, POSITIVE_SOCIAL_KINDS)
        support = _count(edge, SUPPORT_KINDS)
        friend_entry = edge.trust >= 58 and edge.affinity >= 58 and edge.comfort >= 50 and positive >= 3
        friend_stay = "friend_like" in previous and edge.trust >= 42 and edge.affinity >= 42 and edge.resentment < 65
        if friend_entry or friend_stay:
            labels.add("friend_like")
        close_entry = friend_entry and edge.trust >= 75 and edge.affinity >= 70 and edge.comfort >= 70 and support >= 2
        close_stay = "close_friend_like" in previous and edge.trust >= 60 and edge.comfort >= 55 and edge.resentment < 55
        if close_entry or close_stay:
            labels.update({"friend_like", "close_friend_like"})

        if edge.tension >= 40 or edge.resentment >= 30 or (
            "strained" in previous and (edge.tension >= 20 or edge.resentment >= 18)
        ):
            labels.add("strained")
        if edge.resentment >= 45 or ("resentful" in previous and edge.resentment >= 28):
            labels.add("resentful")
        intentional_harm = sum(
            count for kind, count in edge.evidence_counts.items()
            if kind in {"hostile_act", "betrayal", "public_humiliation"}
        )
        if (edge.resentment >= 68 and edge.trust <= 25 and intentional_harm >= 2) or (
            "hostile" in previous and edge.resentment >= 50 and edge.trust <= 40
        ):
            labels.add("hostile")
        if edge.fear >= 55 or ("afraid" in previous and edge.fear >= 35):
            labels.add("afraid")
        if edge.dependency >= 65 or ("dependent" in previous and edge.dependency >= 50):
            labels.add("dependent")
        if edge.attraction >= 60 and _count(edge, ROMANTIC_KINDS) >= 1 or (
            "crush" in previous and edge.attraction >= 42
        ):
            labels.add("crush")
        if _count(edge, COMPETITION_KINDS) >= 2:
            labels.add("rivalrous")
        edge.labels = labels

    def _derive(self, state: RelationshipPair) -> None:
        for edge in (state.a_to_b, state.b_to_a):
            self._derive_labels(edge)
        self._derive_conflict(state)
        self._derive_friendship(state)
        self._derive_rivalry(state)
        self._derive_romance_interest(state)

    @staticmethod
    def _derive_conflict(state: RelationshipPair) -> None:
        previous = state.channels.conflict
        edges = (state.a_to_b, state.b_to_a)
        max_tension = max(edge.tension for edge in edges)
        max_resentment = max(edge.resentment for edge in edges)
        harmful = sum(_count(edge, HARMFUL_KINDS) for edge in edges)
        latest_harm = _latest(state, HARMFUL_KINDS)
        recent_harm = bool(latest_harm and
                           (state.last_decayed_at - latest_harm).total_seconds() <= 7 * 86400)
        both_hostile = all("hostile" in edge.labels for edge in edges)
        intentional = sum(
            edge.evidence_counts.get(kind, 0) for edge in edges
            for kind in ("hostile_act", "betrayal", "public_humiliation")
        )
        if previous == "feud":
            value: ConflictState = "feud"  # Only an explicit truce ends a feud.
        elif previous == "truce":
            # Agreement, not passive score movement, owns a truce.  Applying
            # new harmful evidence changes it to friction before derivation.
            value = "truce" if max_tension >= 10 or max_resentment >= 10 else "none"
        elif both_hostile and intentional >= 4:
            value = "feud"
        elif max_tension >= 60 and max_resentment >= 40 or any("hostile" in edge.labels for edge in edges):
            value = "open_conflict"
        elif (max_tension >= 35 or max_resentment >= 25
              or (harmful >= 2 and recent_harm and max_tension >= 18)):
            value = "friction"
        elif previous in {"open_conflict", "friction"} and (max_tension >= 18 or max_resentment >= 15):
            value = "friction"
        else:
            value = "none"
        if value == "feud":
            state.channels.history.add("ever_feuded")
        state.channels.conflict = value

    @staticmethod
    def _derive_friendship(state: RelationshipPair) -> None:
        previous = state.channels.friendship
        edges = (state.a_to_b, state.b_to_a)
        both_close = all("close_friend_like" in edge.labels for edge in edges)
        both_friends = all("friend_like" in edge.labels for edge in edges)
        mild_enough = all(edge.trust >= 42 and edge.affinity >= 42 and edge.resentment < 60 for edge in edges)
        emerging = all(edge.familiarity >= 25 for edge in edges) and all(
            _count(edge, POSITIVE_SOCIAL_KINDS) >= 1 for edge in edges
        )
        if both_close:
            value: FriendshipState = "close_friend"
        elif both_friends:
            value = "friend"
        elif previous == "close_friend" and all(edge.trust >= 60 and edge.comfort >= 55 for edge in edges):
            value = "close_friend"
        elif previous in {"friend", "close_friend"} and mild_enough:
            value = "friend"
        elif "ever_friends" in state.channels.history and not mild_enough:
            value = "estranged"
        elif emerging or (previous == "emerging" and all(edge.familiarity >= 18 for edge in edges)):
            value = "emerging"
        else:
            value = "none"
        if value in {"friend", "close_friend"}:
            state.channels.history.add("ever_friends")
        if value == "close_friend":
            state.channels.history.add("ever_close_friends")
        state.channels.friendship = value

    @staticmethod
    def _derive_rivalry(state: RelationshipPair) -> None:
        edges = (state.a_to_b, state.b_to_a)
        fair = sum(edge.evidence_counts.get("fair_competition", 0) for edge in edges)
        unfair = sum(edge.evidence_counts.get("unfair_competition", 0) for edge in edges)
        latest = _latest(state, COMPETITION_KINDS)
        if latest and (state.last_decayed_at - latest).total_seconds() > 60 * 86400:
            if state.channels.rivalry != "none":
                state.channels.history.add("former_rivals")
            state.channels.rivalry = "none"
            return
        if unfair >= 3 and state.channels.conflict in {"open_conflict", "feud"}:
            value: RivalryState = "hostile"
        elif unfair >= 2:
            value = "competitive"
        elif fair >= 2 and min(edge.respect for edge in edges) >= 55:
            value = "friendly"
        elif fair + unfair >= 2:
            value = "competitive"
        else:
            value = "none"
        if value != "none":
            state.channels.history.add("ever_rivals")
        state.channels.rivalry = value

    @staticmethod
    def _derive_romance_interest(state: RelationshipPair) -> None:
        # Acknowledged relationship states never arise from a score threshold
        # and cannot be overwritten by passive attraction changes.
        if state.channels.romance in {"dating", "partner", "separated"}:
            return
        crushes = ["crush" in edge.labels for edge in (state.a_to_b, state.b_to_a)]
        if all(crushes):
            state.channels.romance = "mutual_interest"
        elif any(crushes):
            state.channels.romance = "one_sided_interest"
        else:
            state.channels.romance = "none"

    @staticmethod
    def _transition_romance(state: RelationshipPair, transition: RelationshipTransition,
                            participants: set[str]) -> None:
        target = transition.to_state
        current = state.channels.romance
        if target not in {"dating", "partner", "separated"}:
            raise ValueError("romance thresholds may only derive interest; acknowledged states require dating, partner or separated")
        if any(bond.active and bond.kind == "family" for bond in state.structural_bonds):
            raise ValueError("family bonds are not romance-eligible")
        if target == "dating":
            if transition.consented_by != participants:
                raise ValueError("dating requires explicit consent from both residents")
            if current not in {"mutual_interest", "separated"}:
                raise ValueError("dating requires mutual interest or an explicit reconciliation")
            if min(state.a_to_b.attraction, state.b_to_a.attraction) < 45:
                raise ValueError("dating requires reciprocal attraction evidence")
            state.channels.romance = "dating"
            state.channels.history.add("ever_dated")
        elif target == "partner":
            if current != "dating" or transition.consented_by != participants:
                raise ValueError("partnership requires dating and explicit mutual consent")
            state.channels.romance = "partner"
            state.channels.history.add("ever_partners")
        else:
            if current not in {"dating", "partner"}:
                raise ValueError("only a dating or partner relationship can separate")
            state.channels.romance = "separated"
            state.channels.history.add("ex_partner")

    @staticmethod
    def _transition_conflict(state: RelationshipPair, transition: RelationshipTransition,
                             participants: set[str]) -> None:
        if transition.to_state != "truce":
            raise ValueError("only an explicit truce is supported on the conflict channel")
        if state.channels.conflict not in {"friction", "open_conflict", "feud"}:
            raise ValueError("a truce requires an active conflict")
        if transition.consented_by != participants:
            raise ValueError("a truce requires both residents' consent")
        if state.channels.conflict == "feud":
            state.channels.history.add("former_enemies")
        state.channels.conflict = "truce"
