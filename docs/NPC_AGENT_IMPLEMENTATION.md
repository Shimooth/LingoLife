# NPC Agent implementation

The runtime follows one invariant: rules own world facts and progression; the language model performs dialogue and reports bounded evidence.

## Player role boundary

The authenticated player always acts as the city's observer or manager; the player never impersonates, possesses, or directly controls an NPC.

- The city snapshot is the observer surface: it presents NPC locations, schedules, activities, states, and discoverable events without changing them.
- Room, chat, resource, and city-management actions are manager interactions performed under the player's own identity.
- An `npc_id` identifies the target of an interaction, never the identity speaking on behalf of the player.
- NPC dialogue and consequential actions remain constrained by persona, runtime state, memories, relationship boundaries, and goals.
- No client action may directly overwrite NPC emotion, memory, relationship, goal, schedule, or event outcome.

## NPC-to-NPC event boundary

NPC-to-NPC relationships and events are a core world-system requirement, not a player role-play mode.

- A world refresh may start or advance an event involving two or more NPCs without player input.
- Participant selection must respect schedules, locations, personas, needs, goals, shared history, and social edges.
- Every participant keeps a separately scoped memory of the shared event; one NPC's interpretation must not be copied blindly to another.
- Outcomes may update directional social edges, participant runtime states, goals, and follow-up event conditions.
- The observer surface exposes discoverable NPC interactions. Manager actions may intervene, but unresolved events must also support autonomous rule-owned outcomes.
- The language model may propose dialogue and bounded semantic evidence; it cannot invent participants, co-location, relationship values, or numeric outcomes.

## Turn pipeline

1. Authenticate, reserve quota, and enforce the idempotency key.
2. Lazily advance the selected NPC's emotion and needs.
3. Load the versioned persona contract, relationship dimensions, goal milestones, today's schedule, active event, player learning profile, recent native chat history, and relevant scoped memories.
4. Choose a dialogue objective from the active event, urgent need, goal milestone, or relationship stage.
5. Run two DeepSeek tasks in parallel:
   - dialogue streams plain English in character;
   - analysis returns constrained English evidence, semantic signals, and conservative memory candidates.
6. Rule engines apply learning evidence, event transitions, daily-capped relationship change, emotion change, goal progression, and slow personality growth.
7. Commit the turn and then persist deduplicated memory, daily summary, and a metadata-only Agent trace.

If either AI task fails, its rule-based equivalent takes over. The trace records the failure type without storing the chat body or API credentials.

## Persistence

Schema creation is incremental and runs at application startup. Existing accounts, messages, character profiles, events, and learning records remain intact.

- `npc_personas`: compiled, versioned behavior contracts.
- `npc_runtime_states`: emotion, needs, growth, and last simulation time.
- `npc_relationships`: familiarity, trust, closeness, and disclosure stage.
- `npc_goals`: rule-owned progress and four milestones.
- `npc_daily_plans`: stable morning, afternoon, and evening activity/location plans.
- `npc_memories` + `npc_memory_fts`: scoped memories, tags, confidence, expiry, access stage, and FTS5 retrieval.
- `conversation_summaries`: compact durable observations grouped by game day.
- `npc_social_edges`: directional familiarity, trust, affinity, tension, and derived status for A → B and B → A independently.
- `npc_social_events`: date-stable multi-NPC events, participant/location facts, management windows, outcomes, and idempotent resolution.
- `agent_turn_traces`: model, versions, memory IDs, latency, fallback, and error type; never message text.

## Player and admin APIs

- `GET /api/v1/npcs/{npc_id}/agent`: life state, relationship, goal, schedule, memories, summaries, and social edges.
- `GET /api/v1/npcs/{npc_id}/memories`: all player-owned memories for that NPC.
- `DELETE /api/v1/npcs/{npc_id}/memories/{memory_id}`: remove an incorrect or unwanted memory.
- `GET /api/v1/world`: daily observer snapshot and lazy NPC social-world refresh; `/city` remains an alias.
- `GET /api/v1/social-events`: observable NPC-to-NPC interactions.
- `POST /api/v1/social-events/{event_id}/intervene`: a bounded manager action for an open high-impact event.
- `GET /api/v1/admin/agent-traces`: metadata-only operational diagnostics.

The room and chat responses include an `agent` snapshot. The city response includes the current time slot, daily schedule, and activity; current map position uses that slot while preserving event-location priority and minimum NPC spacing.

## Evaluation

`backend/content/agent_eval_scenarios.json` defines five reference archetypes. Automated tests cover persona differentiation, disclosure gates, prompt-data isolation, memory scoping and deletion, lazy state bounds, goal progression, schedule-driven city movement, fallback behavior, and backward-compatible database migration.

The social-world suite additionally covers directional relationship updates, participant schedule/location compatibility, separate participant memories, unattended outcomes, player intervention windows, duplicate suppression, deterministic replay, and incremental migration from the earlier affinity-only schema.
