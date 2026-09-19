"""Bounded background selection; network I/O never holds the world/DB lock."""
from copy import deepcopy
from datetime import datetime, timezone
import logging
import threading
import time
from zoneinfo import ZoneInfo

from . import pair_memory
from .db import LifeWorldRevisionConflict

logger = logging.getLogger(__name__)


class PairMemoryService:
    def __init__(self, world, provider, settings):
        self.world, self.db, self.provider, self.settings = world, world.db, provider, settings
        self.active = {}
        self.lock = threading.Lock()

    def register(self, player_id, profiles):
        with self.lock:
            previous = self.active.get(player_id, {})
            self.active[player_id] = {'profiles': deepcopy(profiles), 'seen': time.monotonic(),
                                      'reviewed': previous.get('reviewed', 0)}
            if len(self.active) > 128:
                del self.active[min(self.active, key=lambda key: self.active[key]['seen'])]

    def tick(self):
        with self.lock:
            now = time.monotonic()
            self.active = {key: item for key, item in self.active.items() if now-item['seen'] < 1200}
            due = [key for key, item in self.active.items() if now-item['reviewed'] >= 120]
            if not due:
                return
            player = min(due, key=lambda key: self.active[key]['reviewed'])
            self.active[player]['reviewed'] = now
            profiles = deepcopy(self.active[player]['profiles'])
        try:
            self.process(player, profiles)
        except Exception:
            # No provider bodies, credentials or private memory payloads in logs.
            logger.warning('pair_memory_background_failed')

    def process(self, player, profiles, now=None):
        now = now or datetime.now(timezone.utc)
        state = self.db.get_life_world_state(player)
        if not state:
            return
        epoch = state.get('initialized_at')
        pair_memory.maintain(state, now)
        entries = pair_memory.candidates(state, profiles)
        decisions, source = {}, 'rules'
        if entries:
            key = 'pair-memory-v1:' + pair_memory.identifier(epoch, entries)
            fallback = {'decisions': {item['id']: 'lasting' if float(item['experience'].get('severity') or 0) >= 68 else 'recent' for item in entries}, 'source': 'rules'}
            owner, cached = self.db.expression_claim(player, key, 'pair_memory',
                now.astimezone(ZoneInfo(self.settings.game_timezone)).date().isoformat(), time.time(),
                self.settings.pair_memory_daily_limit, self.settings.pair_memory_global_daily_limit,
                fallback, callable(getattr(self.provider, 'author_pair_memory', None)) and
                getattr(self.provider, 'expression_available', True), budget_kind='pair_memory', reserved_calls=1)
            result = cached
            if owner:
                result = fallback
                try:
                    response = self.provider.author_pair_memory({'candidates': entries})
                    result = {'decisions': pair_memory.validate_decisions(response['script'], entries),
                              'source': 'ai', 'usage': response.get('usage', {})}
                except Exception:
                    logger.warning('pair_memory_selection_fallback')
                if not self.db.expression_finish(player, key, owner, result):
                    return  # reset or expired lease: don't apply a late answer
            if result:
                decisions, source = result['decisions'], result['source']
        # Merge onto the latest state, never overwrite a simulation tick/other
        # participant/management action that happened during the AI request.
        with self.world._lock:
            for _ in range(3):
                current = self.db.get_life_world_state(player)
                if not current or current.get('initialized_at') != epoch:
                    return
                updated = deepcopy(current)
                pair_memory.maintain(updated, now)
                pair_memory.apply_decisions(updated, decisions, now, source)
                if updated == current:
                    return
                updated['revision'] = current['revision'] + 1
                try:
                    self.world._persist(player, updated, current['revision'])
                    return
                except LifeWorldRevisionConflict:
                    continue
