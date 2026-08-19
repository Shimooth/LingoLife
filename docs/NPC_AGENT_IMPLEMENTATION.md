# NPC Agent implementation

The runtime follows one invariant: rules own world facts and progression; the language model performs dialogue and reports bounded evidence.

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
- `npc_social_edges`: neutral graph skeleton for future NPC-to-NPC events.
- `agent_turn_traces`: model, versions, memory IDs, latency, fallback, and error type; never message text.

## Player and admin APIs

- `GET /api/v1/npcs/{npc_id}/agent`: life state, relationship, goal, schedule, memories, summaries, and social edges.
- `GET /api/v1/npcs/{npc_id}/memories`: all player-owned memories for that NPC.
- `DELETE /api/v1/npcs/{npc_id}/memories/{memory_id}`: remove an incorrect or unwanted memory.
- `GET /api/v1/admin/agent-traces`: metadata-only operational diagnostics.

The room and chat responses include an `agent` snapshot. The city response includes the current time slot, daily schedule, and activity; current map position uses that slot while preserving event-location priority and minimum NPC spacing.

## Evaluation

`backend/content/agent_eval_scenarios.json` defines five reference archetypes. Automated tests cover persona differentiation, disclosure gates, prompt-data isolation, memory scoping and deletion, lazy state bounds, goal progression, schedule-driven city movement, fallback behavior, and backward-compatible database migration.
