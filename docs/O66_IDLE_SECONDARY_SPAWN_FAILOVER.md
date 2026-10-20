# O66 – Idle secondary owned Spawn failover (actual gameplay)

Date: 2026-10-20. Standalone incremental **gameplay** Draft PR on the
unmerged O65 branch (#412). Main remains pinned to
`bc43f2faf1f345e63d9bfe78b6bbaa59e5eaab0c`. No live upload
or activation.

## Reproduced code problem

Until O66, `game/room.state.js` discarded the full
`FIND_MY_SPAWNS` list and kept only `state.spawn = list[0]`.
`game/spawn.manager.js` then immediately returned if the primary
spawn's `spawning` was truthy. In a mature colony with **two or three**
owned spawns, this ignores a second live idle spawn despite urgent
defender, harvester, worker or prespawn workforce demand.

This is a **separate failure mode** from E8N1 incident #369:
historical GET-only data showed E8N1 had a *single* owned spawn; a
single genuinely busy spawn has no idle secondary on which to fail
over. O66 does not claim to recover E8N1 retrospectively or cancel
a stuck spawning job.

## What changes

- `room.state.get()` continues exposing **the original primary
  `state.spawn` unchanged** for older health, economy and recovery
  consumers, and additionally exposes a room-local
  `state.spawns` list from `FIND_MY_SPAWNS`.
- `spawn.manager.selectIdleSpawn(state)` selects the first idle,
  owned, usable spawn **from the same room**. It skips busy,
  inactive, foreign, cross-room or malformed candidates. Legacy
  callers that have not yet supplied `state.spawns` continue using
  the old primary-only state.
- `spawnOne(state)` runs exactly the existing defender-first,
  harvester, hauler, worker, builder, repairer, upgrader and scout
  priority/body/energy policy with the selected idle spawn.
  **Only one** `spawnOne` call occurs per room per tick in
  `room.manager.run`; the code does not issue speculative
  multi-spawn actions in one tick. It does not overdraw room energy
  or invent a second job for an occupied spawn.
- No `cancel`, `renewCreep`, `createConstructionSite`, Game
  memory reset, production auto-deploy, branch activation, or
  external HTTP client is added.
- Existing O65 read-only `spawn.job.stall.shadow` continues to
  monitor stalled jobs without changing gameplay authority.

## Regression cases

`tools/o66-idle-secondary-spawn-failover.test.mjs` constructs
actual room-state snapshots and verifies:

- Busy `Spawn1` with an existing repairer, idle owned
  `Spawn2`, and live hostile => **defender** on Spawn2.
- When Spawn1/Spawn2 are busy, Spawn3 can take the pending job.
- Idle Spawn1 retains original primary priority; one busy Spawn
  cannot be canceled or overruled.
- Foreign, inactive, malformed and cross-room candidate spawns
  are never used; capacity and energy floor remain enforced.
- Existing primary-only caller is backwards compatible.
- `room.manager.run` continues to call `spawnOne` once per
  room rather than running competing spawn writers.

Exact-HEAD CI runs all Node24 tests and original P3; includes the
previous O65 observational module from its parent branch. Gameplay
changes against pinned Main are restricted to
`game/main.js`, `game/room.state.js`,
`game/spawn.job.stall.shadow.js` and `game/spawn.manager.js`.

## Release condition

The original World `LIVE_100T_PASS` for the **exact current Main
commit**, safe global writer coordination and an approved two-phase
World release remain missing. Neither synthetic game tests nor
the two locally verified encrypted historical backup archives are
an authorization to deploy a gameplay change.

**`HOLD_EXACT_PREDECESSOR_PAIR_MISSING`.**
