# Roadmap implementation and acceptance ledger

Audit date: 2026-10-06. Source baseline: `32d6fc2bf96fd05d1cba42ba5cfabd3ff315f235`.
This document accompanies the P0/P1 candidate; it is not a production acceptance receipt.

The complete ultimate-autonomy roadmap is **not finished**. Existing source,
offline tests, shadow observations and authoritative live behavior are different
states. No milestone below is declared fully accepted by this audit. Historical
release evidence remains in CURRENT_STATE.md and docs/verification unchanged.

## Gates that currently block full completion

1. PR #47 exact-main deployment, 25-tick smoke and full 100-tick E4 evidence.
2. PR #48 distinct-critical matching candidate: offline tests passed; separate
   candidate/live acceptance still required. It is independent of this branch.
3. P0/P1 candidate here: offline implementation/tests; real PathFinder CPU and
   route comparison not yet measured. Legacy movement remains authoritative.
4. Domain-by-domain authority migration requires comparison and lifecycle gates
   specified in VNEXT_MIGRATION_MAP.md. Shadow code is not deployed gameplay.
5. This environment has no `tools/screeps.json` or live collector data. No server
   access, deployment, live gate, or target Node 18 verification is claimed.

## Slice inventory

| Slice | Existing implementation / candidate | Still required before acceptance |
|---|---|---|
| U0 release closeout | Recorded historical release evidence | Resolve current exact-head/live candidate gates |
| K0 capabilities | runtime.capabilities, server.profile, feature.registry + fixtures | Continued lifecycle evidence and use by new domain consumers |
| K1 CPU OS | process.scheduler reproduces critical/optional sequencing | Enforced per-process estimates/budgets, resumable planning, bounded state GC, starvation evidence |
| O1 normalized state | colony.state and room.state + fixtures | Complete route/threat/empire facts as domains are implemented |
| E0 requests | request.registry, shadow request producers + lifecycle fixtures | Authoritative producers/executors and cross-domain reservation migration |
| E1 assignment | assignment.shadow + fixtures | Domain-by-domain work execution, fallback and equal-or-better live output |
| O2 assignment evidence | assignment.evidence, durable journal, verifier fixtures | Use comparison evidence to authorize promotion; add policy-outcome comparison beyond assignment |
| E2 capacity spawn | spawn.capacity.shadow + capacity.vector fixtures | Authoritative queue/scheduler and lifecycle comparison |
| E2A pre-spawn | TTL/horizon projection in spawn.capacity.shadow | Live replacement/congestion/remote-route lifecycle coverage |
| E2B body optimizer | body.optimizer + fixtures | Live proposal comparison, operation-backed boost inputs and authority migration |
| E3 logistics graph | request.logistics.shadow + fixtures | Authoritative logistics reservations and execution |
| E4 matching | logistics.matching.shadow/evidence; PR #48 candidate | Exact-main live gate, candidate comparison, movement/executor integration |
| E5 topology | Legacy bootstrap/dedicated hauling only | Measured self-haul/lane/pool/link/terminal mode selection and hysteresis |
| P0 cost field | **This candidate:** path.costs, shared movement profiles and hazards | Real room/CPU comparison; consumers migrate only after acceptance |
| P1 route cache | **This candidate:** path.routes and path.shadow | Real-world multi-room/stuck/hostile lifecycle; legacy executor migration |
| P2 staged planner | Legacy room.planner and offline initial-spawn planner exist | Resumable economic anchors/stamps, capability progression, scored PlannerArtifact |
| P3 Min-Cut | No runtime Min-Cut implementation | Cut-based perimeter, repair/tower/traffic scoring, persistence/migrations |
| I0 intel | world.intel room observations/freshness | Player reputation/strength, route intel, richer topology and lifecycle GC |
| I1 frontier | Legacy adjacent-room scout and world-intel refresh | VOI requests, observer coverage, route/threat-driven frontier assignment |
| I2 remotes | Disabled legacy remote configuration | ROI portfolio, reservations, income/debt, lifecycle and automatic suspension |
| D0 threat | Hostile presence and legacy defense | Boost/body/path/tower-aware ThreatModel and fixtures |
| D1 defense | Legacy towers/defender and optional safe-mode guard | Defense capacity requests, predicted asset-loss recommendation and live validation |
| D2 support | No regional dispatch implementation | Deadline/ETA/provider-cost SupportRequests, donor protection and execution |
| I3 expansion score | Offline initial-spawn scoring is a different tool | Runtime RoomQuality + EmpireFit, freshness, CPU/support budgets |
| I4 expansion operation | No runtime operation implementation | Autonomous parent/claim/bootstrap/spawn/recovery/handoff, retry/failure memory |
| M0 resource ledger | Local energy totals only | Forecast reserves, operation commitments, empire inventory and aid contracts |
| M1 allocation | No empire allocator | Internal transfers vs effective market value; terminal/cooldown/energy budgets |
| M2 specialization | No dynamic specialization | Reversible colony specialization derived from empire needs |
| U10 labs/boosts | Capability observation only | Demand/reaction DAG, reagent allocation, lab execution, boost appointments |
| U10 factory | Capability observation only | Ingredient/value/cooldown planning, logistics, execution and outcome evidence |
| U10 market | Capability observation only | Effective-value decisions, credit/reserve protection, internal alternatives |
| U10 power | Capability observation only | Processing budgets, bank operation/JIT haulers, power creep execution |
| D3 / U11 combat | Legacy local defender only | Body/boost/tower/movement model, valued operations, retreat and settlement |
| U12 adaptation | Existing telemetry/evidence backbone | Prediction/outcome records, comparison policy, bounded tuning with invariant locks |
| Cross-cutting recovery | Legacy bootstrap/emergency ordering | Hysteretic recovery mode, external aid, operation/schema invalidation |
| Cross-cutting persistence | Per-module schema reset conventions | Migration registry, bounded GC, optional segment artifact store, respawn scenarios |

