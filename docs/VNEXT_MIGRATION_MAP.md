# VNext Migration Map

Stand: 2026-10-04
Purpose: map the current `v0.2.20` architecture into VNext without a risky rewrite.

# 1. Migration strategy

VNext is introduced by **strangler migration**:

```text
current system remains authoritative
→ VNext computes shadow state/decision
→ compare predictions/outcomes
→ switch one domain to VNext authority
→ retain rollback path
→ remove legacy decision logic after stable lifecycle evidence
```

Do not replace the entire runtime at once.

# 2. Current module inventory and target role

| Current module | Current responsibility | VNext destination | Migration action |
|---|---|---|---|
| `game/main.js` | tick orchestration, memory boot, cleanup, status | Kernel scheduler + lifecycle | keep thin; move policy out gradually |
| `game/room.manager.js` | per-room orchestration + policy calls | Colony service/orchestrator | shrink to sequencing and contract wiring |
| `game/room.state.js` | normalized room snapshot | `ColonyState` producer | evolve directly; one of the strongest migration seams |
| `game/economy.model.js` | mining/hauling/productive model | capacity + transport demand model | split demand facts from spawn/population recommendations |
| `game/spawn.manager.js` | desired roles, bodies, spawn priority, TTL hauling replacement | capacity deficit + body optimizer + spawn scheduler | preserve execution path first; move demand generation out |
| `game/energy.js` | acquisition, delivery, consumer requests/guards/reservations | logistics request producer + executor helpers | convert implicit target logic into explicit requests/reservations |
| `game/productive.flow.js` | productive capacity/throughput attribution | prediction/outcome telemetry | keep and generalize as measured-outcome service |
| `game/room.planner.js` | construction placement | staged Planner VNext executor | keep legacy planner while VNext runs shadow candidates |
| `game/colony.health.js` | safety/health scoring | recovery + health policy input | retain as safety input; remove duplicated strategic policy |
| `game/colony.efficiency.js` | utilization/efficiency scoring | adaptation/optimization input | retain; extend prediction error |
| `game/telemetry.journal.js` | durable event evidence | observability backbone | retain and version schemas |
| `game/creep.manager.js` | creep execution dispatch | executor service | preserve; gradually consume assignments instead of role policy |
| role modules | direct behavior by role | executor capability adapters | keep initially; later reduce to action implementations |
| `game/tower.manager.js` | local tower policy | defense executor | keep, then consume `ThreatModel`/defense requests |
| `game/body.builder.js` | body generation | body optimizer primitive | reuse as low-level body construction helper |

# 3. What must not be thrown away

The following current capabilities are strategic assets:

- durable telemetry journal;
- exact deployment/version evidence;
- smoke/live verification tools;
- productive-flow windows;
- health vs efficiency separation;
- capacity-aware hauling math;
- TTL-aware projected hauler capacity;
- current safe spawn/recovery ordering;
- current room-state normalization;
- existing regression fixture suite.

VNext builds around these rather than discarding them.

# 4. Phase A – behavior-neutral foundation

## A1 RuntimeCapabilities

Add new module family:

```text
game/runtime.capabilities.js
game/server.profile.js
```

At first these only observe and report.

No current policy reads them except telemetry.

Acceptance:

- identical gameplay decisions before/after;
- feature probes cannot throw when optional APIs are absent;
- claim-policy evidence can be recorded without initiating claims.

## A2 ColonyState expansion

Extend `room.state.js` to expose the canonical facts needed by VNext:

- active capacity by body/effective capability;
- projected surviving capacity;
- spawn queue/busy projection;
- source/route facts;
- current logistics supply/demand facts;
- threat facts;
- feature/capability view.

Do not add strategic decisions to `room.state.js`.

## A3 Process scheduler shell

`main.js` remains top-level loop, but calls a scheduler that initially reproduces the existing execution order exactly.

Only after equivalence is proven may optional work become sleepable/background.

# 5. Phase B – request shadow layer

## B1 Request registry

Create:

```text
game/request.registry.js
game/reservations.js
```

Initially current systems publish shadow requests:

- `energy.js` publishes consumer delivery requests;
- planner publishes construction work requests;
- controller state publishes upgrade survival request;
- sources publish harvest capacity requests;
- colony health publishes recovery requests.

Legacy execution remains authoritative.

## B2 Compare implicit vs explicit demand

Telemetry records:

```text
legacy target/decision
shadow request(s)
missing/duplicate request
request latency
predicted utility
actual work
```

Gate before authority switch:

- no survival-critical legacy action lacks a corresponding request;
- duplicate demand does not exceed defined tolerance;
- restart reconstructs request registry correctly.

# 6. Phase C – local work assignment

Current `role.worker.js` and productive roles remain action executors.

New assignment engine chooses requests for compatible workers.

Migration sequence:

```text
construction only
→ repair
→ controller upgrade
→ generalized local productive work
```

At each step:

- compare work/tick;
- compare switching count;
- compare travel waste;
- compare controller safety;
- preserve emergency legacy fallback.

# 7. Phase D – spawn migration

`spawn.manager.js` currently combines four concerns:

1. strategic desired composition;
2. projected replacement;
3. body construction;
4. spawn execution.

Split in this order:

