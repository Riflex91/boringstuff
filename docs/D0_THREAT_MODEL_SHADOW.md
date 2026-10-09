# D0 — bounded threat observation (D0.3 range-aware SHADOW)

This is an incremental D0 implementation, not completion of D0 or of the
Ultimate Autonomous Roadmap. It introduces `threat.model.shadow` after the
authoritative room and creep executors. It cannot issue gameplay intents.

## Implemented

- Active/damaged body and observed boost strength, including effective TOUGH HP.
- Terrain-dependent mobility and carried-resource fatigue.
- Energy/activation-aware tower falloff and nearby hostile healing diagnostics.
- Current-structure access checks, including real ramparts over critical assets.
- Bounded PathFinder work (four searches of at most 200 operations per room).
- Explicit unknown access on unavailable, incomplete or failing path searches.
- A bounded second search through observed destructible barriers when the open
  path is incomplete. Actual route barrier hits determine the reported breach
  time, even when the pathfinder matrix heuristic saturates at 254.
- Piecewise focused-damage integration for attackers with different arrival
  times. The rampart covering an asset is charged once to the attacking group.
- D0.3 estimates mixed ATTACK/WORK and RANGED_ATTACK access as separate close
  (range 1) and ranged (range 3) damage channels. Damage joins only at its
  respective arrival; dual-weapon creeps are counted once in coordinated assets.
  Both channels share the unchanged four-search PathFinder room budget.
- NORMAL/WATCH/ALERT/DEFENSE/EMERGENCY classification.
- Conservative asset-loss horizon and an observational Safe Mode recommendation.
- Compact STATUS_SNAPSHOT evidence and an independent BACKGROUND CPU process.
- No durable D0 cache: recompute from visible state, so ownership changes,
  global resets and schema changes cannot leave stale combat decisions.

The implementation uses Screeps runtime constants and observed BOOSTS. API basis:
https://docs.screeps.com/api/#Creep and https://docs.screeps.com/api/#StructureTower.

## Boundaries before authoritative defense

The loss horizon deliberately assumes no future tower energy, repair or defender
intervention. It is a scenario estimate, not a calibrated probability; therefore
`coreLossProbability` is null. It can overestimate danger. Mixed melee/ranged
bodies now have separate access and arrival times, but their movement and barrier
paths are still independently estimated rather than jointly simulated. Healing and
tower coverage are diagnostics, not a claimed tactical simulation. Tower power
effects and mobile defenders need subsequent combat-model slices. Route breach
durations assume independent attackers; shared route-barrier damage and optimal
route choice are not solved. Such estimates can also overestimate arrival time,
so a breach scenario remains PARTIAL and is not a proven earliest-loss bound.

Truncated observations, unknown boosts, breach estimates and incomplete paths produce PARTIAL,
never a claim that the room is safe. A hostile CLAIM body creates ALERT but is
not modeled as structural damage. An unarmed scout only creates WATCH. No
unbuilt P3 proposal is treated as an existing defense.

Schema 2 retains `breachPaths`, `coordinatedAssets` and `earliestLossTick` in compact
telemetry; the D0.3 change is behavioral/diagnostic without a schema migration. D0 is recomputed rather than persisted, so no Memory clearing or
durable migration is required. Historical schema-1 evidence remains unchanged.

`AUTO_SAFE_MODE`, legacy tower/spawn execution, remote activation and construction
authority remain unchanged. D1 must not treat any D0 SHADOW scenario estimate as
validated authoritative defense requirements.

## Verification

`npm test` includes attack fixtures for boosted attackers, damaged parts, TOUGH,
mobility, tower falloff, protected assets, coordinated arrivals, non-duplicated
barrier cost, uncapped breach HP, mixed-range damage arrival and unique attacker
counting, absent APIs, exhausted search budgets, mutation safety and live-verifier
failure cases.

`npm run verify:d0 -- --start-tick N` requires the exact current deployment
receipt and marker, a complete 100-tick window, current D0 snapshot data,
SHADOW/NONE/LEGACY_UNCHANGED authority, valid contracts and isolated CPU <= 5.
Combat absence is WATCH, not proof of combat performance. Run the general smoke
and live verifiers plus P2/P3/I2 on the same release. Do not relax their gates.

The D0 verifier checks deployment markers from every bot version before selecting
the current release's snapshots. A replacement deployment within the window,
including the starting or final tick, rejects the window. Exact duplicate events
are deduplicated by content; restarting journal sequence numbers cannot hide a
deployment or discard distinct evidence. Foreign-version rows cannot complete
the current release's required evidence window.

## D0.3 release boundary — 0.3.0-shadow.11-node24

D0.2 on `0.3.0-shadow.10-node24` was merged with a complete 100-tick D0
SHADOW observation result `6 PASS / 1 WATCH / 0 FAIL` (armed combat absent).
Its exact general live window was `12 PASS / 7 WATCH / 0 FAIL`; P2, P3 and I2
passed their respective gates. Record:
`docs/verification/d0-2-shadow-live-0.3.0-2026-10-09.md`.

The D0.3 candidate fixes one concrete overstatement in that scenario estimator:
previously, combined melee+ranged DPS was credited already at range 3 if
RANGED_ATTACK existed. RANGED_ATTACK now contributes at range 3, while
ATTACK/WORK-dismantle contribute only after range-1 access is observed or
estimated. Each channel has its own arrival and bounded route-breach estimate.
Both contribute together when genuinely adjacent. A single dual-weapon creep
counts as one attacker, not two; a separate hostile still counts independently.
Range-1 route uncertainty remains `PARTIAL`, not silently `READY`.

This does **not** solve coordinated barrier-breach timing, defender interventions,
terrain-optimal tactical paths, enemy intent forecasting, or combat probability.
No Safe Mode/gameplay intents, persistent migrations, authority transfers or
PathFinder search/operation budget increases are included.

**Live gate reviewed (2026-10-09):** Node 24.21.0 GitHub CI passed.
Smoke `3809946–3809970` was 9/0/0 PASS; general live
`3810001–3810100` was 12/7/0 WATCH; exact D0 window
`3809946–3810045` was 6/1/0 WATCH. P2, P3 and I2 passed the
same D0 100-tick window, each with zero FAIL. The D0 WATCH means no armed
hostile was observed, not that combat forecasts passed. The general-live
seven WATCH outcomes remain as recorded. Original console outputs did not
include the deployment ID or full server module comparison.
Full append-only report:
`docs/verification/d0-3-shadow-live-0.3.0-2026-10-09.md`.
Acceptable as a SHADOW-only incremental live gate with overall WATCH,
**not** as D0 completion or D1 permission. D1 remains blocked.