Roadmap identifier note: M2 is used for labs/boosts in the dependency graph and
for specialization in section 15. Those are separate outstanding requirements;
neither is silently omitted or counted twice as a completed milestone.

The current CURRENT_STATE safety policy limits ownership to three rooms. The
future architecture must support capability-based limits without silently
removing that active operator safety policy.

## P0/P1 candidate acceptance

Implemented and offline verified:

- [x] Shared weighted room field: terrain, roads, static/planned obstacles,
      natural obstacles, own/public ramparts, stationary/congestion overlays,
      ranged/melee and keeper avoidance.
- [x] Isolated CostMatrix clones; stable content revisions and movement-profile keys.
- [x] World-route cache plus compact tile-path cache; bounded count/size/TTL,
      schema reset and JSON-restart persistence.
- [x] Unknown/stale/hostile room policy, explicit confidence, restricted room callback.
- [x] Invalidation on obstacle/hazard revisions and STUCK/BLOCKED/HOSTILE feedback.
- [x] Incomplete/invalid paths never treated as successful cached routes.
- [x] Optional OVERFLOW sampling after legacy actions; one source/controller route
      per scheduled run, maxOps limit, CPU-headroom guard, compact status evidence.
- [x] Full local suite, weighted-grid scenario tests and game syntax checks.
- [ ] Node 18 target-runtime validation.
- [ ] Actual Screeps PathFinder behavior/performance on exact deployed head.
- [ ] 25-tick smoke, 100-tick comparison, multi-room and hazard lifecycle evidence.
- [ ] Authority migration into local logistics, scout, remote and combat executors.

Offline fixtures use a weighted-grid reference finder to test matrices, route
policy, cache/lifecycle behavior and integrations. They are not a Screeps server
simulation or evidence of in-game performance. The sampler records candidate
route cost/length; it does not claim predicted-versus-actual transport throughput.

No checkbox in the original roadmap's definition of ultimate autonomy is
promoted to complete solely because a supporting module now exists.