```text
economy/defense/recovery requests
→ CapacityDeficit
→ BodyOptimizer
→ SpawnRequest
→ SpawnScheduler
→ existing low-level spawn call
```

The current TTL-aware hauler logic becomes a regression fixture for generalized projected capacity.

Legacy role-count demand stays as fallback until capacity-based demand passes lifecycle gates.

# 8. Phase E – logistics migration

`energy.js` is currently both policy and executor.

Migration:

```text
consumer need calculation
→ explicit LogisticsRequest

source/container availability
→ explicit PICKUP request

hauler selection
→ matching/reservation engine

hauler role
→ execute reserved pickup/delivery
```

The current early-dispatch/consumer-guard incidents become mandatory fixtures:

- sufficient aggregate CARRY but multiple critical consumers;
- one ready guard plus useful partial hauler;
- preserve infrastructure reserve;
- synchronized hauler replacement;
- useful-burst resume;
- fallback/wait attribution by role/request.

# 9. Phase F – planner migration

Keep `room.planner.js` authoritative while creating VNext planner artifacts in shadow mode.

Shadow planner stages:

```text
candidate generation
→ core/economic geometry
→ source/controller paths
→ structure capability plan
→ traffic/logistics score
→ protected asset set
→ Min-Cut
→ towers/ramparts
→ final score
```

Compare legacy vs VNext on:

- total logistics path cost;
- source travel;
- controller supply path;
- extension refill geometry;
- rampart count/repair burden;
- tower minimum damage coverage;
- construction order viability.

Only new colonies should use VNext first. Existing colonies migrate only with a separate migration operation.

# 10. Phase G – intel/remotes

Current scout role becomes an executor for autonomous Scout Requests.

Remote activation no longer comes from static configuration.

Pipeline:

```text
RoomIntel freshness
→ remote candidate
→ route feasibility
→ expected gross income
→ miner/hauler/reserver/repair/risk/CPU cost
→ ROI
→ RemoteAsset state
```

Current source-distance and hauler-capacity math from `economy.model.js` should be reused as the first deterministic transport-cost model.

# 11. Phase H – recovery

`colony.health.js`, spawn safety and current emergency ordering feed a new RECOVERY policy.

Migration rule:

RECOVERY is allowed to preempt VNext optimization.

Recovery requests initially drive the same existing emergency bodies/actions.

Then external `SupportRequest` is added.

# 12. Phase I – defense

`tower.manager.js` stays authoritative initially.

New layers:

```text
hostile observation
→ ThreatModel
→ defense capacity deficit
→ local/remote support request
→ spawn/assignment
→ tower/rampart executor
```

Safe Mode recommendation runs shadow first and must never auto-trigger until validated against historical/fixture attack states.

# 13. Phase J – empire/industry

Introduce in this dependency order:

```text
ResourceReserve / empire ledger
→ terminal internal allocation
→ market
→ labs / boosts
→ factory
→ power
```

Reason: every later system consumes reserve/shadow-price information.

# 14. Migration observability

Every migrated domain records authority:

```text
authority = LEGACY | SHADOW | VNEXT | FALLBACK
```

Every status snapshot should show at least:

- current authority by domain;
- VNext schema versions;
- open/blocked critical requests;
- capacity deficits;
- active operations;
- capability detection state;
- migration errors.

# 15. Rollback rule

A domain switched to VNext must retain a bounded legacy fallback until:

1. offline regression passes;
2. 25-tick smoke passes;
3. at least one 100-tick behavior window passes;
4. relevant lifecycle event is observed or reproduced;
5. no unexplained safety regression remains.

Rollback is domain-local. A logistics problem must not require reverting the planner or intel systems.

# 16. Current-to-VNext high-value reuse

## `room.state.js`

Best direct foundation for `ColonyState`.

## `economy.model.js`

Keep factual route/source/capacity calculations; remove mixed strategic assumptions over time.

## `productive.flow.js`

Promote from release metric into generalized prediction/outcome accounting.

## `colony.health.js`

Promote safety facts into RECOVERY trigger evidence.

## `colony.efficiency.js`

Use as optimization signal only; never survival authority.

## `telemetry.journal.js`

Keep as append-only event backbone and add schema/version metadata.

## live verification tooling

Extend rather than replace. VNext gates should consume the same evidence pipeline.

# 17. First branches after v0.2.20

Recommended branch sequence:

```text
feature/vnext-k0-runtime-capabilities
feature/vnext-o1-colony-state
feature/vnext-k1-process-scheduler
feature/vnext-i0-world-intel
feature/vnext-e0-request-registry-shadow
```

Only the first branch should begin before its direct dependencies are stable.

Parallel work becomes safe after K0 contracts land:

- O1 can build normalized state;
- K1 can build scheduling;
- I0 can build intel freshness;
- test/fixture work can expand independently.

# 18. Definition of successful migration

VNext migration is complete when current role-count and per-role policy code can be removed without changing the bot's strategic behavior contracts.

The final architecture should permit adding a new domain (for example deposits or a new private-server feature) by:

1. capability detection;
2. state/intel producer;
3. request/operation producer;
4. capacity/resource contract;
5. executor;
6. telemetry/gate;

without modifying unrelated creep roles or hardcoding a new server profile.