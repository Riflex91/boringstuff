# P3.1 CPU headroom — 0.3.0-shadow.15-node24 (candidate)

Base: D0.6 merged `main` at `15f0de955167ea052b2ff65a74f04207fedc7ce0`.
Branch: `feature/p3-mincut-cpu-headroom-d0-7`.
Server target: newbieland, code branch chatgpt, room E8N1.

## Read-only D0.6 baseline and risk

User-confirmed D0.6 P3 verification on the *deployed* shadow.14:
post-deployment P3 execution at tick 3811915, verification window
3811915–3812014, isolated scheduler CPU 9.978, min-cut phase 4.701,
8 PASS / 0 WATCH / 0 FAIL. This is close to the existing WATCH
boundary **over 10 CPU**; **over 20 CPU** remains FAIL. The historic
24.19 CPU (tick 3811415) predates the new deployment window and must
not be compared as if measured on the later release.

No later live measurements can be inferred from Node benchmarks.

## Source review and prioritized backlog

| Rank | Subsystem / files | Verified issue or uncertainty | Candidate action / risk |
| --- | --- | --- | --- |
| A1 | `game/defense.mincut.shadow.js` | Grid construction rereads the room terrain accessor, recomputes swamp masks; graph expansion builds string keys for eight neighbors per tile; Dinic allocates BFS queues per phase and unused edge properties | Cache a single terrain view, use dense coordinate indices, trim residual edge objects, reuse BFS queue. Main risk: changed min-cut graph/capacity. Require equality to D0.6 on mixed deterministic fixtures. |
| A2 | `tools/defense-mincut-shadow.test.mjs`, `tools/defense-mincut.bench.mjs` | Existing tests assert safe outcomes, but did not compare solver outputs and repeated latency to D0.6 | Add cache/swamp/queue checks and paired open, swamp, walls, corridor multi-sample benchmarks against exact baseline. No wall-time ratio alone constitutes Screeps CPU proof. |
| B1 | `game/economy.metrics.js`, `game/productive.flow.js`, `tools/live-verification-core.mjs` | Fixed persistent 100-tick accumulation cadence may not align to a release verifier's arbitrary 100-tick window; missing exact-window controller/construction/throughput readings are **unknown**, not zero | Follow-up: build bounded tick-aligned evidence that accounts for reset/RCL transitions and delayed journal delivery; test gaps, offset windows, repeated reports and missing ticks. Never synthesize progress. |
| B2 | `game/logistics.matching.evidence.js`, `game/main.js`, `tools/live-verification-core.mjs` | E4 uses an independent fixed 100-tick window, and STATUS_SNAPSHOT carries only current/lastWindow; mismatched windows produce WATCH | Follow-up: emission plus exact-window provenance (including delayed carrier and scheduler/post-deploy ticks), loss/duplicate tests. Do not award PASS on partial matches. |
| B3 | `game/economy.model.js`, `game/role.hauler.js`, `game/logistics.matching.shadow.js`, `tools/consumer-supply.test.mjs` | Waiting/critical consumers with fallback=0 is genuine pressure despite successfully avoiding self-supply; existing telemetry does not prove reason | Diagnose reservation latency, supply, hauler route times and demand with complete E4/attribution evidence before changing active legacy behavior. |
| C1 | `game/threat.model.shadow.js`, `tools/threat-model-shadow.test.mjs` | Combat-observation WATCH is because armed hostiles were absent; no live combat accuracy is established | Follow-up deterministic fixtures: concurrent ranged/melee/heal, boosted damage/heal, partial PathFinder evidence, terrain/structure changes, ticks-to-impact boundaries. No deliberately induced live combat. |

## P3.1 candidate implementation

- Single getTerrain() view during grid assembly, with observed swamp masks carried into cut-capacity decisions.
- Dense 2500-entry signed coordinate index for flow edges; preserve existing map for legacy projections and breach analysis.
- Same adjacency order, cut cost constants, protected tile limits, residual algorithm, augmentation bounds and score math.
- Compact Dinic residual edges (no unused metadata/originalCap) and reusable queue buffer.
- Preserve graph edgeCount/augmentations, result fields and 0 authority: SHADOW + construction NONE.

## Verification criteria

1. `npm test` passes on **Node 24.21.0** (all existing safety contracts plus new regression tests).
2. `npm run bench:p3` (full Git history required) compares exact plan/graph/cut/score output with the D0.6 SHA on four synthetic rooms. Seven alternating sample batches of ten runs per implementation/fixture; report median Node wall-clock times **without using them as Screeps CPU units**. A noisy benchmark does not establish live CPU headroom.
3. Fresh exact-final-head GitHub Actions run must complete successfully.
4. With user-approved deployment only, collect a new P3 execution on shadow.15 with matching plan tick, scheduler lastRunTick, deployment marker, and new 100-tick verifier window. Compare multiple post-deploy executions/CPU samples and min-cut phase time, not just one lucky sample.
5. Record all remaining General-Live and D0 WATCH independently. No change to legacy authority, D0 CPU <=5, P3 CPU WATCH 10/FAIL 20, D0 PathFinder max 4 searches with maxOps 200, P2/P3/I2 SHADOW, remote disabled, D1 blocked, max three owned rooms.

## Deployment status

NOT DEPLOYED. NOT MERGED. Live CPU improvement UNVERIFIED.
Do not report a PASS on any new release until the operator supplies live verification.
