# CURRENT STATE — Screeps: World Autonomous Bot

Canonical repository: `Riflex91/boringstuff`

## Canonical source baseline

- Seed baseline: **v0.2.16-node18**
- Current canonical source baseline before this release prep: `29ad209af552f0a20ea50c0e7c8ad4e32a567e05`
- Release candidate identity: **0.3.0-shadow.8-node24**
- Latest VNext live gate: **WATCH — 15 PASS / 3 WATCH / 0 FAIL**
- Local toolchain target: **Node.js 24.21.0**
- Runtime branch: `chatgpt`
- Primary room: `E8N1`
- Primary spawn: `Spawn1`
- Owned-room safety limit: **maximum 3 rooms; never claim a fourth**
- Server reset date: **2027-02-01**
- No in-game chat automation.

This repository was seeded from the verified user-provided archive `screeps-chatgpt-bot-v0.2.16-node18(1).rar` on 2026-10-04. The source files under `game/`, `tools/`, `logs/.gitkeep`, `install.ps1`, and the original `README.md` are the canonical v0.2.16 source snapshot.

The uploaded archive SHA-256 is:

`c7ac196e93dbd451225261b462324a26eec399d4000d1f5df57a815db5542100`

## Verified release history

### v0.2.10 — VERIFIED / CLOSED

- Persistent consumer self-supply until full.
- 300-energy bootstrap harvester `[WORK, WORK, CARRY, MOVE]`.
- Mining scaling and hauler scaling.
- Spawn priority hardening.
- `consumerFallbackCount` telemetry.
- Direct API deployment path.
- Global economy stall fixed.

### v0.2.11 — VERIFIED / CLOSED

Colony Health Layer. Observational only.

Components: economy, logistics, infrastructure, controller, defense, recovery, CPU.

### v0.2.12 — VERIFIED / CLOSED

Colony Efficiency Layer, separate from Health. Observational only.

Statuses: `PENDING`, `EFFICIENT`, `WATCH`, `UNDERUTILIZED`, `INEFFICIENT`.

Pressure: `SURPLUS`, `BALANCED`, `DEMAND`, `UNKNOWN`.

### v0.2.13 — VERIFIED / CLOSED

Durable telemetry journal.

- Server-side Memory journal with monotonic `jseq`.
- Collector offline catch-up.
- Persistent cursor.
- Retention-gap detection.
- Singleton lock with heartbeat / stale-lock recovery.
- Optional Windows autostart.
- `bot.telemetryStatus()` and `bot.telemetry(n)`.
- Catch-up verified live.

### v0.2.14 — VERIFIED / CLOSED

Capacity-based Hauler scaling.

- Planner count-vs-CARRY mismatch identified.
- Temporary extra hauler allowed while CARRY capacity is below requirement.
- Telemetry: `nextHaulerCarryParts`, `haulerCarryDeficit`.
- Live verification reached 3 haulers / 16 CARRY / 12 required / deficit 0 while recommended stable count remained 2.

### v0.2.15 — PARTIAL PASS

Consumer-Supply Targeting.

- Demand-based hauler requests.
- Priority for empty / waiting / fallback consumers and longest wait.
- Delivery reservations prevent dogpile.
- Telemetry: `consumerWaitingCount`, `consumerRequestCount`, `consumerDeliveryReservations`.
- Productive throughput improved by approximately 27% versus v0.2.14.
- Remaining issue: consumers could briefly starve during spawn/extension refill bursts.

### v0.2.16 — VERIFIED / CLOSED

Consumer Starvation Guard.

- With at least two haulers and a critical consumer, exactly one transport-ready hauler prioritizes the consumer.
- Other haulers remain available for spawn/extensions/tower.
- One-hauler survival priority unchanged.
- Telemetry: `consumerCriticalCount`.

Verified live window: ticks `3681001–3681100`.

Observed result:

- `consumerFallbackCount = 0`
- `haulerCarryDeficit = 0`
- Health `96 / HEALTHY`
- Logistics `100`
- Controller progress `+180 / 100 ticks`
- Construction progress `+1300 / 100 ticks`
- Productive throughput `14.8 e/t`
- CPU approximately `3.8`
- Bucket `10000`
- No runtime errors
- Dedicated/theoretical mining `20 e/t`
- 3 haulers / 16 CARRY / 12 required

### v0.2.17 — VERIFIED / CLOSED

Live Verification Harness. Tools/observability only; no colony behavior change.

- `npm run verify:smoke` — 25-tick safety gate.
- `npm run verify:live` — complete 100-tick performance gate.
- Timestamp-aware multiline error parsing separates bot/runtime failures from collector faults.
- Collector faults are reported independently as `collector-health`.
- Incomplete evidence windows cannot be mistaken for completed passes.
- Installer mirrors `game/*.js` under the installed test tree while preserving the flat Screeps runtime layout.

Verified live evidence on Node.js `18.20.4`:

- smoke ticks `3682644–3682668`: `PASS=8 / WATCH=1 / FAIL=0`;
- live ticks `3682701–3682800`: `PASS=12 / WATCH=3 / FAIL=0`;
- runtime errors, collector health, CPU/bucket, mining, hard-stall, telemetry continuity, hauler capacity, controller progress, and construction progress all passed in the full live gate;
- remaining WATCH findings: consumer self-supply fallback, productive throughput below mining capacity, and Efficiency `INEFFICIENT`; these are optimization findings, not safety failures.

### v0.2.18 — VERIFIED / CLOSED

Dedicated Productive Work.

- With two or more live haulers, `builder`, `worker`, and `repairer` creeps keep carried energy for productive work instead of refilling spawn/extensions.
- With zero or one live hauler, the historical infrastructure-first recovery path remains unchanged.
- Upgrader behavior is unchanged.
- Mining, hauling-capacity models, spawn counts, defense, planning, and expansion are unchanged.
- `npm run verify:live` now waits automatically for the first complete post-deploy 100-tick window, polling collector evidence every 5 seconds.

Verified live window: ticks `3683401–3683500`.

Observed gate result:

- `PASS=13 / WATCH=2 / FAIL=0`
- runtime errors: PASS
- collector health: PASS
- CPU/bucket: PASS
- mining active: PASS
- hard stall: PASS
- telemetry continuity: PASS
- hauler capacity: PASS
- controller progress: PASS
- construction progress: PASS
- consumer supply: WATCH — consumers were waiting/critical, but `consumerFallbackCount` remained `0`
- productive throughput: WATCH — throughput still trails mining capacity
- efficiency status: `EFFICIENT`

The behavior target succeeded: self-supply fallback was eliminated in the verified live window while all hard safety gates remained green.

### v0.2.19 — VERIFIED / CLOSED

Productive Flow Attribution. Observability only; no colony control behavior change.

- Added bounded current-state and 100-tick productive-flow attribution.
- Measures consumer waiting/critical/fallback/empty creep-ticks and wait age.
- Measures active WORK capacity by productive role.
- Measures construction backlog/mix and controller demand.
- Measures actual construction/controller productive throughput per tick.
- Gate-critical attribution fields are mirrored at serialization-safe depth.
- `verify:live` skips unusable completed windows and waits for the next valid one.
- Wait UX is compact: `Waiting for data...[MM Min SS Sec remaining]`.

Verification evidence:

- smoke ticks `3683727–3683751`: `PASS=8 / WATCH=1 / FAIL=0`;
- final live ticks `3684101–3684200`: `PASS=13 / WATCH=3 / FAIL=0`;
- productive-flow attribution: PASS / complete;
- runtime errors, collector health, CPU/bucket, mining, hard-stall, telemetry continuity, hauler capacity, controller progress, and construction progress: PASS;
- remaining WATCH findings: consumer self-supply fallback occurred, productive throughput below mining capacity, Efficiency `UNDERUTILIZED`.

The smoke window belongs to the initial v0.2.19 deploy. The later serialization/UX patch changed observability only; the final 100-tick live window validated the patched attribution payload and all hard safety gates with zero FAIL.

### 0.3.0-shadow.1-node18 — VNEXT SHADOW LIVE / WATCH

First integrated VNext shadow release.

Implemented shadow/evidence-only foundation:

- K0 Runtime Capability Discovery;
- K1 CPU Process Scheduler;
- O1 Universal ColonyState Snapshot;
- I0 World Intel + Freshness;
- E0 Unified Request Registry SHADOW;
- E1 Marginal Assignment Engine SHADOW;
- O2 Assignment Evidence;
- E2/E2A Predictive Capacity Spawn Planner SHADOW;
- E2B Generalized Body Optimizer SHADOW.

Release/deployment hardening:

- exact `DEPLOYMENT_ID` injection and server-side verification;
- persistent `DEPLOYMENT_MARKER` on activation;
- deployment receipt scoped by server/branch/version;
- same-version redeploy protection;
- stale `last100` rejection;
- exact Node gate `18.20.4`;
- explicit live assertion that VNext remains `SHADOW` / `SHADOW_EVIDENCE`.

Merged release PR #17 at:

`8d368ea110229c3d82572f1f7491d01c48c22578`

First 100-tick VNext shadow live window:

`3690501–3690600`

Verifier result:

- `PASS=15`
- `WATCH=3`
- `FAIL=0`
- overall: `WATCH`

Hard/safety checks passed:

- Node and bot version;
- complete window;
- runtime and collector health;
- CPU/bucket;
- mining;
- hard-stall detection;
- telemetry continuity;
- productive attribution;
- modeled hauler capacity;
- controller progress;
- construction progress;
- K0/K1/I0 telemetry presence;
- O1/E0/E1/E2/O2 shadow authority contract.

Remaining optimization findings:

- consumer self-supply fallback occurred;
- productive throughput trails mining capacity;
- Efficiency is `WATCH`.

This is not recorded as a PASS. It is accepted as the first VNext shadow live evidence with zero hard failures. No VNext subsystem is authorized to take gameplay authority from this result alone.

Append-only evidence:

`docs/verification/vnext-shadow-live-0.3.0-2026-10-04.md`

## Next release boundary

The first VNext shadow live gate is complete. The restriction against starting another major VNext feature slice before live validation is therefore satisfied.

However, the current release remains shadow/evidence-only. No authority promotion is justified yet.

The E2/E3 follow-up is merged and was live-tested as **0.3.0-shadow.2-node18**. CPU attribution observability is now merged and is being prepared as **0.3.0-shadow.3-node18** for the next live verification:

- E2 spawning-capacity accounting now resolves `spawn.spawning.name` through `Game.creeps` when the in-flight creep is not yet present in `state.creeps`. This prevents duplicate future-capacity proposals observed during the live harvester/hauler replacement transitions.
- E3 — Logistics Requests has started in SHADOW mode with explicit `PICKUP`, `DELIVER`, `BALANCE`, `RESERVE`, and `EMERGENCY_DELIVER` graph publishers.
- Logistics requests preserve explicit source/target endpoints and expose a SHADOW summary through ColonyState telemetry.
- E3 graph requests are intentionally excluded from E1 generic assignment. Dedicated transport matching/reservations remain the responsibility of **E4 — Hauler Matching**.
- No gameplay authority is changed by these updates.

The latest live window still exposes three optimization findings:

- consumer self-supply fallback occurred;
- productive throughput remains below mining capacity;
- Efficiency is `WATCH`;
- mining and modeled hauler capacity nevertheless passed.

Do not respond by blindly adding mining or hauling capacity. The next logistics work should explain and reduce delivery latency / assignment inefficiency using request-level evidence.

## 0.3.0-shadow.2 live follow-up

The first complete shadow.2 live window `3691601–3691700` is **FAIL**, not PASS:

- `PASS=15 / WATCH=2 / FAIL=1`;
- the only hard failure is `cpu-bucket`;
- bucket remained `10000`;
- tick `3691625` recorded `27.351` CPU, above the hard `20` threshold;
- a later profiler-history sample at tick `3691775` recorded another `26.78` CPU spike;
- E2/E3 shadow authority, runtime health, collector health, mining, telemetry continuity, productive attribution, modeled hauler capacity, controller progress, and construction progress remained safe;
- E3 Logistics Requests appeared in live telemetry as SHADOW requests;
- the live window did not contain a spawn transition, so the E2 in-flight-spawn fix still needs a direct post-fix live replacement observation.

Existing profiler maxima are lifetime maxima and cannot attribute the exact spike tick to `rooms` vs `creeps`. Per-sample section attribution has now been added to the 25-tick CPU history, including `rooms`, `creeps`, `world-intel`, `stats`, `visuals`, `attributed`, and `unattributed`. The next gate is a shadow.3 live run that captures at least one future CPU spike with this attribution. E4 remains blocked until that evidence is reviewed. Do not weaken the hard CPU threshold.

## 0.3.0-shadow.3 CPU attribution follow-up

The complete shadow.3 live window `3692101–3692200` finished **WATCH**, not FAIL:

- `PASS=15 / WATCH=3 / FAIL=0`;
- CPU/bucket passed inside the 100-tick verification window;
- runtime errors, collector health, mining, hard-stall, telemetry continuity, productive attribution, modeled hauler capacity, controller progress, construction progress, VNext platform shadow, and VNext shadow authority all passed;
- remaining WATCH findings were consumer self-supply fallback, productive throughput below mining capacity, and Efficiency `WATCH`.

Post-window CPU history then captured a new recurring hard spike at tick `3692225`:

- total CPU: `27.412`;
- bucket: `10000`;
- `rooms: 19.065` CPU (~69.6% of total);
- `creeps: 2.357` CPU;
- `world-intel: 0` CPU;
- `stats: 0.046` CPU;
- `visuals: 0.048` CPU;
- `unattributed: 5.896` CPU.

This identifies the top-level `rooms` section as the primary recurring spike domain for that sample. It is not yet sufficient to identify the exact expensive operation inside `room.manager`.

PR #23 added nested, non-additive room-manager CPU detail sampling for `room.state`, `room.economy`, `room.requests`, `room.capacity-spawn`, `room.assignment`, `room.evidence`, `room.colony-state`, `room.legacy`, `room.planner`, and `room.heartbeat`. It changes observability only and preserves legacy gameplay authority and the hard CPU threshold.

The next release is **0.3.0-shadow.4-node18**. Its purpose is to capture the next recurring >20 CPU sample with nested room detail attribution. E4 remains blocked until that evidence is reviewed; do not optimize or weaken thresholds on suspicion alone.

## 0.3.0-shadow.4 CPU detail follow-up

The complete shadow.4 live window `3692501–3692600` finished **WATCH** with `PASS=15 / WATCH=3 / FAIL=0`:

- CPU/bucket, runtime health, collector health, mining, hard-stall, telemetry continuity, productive attribution, modeled hauler capacity, controller progress, construction progress, VNext platform shadow, and VNext shadow authority all passed;
- consumer supply remained WATCH because consumers waited/were critical, but self-supply fallback stayed at zero;
- productive throughput remained below mining capacity;
- Efficiency remained `UNDERUTILIZED`.

The new nested room CPU detail telemetry explains the observed room cost almost completely. Captured samples show:

- `room.capacity-spawn`: peak `6.534` CPU at tick `3692525`;
- `room.assignment`: peak `4.272` CPU at tick `3692625`;
- `room.requests`: peak `3.822` CPU at tick `3692575`;
- `room.heartbeat`: only `0.331–1.273` CPU in the captured detail samples.

No post-deploy shadow.4 sample in the captured history exceeded 20 CPU, but ticks `3692525` (`19.462`) and `3692550` (`19.643`) approached the hard threshold closely. The evidence therefore does not justify blaming heartbeat serialization; the first optimization target is repeated computation inside the E2 capacity/body-optimization path and E1 assignment scoring.

PR #25 applies behavior-neutral Shadow CPU reuse only:

- bounded deterministic caching in the body optimizer with mutation-isolated returns;
- candidate cost calculation before body allocation so over-budget candidates can be skipped earlier;
- once-per-plan executor profiles in E1 so role, WORK, CARRY and carried energy are not repeatedly recomputed for every candidate pair.

No request priority, assignment score formula, spawn decision, body ranking, CPU threshold, gameplay authority, or E4 logistics behavior is changed.

The next release is **0.3.0-shadow.5-node18**. Its live purpose is to verify that the observed `capacity-spawn` and `assignment` CPU costs fall without behavior regressions. E4 remains blocked until the CPU safety evidence from this release is reviewed.


## 0.3.0-shadow.5 CPU reuse follow-up

The shadow.5 CPU-reuse release was live-tested after PR #25:

- runtime version: `0.3.0-shadow.5-node18`;
- the corrected live verification window `3710702–3710801` finished **WATCH** with `PASS=12 / WATCH=6 / FAIL=0`;
- Node runtime, bot version, window completion, runtime errors, collector health, CPU/bucket, mining, hard-stall, telemetry continuity, modeled hauler capacity, VNext platform shadow, and VNext shadow authority all passed;
- consumer supply remained WATCH because self-supply fallback still occurred;
- productive-attribution/controller/construction/throughput WATCH results are caused by the runtime's fixed economy-window cadence not aligning exactly with the verifier's deployment-relative 100-tick window. PR #27 corrected this from a false hard FAIL to WATCH while preserving hard FAIL for genuinely missing attribution fields.

The nested CPU samples show that PR #25 materially reduced the two intended Shadow hot paths:

- `room.capacity-spawn` fell from multi-CPU samples/peak `6.534` in shadow.4 to generally about `0.1–0.3` CPU in the captured shadow.5 history;
- `room.assignment` fell from multi-CPU samples/peak `4.272` in shadow.4 to generally sub-1 CPU in the captured shadow.5 history;
- total `rooms` cost is substantially lower than the shadow.4 sample set.

Occasional total CPU samples above 20 still occurred outside the corrected live-gate window, but they were no longer driven by E2 capacity-spawn or E1 assignment. Remaining variable cost is concentrated in unattributed main-loop work, creep execution, assignment evidence, and occasional legacy `room.planner` work. The hard CPU threshold is unchanged.

Decision:

- the original E1/E2 CPU blocker for **starting E4 in SHADOW mode** is lifted;
- this is **not** approval for E4 gameplay authority;
- E4 must remain evidence-only, get its own CPU attribution, and prove match quality / consumer-supply improvement before any legacy hauler behavior is replaced;
- consumer fallback is still a real optimization target despite modeled hauler capacity passing.

E4 implementation target from the roadmap:

- match only E3 `PICKUP`, `DELIVER`, `BALANCE`, `RESERVE`, and `EMERGENCY_DELIVER` requests;
- score priority, deadline, carried-resource advantage, route reuse, travel, detour, and reservation conflict;
- use short-lived Shadow reservations to avoid double allocation;
- allow partial carried resource to satisfy urgent demand;
- expose predicted transport timing and critical-demand coverage;
- leave `role.hauler` execution unchanged until live comparison evidence supports an authority transition.

## 0.3.0-shadow.6 E4 live-test purpose

PR #28 introduced **E4 — Hauler Matching** in SHADOW/evidence-only mode and was merged only after the complete Node 18.20.4 regression suite passed, including the new logistics-matching regression and syntax validation across 42 game modules.

The `0.3.0-shadow.6-node18` release exists only to validate E4 live telemetry. Acceptance focus:

- `room.logistics-match` CPU must remain small enough that E4 does not recreate the prior room CPU problem;
- E4 must continue to report `authority: SHADOW`;
- matching must produce sensible `DIRECT_CARRIED`, `PICKUP_DELIVER`, and `BALANCE` job evidence;
- critical logistics demand should show measurable match coverage without duplicate reservation inflation;
- consumer waiting/fallback should be compared against the existing legacy hauler behavior, not assumed improved;
- legacy `role.hauler` remains authoritative and unchanged.

No E4 authority transition is allowed from this release. A future switch requires equal-or-better live evidence for safety, consumer supply, transport latency/utilization, and CPU.

## 0.3.0-shadow.6 E4 live follow-up

The first E4 SHADOW live verification window `3711402–3711501` finished **WATCH** with `PASS=12 / WATCH=6 / FAIL=0`.

Passed:

- Node runtime and bot release identity;
- complete evidence window;
- runtime and collector health;
- CPU/bucket safety;
- dedicated mining;
- hard-stall safety;
- durable telemetry continuity;
- modeled hauler capacity;
- VNext platform shadow;
- VNext shadow-authority contract.

WATCH findings:

- productive-flow attribution used a valid fixed runtime 100-tick economy window that did not align exactly with the deployment-relative verifier window;
- consumer supply had waiting/critical consumers, but **fallback remained zero** in this window;
- controller progress, construction progress and productive throughput were not available for the exact requested window because of the same cadence mismatch;
- efficiency remained an optimization WATCH.

E4 CPU evidence from the first post-deploy profiler samples:

- tick `3711400`: `room.logistics-match = 0.235` CPU;
- tick `3711425`: `0.226`;
- tick `3711450`: `0.168`;
- tick `3711475`: `0.138`;
- mean across those four captured samples: approximately `0.192` CPU.

The same four samples kept CPU bucket at `10000`; total CPU was approximately `13.6–17.8`. E4 therefore did **not** recreate the previous E1/E2 room CPU hotspot in this initial live sample.

Interpretation:

- E4 is safe to continue in SHADOW/evidence-only mode;
- the release does **not** prove that E4 improves consumer supply, because legacy `role.hauler` remains authoritative;
- the zero-fallback window is encouraging but cannot be causally attributed to E4;
- current per-tick matching summaries are insufficient for an authority decision.

The next E4 step is a dedicated 100-tick matching-evidence window tracking hauler utilization, critical-request coverage, predicted transport latency, job mix, reservation integrity and concurrent consumer waiting/fallback. No authority transition is allowed until this evidence is reviewed.

## 0.3.0-shadow.7 E4 evidence live-test purpose

PR #30 adds a dedicated 100-tick E4 matching-evidence window while keeping `role.hauler` authoritative and E4 strictly SHADOW.

The `0.3.0-shadow.7-node18` release exists to validate that evidence layer live. Acceptance focus:

- `room.logistics-evidence` CPU must remain small;
- `logisticsMatching.authority` must remain `SHADOW`;
- `logisticsMatching.evidence.authority` must remain `SHADOW_EVIDENCE`;
- the 100-tick E4 window should complete with sensible hauler utilization, job rate, critical-request coverage, predicted transport latency and reservation volume;
- `duplicateReservationTicks` must remain zero;
- consumer waiting/critical/fallback should be observed alongside E4 matching evidence, without attributing legacy execution outcomes to E4;
- any incomplete exact-window evidence is WATCH, duplicate reservation evidence is FAIL.

No gameplay-authority transition is included or permitted by this release.

## shadow.7 smoke heartbeat durability follow-up

The first shadow.7 smoke window `3711793–3711817` completed with `PASS=8 / FAIL=1`. The only failure was `cpu-bucket`: no `BOT_HEARTBEAT` CPU/bucket event was present in the captured 25-tick window. Runtime errors, collector health, mining, hard-stall safety and telemetry continuity all passed.

This was diagnosed as an observability durability gap, not evidence of unsafe CPU:

- `BOT_HEARTBEAT` runs every 25 ticks and the smoke window included tick `3711800`, so a runtime heartbeat should have existed;
- the event was INFO-only and was not opted into the durable telemetry journal;
- a WebSocket/collector gap can therefore lose the sole heartbeat required by a 25-tick smoke window even when all other durable telemetry is healthy;
- `STATUS_SNAPSHOT` is durable but runs only every 100 ticks, so it cannot reliably cover a 25-tick smoke gate.

Follow-up fix: explicitly journal `BOT_HEARTBEAT` while keeping it out of `Memory.bot.logs`. This changes observability only; CPU thresholds, gameplay, E4 matching/evidence and authority are unchanged.

## shadow.7 live CPU and E4 evidence follow-up

The live window `3712102–3712201` completed with `PASS=11 / WATCH=7 / FAIL=1`. The sole hard failure was CPU safety:

- tick `3712175`: `BOT_HEARTBEAT cpu = 23.638`, bucket `10000`;
- tick `3712200`: `BOT_HEARTBEAT cpu = 23.595`, bucket `10000`;
- no critical bucket samples occurred.

Therefore the failure is caused by total CPU exceeding the existing hard threshold of 20, not by bucket exhaustion.

Both failing ticks are 25-tick `ROOM_HEARTBEAT` ticks. The room heartbeat currently serializes the full economy metrics (including `last100`) and the full ColonyState even though the durable `STATUS_SNAPSHOT` already carries those heavy structures every 100 ticks. The immediate follow-up is to compact `ROOM_HEARTBEAT` by removing those redundant heavy payloads while preserving operational summaries required by smoke verification.

The completed E4 matching-evidence window `3712093–3712192` shows:

- `haulerUtilization = 1`;
- `averageCandidatesPerTick = 34.48`;
- `averageJobsPerTick = 2.82`;
- `criticalRequestTicks = 745`;
- `criticalMatchedTicks = 110`;
- `criticalCoverageRatio = 0.148`;
- `averagePredictedTransportTicks = 2.28`;
- `averageConsumerFallback = 0.72`;
- `duplicateReservationTicks = 0`.

This proves reservation integrity is currently clean, but E4 critical-demand coverage is poor. At tick `3712125`, a `RESERVE` delivery scored `256.5` while an `EMERGENCY_DELIVER` scored `245.5`, so the current E4 scoring can prefer reserve demand over emergency demand. That is a separate matching-quality issue and must be addressed only after the CPU hard-fail path is stabilized.

No E4 authority transition is allowed.

## shadow.7 second smoke CPU follow-up

After compacting `ROOM_HEARTBEAT`, smoke window `3712488–3712512` still failed only the hard CPU gate. Because `BOT_HEARTBEAT` runs every 25 ticks, the relevant sample in that window is tick `3712500`.

Code-order review established an important correction: `tickCpu` is measured immediately after `profiler.finishTick()` and before `STATUS_SNAPSHOT` plus before `BOT_HEARTBEAT` serialization/logging. Therefore the measured hard CPU failure is caused by pre-telemetry bot work, not by the size of the heartbeat payload itself. The heartbeat compaction remains useful observability overhead reduction but does not explain the reported CPU number.

The profiler already stores exact 25-tick section/detail attribution in `Memory.bot.cpu.history`. The next observability step is to attach that already-computed attribution to durable `BOT_HEARTBEAT` events and make the verifier print hard-fail tick/value details directly. No CPU threshold or gameplay behavior is changed.

## tick 3712500 CPU attribution

The preserved profiler sample for tick `3712500` shows:

- absolute profiler `used = 40.617`;
- bucket `10000`;
- `rooms = 8.356`;
- `creeps = 21.483`;
- `stats = 0.032`;
- `visuals = 0.047`;
- `world-intel = 0`;
- top-level attributed `29.918`;
- profiler unattributed `10.699`.

Room detail on the same tick:

- `room.requests = 2.961`;
- `room.capacity-spawn = 1.45`;
- `room.assignment = 1.043`;
- `room.planner = 0.626`;
- `room.evidence = 0.544`;
- `room.logistics-match = 0.444`;
- `room.economy = 0.472`;
- `room.logistics-evidence = 0.028`.

Interpretation: the dominant measured hotspot is the global creep execution section, not E4 matching. The profiler's historical `used` value is currently absolute `Game.cpu.getUsed()`, while `BOT_HEARTBEAT.cpu` is loop-relative from `tickStart`; those bases must be aligned before using `unattributed` quantitatively.

Next diagnostic step: record loop-relative profiler `used` and aggregate creep CPU by role without changing creep execution order. No gameplay behavior or CPU threshold changes are included.

## Current strategic interpretation

`E8N1` remains structurally safe under the VNext shadow stack: dedicated mining is active, modeled hauler capacity is sufficient, controller and construction progress continue, CPU/bucket are safe, telemetry is contiguous, and no VNext subsystem gained gameplay authority.

The remaining issue is productive-flow execution rather than aggregate supply capacity. Consumer fallback can recur despite sufficient modeled hauling, and productive throughput still trails available mining capacity.

The next architecture work is to validate the new E2/E3 shadow telemetry in-game, then continue into E4 hauler matching while keeping legacy gameplay authoritative until shadow comparison shows equal-or-better output.

## Development invariants

Architecture:

`Colony State -> Problems/Need -> Priorities -> Jobs -> Required Creep Capacity -> Spawn Planning -> Assignment -> Measure -> Reevaluation`

Rules:

- Colony decides; creeps execute.
- Recovery > Growth.
- Economy > Expansion.
- Defense > Expansion.
- Measure before optimizing.
- Use actual throughput rather than a single snapshot.
- Derive tuning constants from telemetry where possible.
- Cache stable calculations.
- Tolerate creep losses, restarts, and Memory persistence.
- Keep planner/strategy separate from layout/build priority.
- Safety invariants are immutable unless explicitly reviewed.
- Historical telemetry/evidence must never be rewritten to make a release look successful.

## Standard verification workflow

For each change:

1. Keep the change small, testable, and regression-safe.
2. Run the full offline regression suite.
3. Deploy only after offline gates pass.
4. Run the 25-tick smoke gate.
5. If there is no hard failure, collect the full 100-tick window.
6. Run the live verification gate.
7. Only then begin the next behavior-changing release.

Typical Windows workflow:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
cd tools
npm install
npm test
npm run doctor
npm run deploy
npm run logs
```

Then in the Screeps console:

```js
bot.status()
bot.telemetryStatus()
```

## Secrets and local-only files

Never commit real Screeps credentials, tokens, local collector state, telemetry captures, generated logs, or other private runtime material. `tools/screeps.json.example` is safe to commit; a real `tools/screeps.json` is not.


## 2026-10-06 — post-#55 / #56 / #57 / #58 live follow-up

The current lineage includes the post-#58 verifier integrity fixes and the post-#60 historical-attribution recovery; avoid hard-coding the moving merge SHA here.

Evidence-integrity follow-up:

- PR #56 preserved `duplicateReservationTicks` inside the durable E4 telemetry key budget and stopped missing duplicate evidence from being defaulted to zero.
- Live E4 windows now report `duplicateReservationTicks = 0` explicitly.
- PR #58 additionally prevents explicit `null` numeric evidence from being coerced to zero and lets the verifier consume an exact `ASSIGNMENT_EVIDENCE_WINDOW` for controller progress, construction progress and useful-work throughput when the latest `STATUS_SNAPSHOT.economy.last100` still reflects the previous cadence window.
- PR #58 does not promote incomplete productive-flow attribution: the richer `productiveFlow` check remains WATCH unless that exact payload is available.

Legacy hauling follow-up:

- PR #55 introduced the narrow two-hauler service floor under real consumer pressure.
- Repeated completed post-#55 windows showed two haulers fully utilized with candidate availability intact while consumer fallback remained non-zero.
- PR #57 added a bounded severe-pressure reserve: only when two haulers are already live, at least one consumer is in fallback and at least two consumers are critical may the legacy service floor rise to three.
- With three live haulers, at most two starvation guards may prioritize consumers; at least one live hauler remains outside the guard set for spawn/extensions/tower service.
- E4 remains strictly `SHADOW` / `SHADOW_EVIDENCE`; no E4 metric controls legacy runtime behavior.

First complete three-hauler E4 evidence window: `3738793–3738892`.

Observed:

- `averageHaulers = 3`;
- `averageMatchedHaulers = 3`;
- `haulerUtilization = 1`;
- `averageJobsPerTick = 3`;
- `criticalCandidateRatio = 1`;
- `criticalNoCandidateTicks = 0`;
- `criticalSlotCoverageRatio = 1`;
- `averageConsumerFallback = 0.35`;
- `averageConsumerCritical = 1.64`;
- `averageConsumerWaiting = 1.29`;
- `duplicateReservationTicks = 0`.

Relative to the prior clean two-hauler window, average consumer fallback fell from `1.03` to `0.35` (about 66%). The final snapshot at tick `3738900` had three live haulers, `consumerFallbackCount = 0`, Health `100 / HEALTHY`, full `20 e/t` dedicated mining and no modeled hauler CARRY deficit.

Exact post-#57 assignment-evidence window: `3738802–3738901`.

Observed:

- `controllerProgress = 260`;
- `constructionProgress = 949`;
- `usefulWorkPerTick = 12.09`;
- `averageRequestLatency = 13.64` ticks;
- `maxRequestLatency = 40` ticks;
- `assignmentsPerTick = 5.79`;
- `switchesPerTick = 0.02`;
- `averageUnfilledRequests = 3.02`;
- `idleCompatibleExecutorRatio = 0`.

Compared with the previous assignment-evidence window (`6.08 usefulWorkPerTick`, controller `202`, construction `406`), useful work rose by about 99%, controller progress by about 29% and construction progress by about 134%. This supports the conclusion that PR #57 materially improved productive energy delivery; it does not justify further hauling expansion.

Current stop rule:

- Do not add more hauling capacity. The severe-pressure reserve is intentionally bounded at three haulers, the room is healthy, and fallback improved materially.
- Do not change CPU thresholds.
- Do not promote E4 authority; it remains evidence-only.
- Do not tune productive-role counts from the stale Efficiency snapshot alone. The exact assignment window shows substantial improvement, while the richer exact productive-flow attribution still needs its own aligned snapshot before another gameplay change is justified.
- PR #60 extends the merged verifier so a later retained STATUS_SNAPSHOT may serve only as the carrier for an exact historical `economy.last100` block. Safety/current-state checks remain restricted to the requested verification window.
- Live validation after PR #60 recovered the exact `3738802–3738901` productive-flow attribution from carrier tick `3739000`; `productive-attribution` is PASS.
- Exact productive-flow counts for that window are `consumerTicks = 500`, `waitingConsumerTicks = 137`, `criticalConsumerTicks = 161`, and `fallbackConsumerTicks = 24`, yielding waiting/critical/fallback ratios of about `27.4% / 32.2% / 4.8%`.
- Relative to the prior exact window (`12.8% / 35.6% / 22.8%`), fallback exposure fell by about 79% while critical exposure improved modestly; waiting exposure increased, consistent with more consumers waiting briefly instead of entering fallback. This is an optimization signal, not evidence for another hauler increase.
- The verifier reports `15 PASS / 4 WATCH / 0 FAIL` for `3738802–3738901`.
- The subsequent exact productive window `3738902–3739001` also completed successfully: `controllerProgress = 202`, `constructionProgress = 805`, `usefulWorkPerTick = 10.07`, `consumerTicks = 500`, `waitingConsumerTicks = 126`, `criticalConsumerTicks = 178`, and `fallbackConsumerTicks = 52`. That is about `25.2% / 35.6% / 10.4%` waiting/critical/fallback exposure.
- This second post-#57 window is weaker than the first post-#57 window but remains materially better than the pre-#57 `22.8%` fallback exposure. E4's adjacent completed window also improved critical coverage to `0.813` with `criticalCandidateRatio = 1` and `duplicateReservationTicks = 0`.
- PR #63 corrects a diagnostic unit error: productive progress per tick must not be divided by mining energy per tick. Efficiency model v2 and the live verifier now compare actual productive progress against same-unit modeled productive WORK capacity derived from the exact window's builder/worker/upgrader WORK parts, falling back to `productiveDemandPerTick` only when exact-window capacity evidence is unavailable.
- PR #63 is diagnostic only. It changes no spawn, role-count, hauling, CPU, request-authority, or E4-authority behavior.
- After deploying PR #63, re-run a fresh smoke/live gate to validate Efficiency v2 telemetry. Do not make another gameplay change before that diagnostic baseline is observed.


## 2026-10-06 — post-#63 / #65 productive-delivery follow-up

PR #63 is live and Efficiency model v2 is visible in telemetry. The corrected diagnostic reports productive progress against same-unit productive WORK capacity rather than mining energy.

The first post-#63 live window `3739601–3739700` completed with no hard failures: `12 PASS / 7 WATCH / 0 FAIL`. Its requested verifier cadence was shifted relative to the completed productive-flow block, so progress/throughput checks remained WATCH for that exact verifier window. The latest snapshot nevertheless confirms model v2 is active with `productiveThroughputPerTick = 10.23`, `productiveCapacityPerTick = 28`, and `dedicatedHarvestCapacityPerTick = 18`.

The retained exact productive-flow block `3739502–3739601` reports:

- `consumerTicks = 500`;
- `waitingConsumerTicks = 81`;
- `criticalConsumerTicks = 157`;
- `fallbackConsumerTicks = 76`;
- `emptyConsumerTicks = 101`;
- `waitingRatio = 0.162`;
- `criticalRatio = 0.314`;
- `fallbackRatio = 0.152`;
- `energyCappedRatio = 0.52`;
- `controllerProgress = 294`;
- `constructionProgress = 729`;
- `usefulWorkPerTick = 10.23`.

At tick `3739700`, room energy was `719/800` with three live haulers while three productive consumers were waiting. The structured consumer diagnostics showed the repairer empty after 6 waiting ticks and the builder empty after 5 waiting ticks. A live hauler already held a reservation to the repairer while carrying only 39 energy.

This exposed a narrow legacy execution bug: a consumer in acquisition mode returned to productive work only after its entire CARRY store became full. A successful partial hauler transfer could therefore deliver usable energy while the consumer continued waiting.

PR #65 fixes that behavior without changing hauling policy:

- successful partial hauler-to-consumer transfers receive an explicit delivery-tick marker;
- a consumer with positive energy from a confirmed current/previous-tick hauler delivery resumes productive work immediately;
- the marker is consumed after resuming;
- full-store behavior is unchanged;
- self-harvest fallback remains fill-before-work, so the historical one-tick fallback/wait loop is not reintroduced;
- no role counts, hauler counts, CPU thresholds, E4 authority, or request/assignment authority change.

Exact branch regression coverage passed for `consumer-supply.test.mjs` and `logistics-fallback.test.mjs` before merge.

Current stop rule after PR #65:

- deploy PR #65 before interpreting another productive-utilization window;
- do not add more haulers or productive roles yet;
- after deployment, compare consumer waiting/fallback exposure and productive throughput against the retained `3739502–3739601` baseline;
- specifically look for fewer empty/waiting consumer ticks after partial deliveries while preserving CPU/bucket safety and duplicate-free E4 evidence;
- E4 remains strictly `SHADOW` / `SHADOW_EVIDENCE`.


## 2026-10-06 — post-#65 / #67 lifecycle follow-up

The exact verification window `3739902–3740001` completed with `14 PASS / 5 WATCH / 0 FAIL`. Its exact assignment evidence reports `controllerProgress = 72`, `constructionProgress = 689`, `usefulWorkPerTick = 7.61`, `averageRequestLatency = 14.58`, and `maxRequestLatency = 60`.

The adjacent completed E4 window `3739893–3739992` remains healthy on evidence integrity and improves materially versus the earlier saturated state:

- `averageHaulers = 3`;
- `averageMatchedHaulers = 2.13`;
- `haulerUtilization = 0.71`;
- `criticalCoverageRatio = 0.947`;
- `criticalCandidateRatio = 1`;
- `criticalNoCandidateTicks = 0`;
- `criticalSlotCoverageRatio = 0.958`;
- `averageConsumerFallback = 0.92`;
- `duplicateReservationTicks = 0`.

The exact productive window is not a clean measure of PR #65 alone because it overlaps a productive-creep lifecycle turnover. Live snapshots show the active productive population falling from worker + builder + two upgraders + repairer at tick `3739925`, to worker + builder + upgrader by `3739950`, and then the worker itself disappearing before a replacement begins spawning at tick `3739999`. The replacement worker costs 800 energy and has a 12-part body, so its spawn time is 36 ticks.

This exposed a separate legacy lifecycle gap: `spawn.manager.js` counted every living productive creep as fully available until death. The shadow capacity planner already models TTL against spawn/arrival horizon, but that shadow planner is not gameplay authority.

PR #67 ports only the lifecycle principle into legacy execution:

- `worker`, `builder`, and `upgrader` use a prespawn horizon based on their actual replacement-body spawn time plus a 3-tick safety margin;
- for the current 800-energy 12-part worker body the horizon is 39 ticks;
- a productive creep with TTL at or below that horizon no longer counts as safely available for desired-count decisions;
- an already spawning replacement counts as available, preventing duplicate replacement spawns;
- harvester and hauler counting is unchanged;
- desired role counts are unchanged;
- capacity-shadow, request/assignment, and E4 authority remain SHADOW / SHADOW_EVIDENCE.

Exact branch regression coverage passed for `spawn-economy.test.mjs` before merge, including dying-worker prespawn, healthy-worker no-duplicate behavior, and already-spawning replacement accounting.

Current stop rule after PR #67:

- deploy PR #67 before interpreting another productive-throughput window;
- do not add more haulers or raise productive role targets yet;
- after deployment, verify that worker/builder/upgrader replacement starts before active capacity disappears and compare `usefulWorkPerTick`, request latency, consumer fallback, and E4 coverage against `3739902–3740001`;
- preserve CPU/bucket safety and duplicate-free E4 evidence;
- E4 remains strictly `SHADOW` / `SHADOW_EVIDENCE`.


## 2026-10-07 — post-#67 / #69 low-energy prespawn follow-up

Historical verification for `3740402–3740501` is now fully attributable because retained telemetry includes a later exact carrier snapshot at tick `3740600`. The verifier reports `15 PASS / 4 WATCH / 0 FAIL`.

Exact assignment/productive evidence for `3740402–3740501`:

- `controllerProgress = 76`;
- `constructionProgress = 964`;
- `usefulWorkPerTick = 10.4`;
- `averageRequestLatency = 17.42`;
- `maxRequestLatency = 69`;
- `consumerTicks = 300`;
- `waitingConsumerTicks = 67`;
- `criticalConsumerTicks = 167`;
- `fallbackConsumerTicks = 100`;
- waiting / critical / fallback exposure is therefore about `22.3% / 55.7% / 33.3%`;
- productive capacity is `41 progress/tick`, so observed productive utilization is about `25.4%`.

The adjacent completed E4 window `3740393–3740492` remains evidence-safe (`duplicateReservationTicks = 0`, `criticalCandidateRatio = 1`) but is saturated at three matched haulers and reflects heavy infrastructure-plus-consumer emergency demand. No E4 authority change is justified.

PR #67 correctly introduced prespawn-aware availability, but live evidence exposed one remaining timing failure. At tick `3740500` the legacy builder `bui-E8N1-3739013` was already deep inside its prespawn horizon while room energy was only `294/800`. The normal non-emergency spawn path refused any degraded replacement below 300 energy, even though a 3-part `[WORK,CARRY,MOVE]` body costs 200 energy and needs only 9 spawn ticks. Waiting for the room to refill could therefore consume the remaining TTL and recreate the productive-capacity gap that prespawn was designed to prevent.

PR #69 closes that narrow gap:

- RCL2+ worker availability now uses the same prespawn-aware count as builder/upgrader;
- a productive prespawn shortfall is explicitly distinguished from a role that is already absent;
- only a confirmed `worker` / `builder` / `upgrader` prespawn shortfall may bypass the normal 300-energy non-emergency degraded-body floor;
- the replacement still must be immediately affordable, so 294 energy can spawn a 200-energy 3-part productive body, while 165 energy still cannot;
- a role that is already absent does not receive this bypass;
- desired role counts, harvester/hauler policy, CPU thresholds, and all Shadow/VNext authority remain unchanged.

Exact branch regression coverage passed for `spawn-economy.test.mjs`, including the 294-energy builder prespawn, no bypass for an already-missing builder, and RCL2+ worker prespawn ordering ahead of economy scaling.

Current stop rule after PR #69:

- deploy PR #69 before interpreting another lifecycle/productive window;
- do not add more haulers or productive-role targets yet;
- after deployment, verify that productive replacements actually begin while the predecessor is still alive even when room energy is between 200 and 299;
- compare productive throughput and consumer fallback against `3740402–3740501` while preserving CPU/bucket safety and duplicate-free E4 evidence;
- E4 remains strictly `SHADOW` / `SHADOW_EVIDENCE`.


## 2026-10-07 — post-#69 / #71 zero-construction logistics follow-up

The live window `3757001–3757100` completed with `12 PASS / 7 WATCH / 0 FAIL`, no runtime/collector errors, safe CPU/bucket, full `20 e/t` dedicated mining, and no current consumer waiting/critical/fallback pressure.

The room had transitioned to `constructionSites = 0`, but source-container logistics was still active. Live economy evidence showed:

- `recommendedHaulerCarryParts = 12`;
- `haulerCarryParts = 0`;
- `haulerCarryDeficit = 12`;
- `recommendedHaulerCount = 2`;
- all source containers ready;
- Health `WATCH` with reason `HAULING_DEFICIT`.

At the same time, legacy spawn telemetry reported `desired.hauler = 0` solely because `spawn.manager.js` gated modeled hauler demand on `state.sites.length > 0`. All existing haulers were therefore allowed to age out after construction completed even though spawn/extensions and productive consumers still depended on source-route transport.

PR #71 removes only that construction-site gate:

- at RCL2+, when an economy model exists, legacy hauler demand follows `economyModel.recommendedHaulerCount` regardless of whether construction sites exist;
- `MAX_BOOTSTRAP_HAULERS` remains the upper bound;
- economy-model calculations, consumer service floors, CPU thresholds, and E4/VNext authority are unchanged;
- exact branch `spawn-economy.test.mjs` regression coverage passed for both desired-count and actual `spawnOne()` selection with zero construction sites.

Current stop rule after PR #71:

- deploy PR #71 before interpreting the zero-construction logistics phase further;
- verify that haulers respawn toward the model recommendation and `HAULING_DEFICIT` clears;
- do not alter E4 authority or hauler caps from the pre-deploy zero-hauler window;
- once hauler service is restored, reassess productive throughput in the no-construction / controller-only workload separately from prior construction-heavy baselines.


## 2026-10-07 — post-#71 / #73 controller-only follow-up

The live window `3757301–3757400` confirms PR #71 restored legacy logistics after construction completed:

- two live haulers are present;
- `haulerCarryParts = 16` versus `recommendedHaulerCarryParts = 12`;
- `haulerCarryDeficit = 0`;
- `recommendedHaulerCount = 2`;
- Health is `100 / HEALTHY` with no reasons;
- current consumer fallback/waiting/critical pressure is zero.

The adjacent completed E4 window `3757293–3757392` is healthy and evidence-safe:

- `averageHaulers = 2`;
- `haulerUtilization = 0.7`;
- `criticalRequestTicks = 35`;
- `criticalMatchedTicks = 35`;
- `criticalCoverageRatio = 1`;
- `criticalCandidateRatio = 1`;
- `criticalNoCandidateTicks = 0`;
- `duplicateReservationTicks = 0`.

The exact retained productive window `3757202–3757301` is controller-only (`constructionProgress = 0`) and reports:

- `controllerProgress = 376`;
- `actualProductiveThroughputPerTick = 3.76`;
- `averageConstructionCapacityPerTick = 0`;
- `averageDedicatedControllerCapacityPerTick = 6`;
- `waitingRatio = 0.04`;
- `criticalRatio = 0.11`;
- `fallbackRatio = 0.07`.

Efficiency model v2 incorrectly reconstructed productive capacity as 26 progress/tick by counting worker construction WORK even though no construction backlog existed. That made the controller-only utilization appear to be about 14% instead of the workload-relevant `3.76 / 6 ≈ 62.7%`.

PR #73 corrects this diagnostic-only issue:

- efficiency and the live verifier prefer exact-window `averageConstructionCapacityPerTick + averageDedicatedControllerCapacityPerTick`;
- older windows fall back to WORK-part reconstruction with construction/controller demand ratios when available;
- Efficiency diagnostic `modelVersion` is now 3;
- no role behavior, spawn policy, hauler policy, economy model, CPU threshold, or Shadow/VNext authority changes.

Exact branch regression coverage passed for `colony-efficiency.test.mjs` and the complete `live-verification.test.mjs` before merge.

Current stop rule after PR #73:

- deploy PR #73 before interpreting Efficiency status in the controller-only phase;
- do not increase hauler count: current two-hauler logistics meets modeled capacity and E4 critical coverage is complete;
- after deployment, verify Efficiency v3 reports controller-only productive capacity near 6 rather than 26 and that CPU/bucket/Health remain safe;
- E4 remains strictly `SHADOW` / `SHADOW_EVIDENCE`.


## 2026-10-07 — post-#73 live validation

The live window `3757601–3757700` confirms Efficiency v3 is active and the controller-only capacity correction behaves as intended. The verifier reports `13 PASS / 6 WATCH / 0 FAIL`; the remaining WATCH results are cadence or optimization findings rather than safety failures.

Current controller-only state:

- Efficiency `modelVersion = 3`;
- `productiveThroughputPerTick = 6.16`;
- committed `productiveCapacityPerTick = 6`;
- status `EFFICIENT`;
- dedicated mining remains `20 / 20 e/t`;
- CPU bucket remains `10000` and Health remains `HEALTHY`.

The exact retained productive window `3757502–3757601` reports:

- `controllerProgress = 616`;
- `constructionProgress = 0`;
- `usefulWorkPerTick = 6.16`;
- `waitingRatio = 0.18`;
- `criticalRatio = 0.193`;
- `fallbackRatio = 0.013`;
- `averageConstructionCapacityPerTick = 0`;
- `averageDedicatedControllerCapacityPerTick = 6`.

The slight `6.16 > 6` controller result is not treated as a new bug: the 6/tick value is committed/dedicated upgrader capacity, while the legacy worker can opportunistically fall through to controller upgrade after build/repair checks. A broader total-capacity experiment was audited and intentionally not promoted because Repair work is not yet measured in the same productive-throughput stream; counting opportunistic worker capacity without Repair attribution would create false underutilization signals.

The adjacent E4 window `3757593–3757692` remains evidence-safe under a three-hauler pressure phase:

- `averageHaulers = 3`;
- `averageMatchedHaulers = 2.97`;
- `haulerUtilization = 0.99`;
- `criticalRequestTicks = 138`;
- `criticalMatchedTicks = 138`;
- `criticalCoverageRatio = 1`;
- `criticalCandidateRatio = 1`;
- `criticalSlotCoverageRatio = 1`;
- `criticalNoCandidateTicks = 0`;
- `duplicateReservationTicks = 0`.

The third live hauler is not a reason to raise the steady target. Severe consumer pressure temporarily raised `consumerServiceHaulerFloor` / `recommendedHaulerCount` to 3; by tick `3757700` pressure had fallen back to one fallback consumer and the recommendation returned to 2 while all three existing haulers remained alive. No despawn or target tuning is justified from this transition window.

Current stop rule:

- no gameplay or authority change from this window;
- keep E4 strictly `SHADOW` / `SHADOW_EVIDENCE`;
- do not increase the two-hauler steady target or change CPU thresholds;
- next useful verification is the exact `3757602–3757701` productive/assignment window, using retained telemetry after tick `3757701` exists;
- reassess consumer fallback only from that exact window, not from phase-misaligned E4/productive windows.


## 2026-10-07 — post-#76 sticky consumer fallback fix

Exact historical verification for `3757602–3757701` is fully attributable. Retained telemetry contains an exact productive-flow carrier at tick `3757800`, and the verifier reports `17 PASS / 2 WATCH / 0 FAIL`.

Exact assignment/productive evidence for `3757602–3757701`:

- `controllerProgress = 448`;
- `constructionProgress = 0`;
- `usefulWorkPerTick = 4.48`;
- `averageRequestLatency = 63.18`;
- `maxRequestLatency = 145`;
- `consumerTicks = 300`;
- `waitingConsumerTicks = 36` (`12%`);
- `criticalConsumerTicks = 141` (`47%`);
- `fallbackConsumerTicks = 105` (`35%`);
- committed productive capacity is `6 progress/tick`, so observed productive utilization is about `74.7%`.

The adjacent E4 window `3757593–3757692` remained evidence-safe under three live haulers:

- `averageHaulers = 3`;
- `averageMatchedHaulers = 2.97`;
- `haulerUtilization = 0.99`;
- `criticalRequestTicks = 138`;
- `criticalMatchedTicks = 138`;
- `criticalCoverageRatio = 1`;
- `criticalCandidateRatio = 1`;
- `criticalSlotCoverageRatio = 1`;
- `criticalNoCandidateTicks = 0`;
- `duplicateReservationTicks = 0`.

The exact window exposed a real legacy state-machine bug rather than insufficient candidate generation. Final consumer diagnostics showed an upgrader at `95/100` energy still carrying `logisticsFallback = true` while a hauler with `279` energy was actively reserved and delivering to that same consumer. This happened because `energy.deliverToConsumer()` cleared fallback only when a transfer completely filled the consumer. A successful partial transfer merely set `lastHaulerDeliveryTick`; after spending that delivered energy, the consumer could therefore re-enter self-harvest immediately without another normal logistics wait period. The stale fallback flag also kept the consumer classified as critical and could sustain the severe three-hauler service floor after logistics had already recovered.

PR #76 fixes only that sticky-fallback transition:

- every successful hauler-to-consumer transfer resets `waitingEnergyTicks` and clears `logisticsFallback` immediately;
- partial deliveries still set `lastHaulerDeliveryTick`, so the consumer resumes productive work on its next turn;
- full deliveries continue to clear the hauler reservation as before;
- a later empty cycle now returns to the normal logistics wait path instead of immediately self-harvesting because of a stale fallback flag;
- desired hauler counts, economy-model floors, CPU thresholds, E4 logic, and Shadow/VNext authority are unchanged.

Exact branch `consumer-supply.test.mjs` regression coverage passed before merge, including the live-shaped case where a fallback consumer receives a partial hauler delivery to `95/100` and immediately stops being critical.

Current stop rule after PR #76:

- deploy PR #76 before interpreting another consumer-fallback window;
- do not increase the steady two-hauler target or the severe three-hauler cap from the pre-fix window;
- verify that partial hauler deliveries clear stale fallback/critical state and that the severe floor relaxes naturally when pressure clears;
- compare an exact post-#76 productive window against `3757602–3757701`, especially fallback ratio (`35%` baseline), controller throughput (`4.48/tick`), and E4 duplicate-free critical coverage;
- E4 remains strictly `SHADOW` / `SHADOW_EVIDENCE`.


## 2026-10-07 — post-#76 live validation / #78 surplus upgrader

The first complete productive window after PR #76 is `3758002–3758101`. It confirms the sticky-fallback fix materially changed the live state:

- `consumerTicks = 300`;
- `waitingConsumerTicks = 20` (`6.7%`);
- `criticalConsumerTicks = 22` (`7.3%`);
- `fallbackConsumerTicks = 2` (`0.7%`), down from the pre-fix `105 / 300 = 35%` baseline;
- `averageRequestLatency = 15.33`, down from `63.18`;
- `maxRequestLatency = 54`, down from `145`;
- `controllerProgress = 448` and `usefulWorkPerTick = 4.48`;
- `averageDedicatedControllerCapacityPerTick = 5` for this lifecycle window.

The adjacent E4 window `3757993–3758092` is also healthy on consumer service:

- `averageHaulers = 3`;
- `haulerUtilization = 0.803`;
- `criticalRequestTicks = 22`;
- `criticalMatchedTicks = 22`;
- `criticalCoverageRatio = 1`;
- `criticalCandidateRatio = 1`;
- `criticalSlotCoverageRatio = 1`;
- `averageConsumerFallback = 0.02`;
- `duplicateReservationTicks = 0`.

This confirms PR #76 solved the sticky fallback/critical-state problem. The next persistent live signal is instead unconsumed surplus in the no-construction/controller-only phase. During the `3758101–3758200` verification window the room repeatedly reached full spawn energy while the controller still had backlog. At tick `3758125`, Efficiency v3 reported:

- `productiveThroughputPerTick = 4.48`;
- `productiveCapacityPerTick = 5`;
- `energyCappedRatio = 0.58`;
- `spawnUtilization = 0`;
- status `UNDERUTILIZED` with reasons `ENERGY_SURPLUS_UNCONSUMED` and `SPAWN_IDLE_WITH_SURPLUS`;
- stored energy remained about `5800`;
- mining and hauling deficits were zero;
- consumer fallback/critical pressure was zero at the clean surplus snapshots.

PR #78 adds one deliberately bounded mature-surplus control loop to legacy spawn planning:

- only RCL2–RCL7;
- only with zero construction sites;
- only after at least 25 ticks of both capped room energy and idle spawn;
- only above 5000 stored energy;
- only when harvester and hauler deficits are zero;
- only when consumer critical/fallback pressure is zero;
- only when all source containers are ready;
- desired upgraders may rise from the existing value to at most `3` (still bounded by `MAX_UPGRADERS`).

At current 800-energy capacity a full upgrader body costs 700 energy and carries 4 WORK. With current dedicated productive demand around 5/tick and dedicated mining at 20 e/t, the additional upgrader raises controller demand to roughly 9/tick while remaining well below measured income. If surplus conditions disappear, desired count falls back to the previous policy automatically; existing extra creeps simply age out naturally.

Exact branch `spawn-economy.test.mjs` regression coverage passed before merge, including healthy-surplus scaling, pressure/construction suppression, and actual `spawnOne()` selection of the third 4-WORK upgrader.

Current stop rule after PR #78:

- deploy PR #78 before judging controller-only underutilization further;
- verify that sustained surplus spawns at most one extra upgrader and that controller throughput rises without creating consumer fallback, mining deficit, hauling deficit, or CPU pressure;
- do not increase the steady two-hauler recommendation or change the severe three-hauler cap;
- keep E4 strictly `SHADOW` / `SHADOW_EVIDENCE`;
- compare the next exact post-#78 productive window against `3758002–3758101` (fallback `0.7%`, throughput `4.48/tick`, latency `15.33`).


## 2026-10-07 — post-#80 optional surplus-upgrader prespawn fix

Exact E4 verification for `3758493–3758592` completed and exposed a lifecycle-induced logistics shock rather than a permanent steady-state three-upgrader deficit.

Exact E4 evidence:

- `averageHaulers = 3`;
- `averageMatchedHaulers = 2.79`;
- `haulerUtilization = 0.93`;
- `criticalRequestTicks = 657`;
- `criticalMatchedTicks = 167`;
- `criticalCoverageRatio = 0.254`;
- `criticalCandidateRatio = 1`;
- `criticalSlotCoverageRatio = 0.726`;
- `averageConsumerWaiting = 0.93`;
- `averageConsumerCritical = 1.92`;
- `averageConsumerFallback = 0.99`;
- `duplicateReservationTicks = 0`.

The window contains a decisive lifecycle event at tick `3758525`: while three upgraders were already live, legacy prespawn created `upg-E8N1-3758525`, a 600-energy, 4-WORK replacement. Room energy subsequently fell from `800/800` to about `225/800` by tick `3758550`, after which consumer critical/fallback pressure surged. Candidate availability remained healthy; the bottleneck was temporary slot pressure created by the replacement energy shock.

The preceding exact productive window `3758402–3758501` confirms the three-upgrader state itself is healthy: `controllerProgress = 845`, `usefulWorkPerTick = 8.45`, average committed productive capacity `8.4/tick`, zero fallback, and only about 5.5% waiting/critical consumer exposure.

PR #80 changes only surplus-upgrader lifecycle semantics:

- the two base RCL2+ upgraders remain prespawn-protected;
- the optional third mature-surplus upgrader is no longer prespawn-replaced while both base upgraders remain safely available;
- the optional third is allowed to age out naturally;
- after it expires, it is recreated only if mature-surplus conditions still justify `desired.upgrader = 3`;
- base-upgrader low-energy prespawn protection remains intact;
- no change to the three-upgrader cap, hauler targets, economy model, CPU thresholds, or E4/VNext authority.

Exact branch `spawn-economy.test.mjs` coverage passed before merge, including both the optional-third no-prespawn case and preserved base-upgrader prespawn continuity.

Current stop rule after PR #80:

- deploy PR #80 before evaluating another surplus-upgrader replacement cycle;
- do not add a fourth upgrader or fourth hauler from the pre-fix replacement-shock window;
- verify that an expiring optional third upgrader now ages out without an overlapping 600-energy replacement and that consumer fallback/critical pressure does not spike during the lifecycle transition;
- keep E4 strictly `SHADOW` / `SHADOW_EVIDENCE`.


## 2026-10-07 — post-#80 live validation / #82 containerized mining recovery

The first post-#80 live window `3759401–3759500` confirms the optional third mature-surplus upgrader now ages out without an overlapping replacement spawn. The room starts the window with three upgraders and reaches two by tick `3759450`; no `SPAWN_OK` event appears in the window for another upgrader. This validates the lifecycle change from PR #80.

The window still contains a temporary logistics-pressure phase, but a separate mining-model defect is now visible:

- both source containers are ready;
- theoretical source income remains `20 e/t`;
- live harvesters provide only `7 WORK`, split `2 WORK` on the long route and `5 WORK` on the short route;
- actual dedicated mining is therefore `14 e/t`;
- the economy model nevertheless reports `recommendedHarvesterWorkParts = 7` and `harvesterWorkDeficit = 0`;
- productive demand is only `8–9/t`, so the old recommendation logic treats the degraded mining state as self-sufficient.

This matters because productive WORK demand excludes spawn/extension refill, creep lifecycle replacement, and reserve recovery. A degraded essential harvester can therefore become permanently accepted even though completed container logistics can sustain full source throughput.

Observed post-#80 evidence also shows the room recovering consumer pressure after the optional third upgrader expires: by tick `3759500`, fallback/waiting/critical counts are all zero and Health returns to `100 / HEALTHY`. However, dedicated mining remains `14/20 e/t`, so the underlying capacity loss is still unresolved without an explicit recovery target.

PR #82 corrects only that recovery target:

- once all source containers are ready, full theoretical source throughput becomes the mining floor;
- the live `7 WORK / 14 e/t` state now recommends `10 WORK`, reports `3 WORK` deficit, and temporarily requests one additional current-sized harvester;
- with two normal `5 WORK` harvesters, mining returns to `20 e/t`, deficit returns to zero, and the recommended harvester count returns to two;
- before all source containers are ready, the existing bootstrap demand-driven behavior is unchanged;
- hauler floors/caps, mature-surplus upgrader cap, CPU thresholds, and E4/VNext authority are unchanged.

Exact branch regression coverage passed before merge for both `economy-model.test.mjs` and `spawn-economy.test.mjs`.

Current stop rule after PR #82:

- deploy PR #82 before evaluating mining/logistics pressure further;
- verify that the live `14/20 e/t` state produces a temporary harvester-capacity recovery request and returns to full `20/20 e/t` mining;
- do not add a fourth hauler or fourth upgrader from the pre-recovery pressure window;
- keep E4 strictly `SHADOW` / `SHADOW_EVIDENCE`;
- after mining recovery, reassess exact productive and E4 windows before any additional scaling change.


## 2026-10-07 — post-#82 live validation / #84 harvester recovery decay

The first live window after PR #82 is `3759801–3759900`. It confirms the containerized mining floor recovered dedicated mining to the full `20/20 e/t` source capacity. By tick `3759825`, the room has `11 HARVEST WORK`, full source throughput, and no mining deficit.

The recovery also exposed a follow-up count bug: five harvesters were live, `recommendedHarvesterWorkParts = 10`, `nextHarvesterWorkParts = 5`, and `harvesterWorkDeficit = 0`, but `recommendedHarvesterCount` remained `5`. The count formula was still anchored to the current live fleet even after the WORK deficit closed, so the temporary recovery fleet could never decay back to the minimal two-body steady state.

PR #84 fixes only that decay behavior:

- derive an ideal harvester count from recommended HARVEST WORK and the current-sized harvester body;
- while a real WORK deficit exists, temporary recovery may still grow relative to the live fleet;
- once the WORK deficit reaches zero, the recommendation returns to the ideal count;
- in the current 800-energy room, `10 WORK / 5 WORK per new harvester = 2` steady-state harvesters;
- the existing extra recovery harvesters are not despawned and simply age out naturally;
- the full `20 e/t` containerized mining floor from PR #82 remains unchanged.

Post-#82 live state at tick `3759900` remains safe: dedicated mining `20/20 e/t`, bucket `10000`, Health `100 / HEALTHY`, consumer fallback `0`, and no runtime errors. E4 remains SHADOW / SHADOW_EVIDENCE.

Exact branch regression coverage passed before merge for both `economy-model.test.mjs` and `spawn-economy.test.mjs`, including a live-shaped `5 harvesters / 11 WORK / 20 e/t` case that now returns `recommendedHarvesterCount = 2`.

Current stop rule after PR #84:

- deploy PR #84 before interpreting harvester-count steady state;
- verify that full `20/20 e/t` mining is retained while `recommendedHarvesterCount` falls to 2;
- allow the current five-harvester recovery fleet to age out naturally; do not add despawn behavior;
- do not change hauler or upgrader caps from this transition window;
- keep E4 strictly `SHADOW` / `SHADOW_EVIDENCE`.


## 2026-10-07 — optimization freeze exit / roadmap resumed through I1

The final stability window before resuming the roadmap is `3760101–3760200`. It completed with `14 PASS / 5 WATCH / 0 FAIL`. Safety and steady-state exit criteria are met:

- no runtime or collector errors;
- CPU/bucket safe;
- dedicated mining `20/20 e/t`;
- `recommendedHarvesterCount = 2` with zero HARVEST WORK deficit;
- latest consumer fallback/waiting/critical pressure `0 / 0 / 0`;
- Health `100 / HEALTHY`;
- Efficiency `EFFICIENT`;
- latest completed E4 window `3760093–3760192` has critical/candidate/slot coverage all `1` and `duplicateReservationTicks = 0`.

This satisfies the agreed exit rule for the long economy/logistics optimization phase. Future tuning should be driven by concrete regressions exposed by roadmap work rather than by eliminating every WATCH or chasing marginal steady-state gains.

Roadmap work resumed immediately:

### PR #86 — P0 Shared Cost Field

- added normalized movement profiles;
- shared Room CostMatrix construction;
- road preference, hard blockers, planned-road/structure overlays;
- stationary work-tile, congestion, creep, hostile and keeper penalties;
- no current movement authority changed;
- dedicated P0 regression suite passed.

### PR #87 — P1 Hierarchical Route Cache

- added versioned world/room-graph route caching;
- added profile-aware in-room PathFinder cache using P0 cost fields;
- compact local path serialization;
- TTL/bounded pruning;
- room/hostile invalidation;
- stuck feedback invalidation;
- route confidence from intel confidence;
- current legacy movement remains authoritative;
- P0 and P1 suites are now included in canonical `npm test`.

### PR #88 — I1 Autonomous Scout Frontier SHADOW

- added a bounded frontier derived from owned-room + known I0 topology;
- unknown rooms are not recursively expanded until actual intel exists;
- Value-of-Information scoring covers unknown/stale state, threat uncertainty, depth, source value, route connectivity, existing remote/expansion scores and observer availability;
- publishes bounded `SCOUT_INTEL` requests into the E0 registry with authority `SHADOW`;
- fresh I0 intel automatically reconciles those requests to `SATISFIED`;
- `SCOUT_INTEL` is explicitly excluded from E1 generic assignment so deliberate shadow scouting demand does not pollute assignment evidence;
- room heartbeat now exposes a compact `scoutingFrontier` summary;
- legacy `role.scout` target selection and movement remain authoritative.

Exact branch regression coverage passed before merge for I1 frontier scoring, request lifecycle, existing request-shadow behavior, assignment isolation and room-heartbeat telemetry.

Current roadmap position:

- K0 capability discovery: present;
- K1 CPU scheduler: present;
- O1 colony/universal state foundation: present;
- I0 world intel: present;
- E0/E1/E2/E3/E4: present in SHADOW / SHADOW_EVIDENCE as documented;
- P0: merged;
- P1: merged;
- I1: merged in SHADOW, awaiting first live telemetry validation.

Current stop rule after PR #88:

- deploy current `main` before starting the next runtime slice;
- require normal smoke/safety checks to remain green;
- verify `scoutingFrontier.authority = SHADOW`, bounded request count, sensible top frontier rooms and automatic request closure when intel becomes fresh;
- verify E1 assignment/request evidence is not inflated by `SCOUT_INTEL`;
- legacy scout behavior must remain unchanged;
- after I1 live validation, continue the roadmap with P2/P3 planner + defense-perimeter foundations rather than returning to general economy tuning.

## 2026-10-07 — I1 contract completion / canonical CI (#90)

PR #90 closes the remaining explicit I1 test-contract gaps after the functional SHADOW slice in PR #88.

Additional regression coverage now explicitly verifies:

- stale-only frontier demand;
- threat uncertainty increasing both scout priority and urgency;
- hard `maxDepth` and `maxRequests` bounds;
- deterministic equal-score ordering;
- source/target/domain/kind/capability/shadow request fields;
- `request.shadow` publication into the E0 scouting domain and `scoutingFrontier` summary;
- E1 request/unfilled evidence remaining unchanged by `SCOUT_INTEL`.

PR #90 also adds `.github/workflows/npm-test.yml`, which runs the canonical `tools/package.json` `npm test` script with Node `24.21.0` on pull requests and pushes to `main`.

Validation:

- exact tested PR head: `bdbb54e7f2f249f665a168835bb76a94ab5c5ffd`;
- pull-request workflow run `37672079001`: completed / success;
- GitHub Check-Run `test`: completed / success;
- Classic Statuses: none;
- no review threads and no `CHANGES_REQUESTED`;
- PR #90 merged with merge method `merge`;
- merge SHA: `767fdc85d597bbb49cedfa19ddd45a8c401acab5`;
- post-merge `main` Check-Run `test`: completed / success.

No gameplay code, movement authority, spawn policy, CPU threshold, or E4 authority changed in PR #90.

Current stop rule remains unchanged:

- deploy current `main` before starting the next runtime slice;
- verify I1 live telemetry remains `SHADOW`, bounded, sensible and self-closing when intel becomes fresh;
- verify E1 evidence is not inflated by `SCOUT_INTEL`;
- keep legacy `role.scout` authoritative;
- keep E4 strictly `SHADOW` / `SHADOW_EVIDENCE`;
- after I1 live validation, continue with P2/P3 planner + Min-Cut foundations rather than returning to general economy tuning.

## 2026-10-07 — I1 live SHADOW gate

Post-deploy smoke window `3761445–3761469` completed with `9 PASS / 0 WATCH / 0 FAIL`:

- Node `24.21.0`;
- exact bot version `0.3.0-shadow.8-node24`;
- no runtime or collector errors;
- CPU/bucket safe;
- mining active;
- no hard stall;
- telemetry continuity intact.

The dedicated I1 live verifier then evaluated `3761445–3761544`:

- `4 PASS / 2 WATCH / 0 FAIL`;
- `scoutingFrontier.authority = SHADOW` in every observed heartbeat;
- frontier count/request count/depth/top-request telemetry remained within contract bounds;
- E0 `byDomain.scouting` stayed synchronized with I1 request count;
- latest frontier had `frontierCount = 19`, bounded `requestCount = 6`, `maxDepth = 3`;
- top frontier candidates were stale/threat-uncertain rooms and scored consistently with I1 Value-of-Information inputs;
- no live request-closure transition occurred inside this 100-tick sample;
- no live transition isolated a scouting-demand change while non-scout E1 inputs were otherwise stable.

The two WATCH results are observational gaps, not failures. Static regression coverage already proves fresh-intel reconciliation and hard exclusion of `SCOUT_INTEL` from E1 `requestAssignable()`. I1 therefore passes its initial SHADOW live gate without authority promotion.

The adjacent general live window `3761445–3761544` completed `12 PASS / 7 WATCH / 0 FAIL`. Safety checks remained green. WATCH findings were cadence/optimization evidence gaps (productive attribution alignment, temporary consumer waiting/critical state without fallback, unavailable exact-window progress/throughput fields, Efficiency WATCH, and incomplete exact-window E4 evidence), not regressions attributable to I1.

Decision:

- I1 remains strictly `SHADOW`;
- legacy `role.scout` remains authoritative;
- no scout authority promotion is allowed from this evidence;
- E4 remains strictly `SHADOW / SHADOW_EVIDENCE`;
- no CPU thresholds or economy/logistics tuning changes are justified;
- roadmap may proceed to P2 Planner VNext in SHADOW mode.

## 2026-10-07 — P2 Planner VNext SHADOW foundation

PR #94 implements the first P2 Planner VNext slice without changing construction authority.

P2 now provides:

- deterministic candidate anchors derived from spawn/controller/source/mineral geometry;
- two core-layout variants (`CORE_COMPACT`, `CORE_BALANCED`);
- future-structure slots tagged with `earliestCapability`;
- extension and whole-plan feasibility scoring;
- openness, source logistics, upgrade logistics, legacy-spawn continuity, tower coverage and traffic objectives;
- P1-backed in-room route costs;
- a hard path-search budget with deterministic geometric fallback;
- bounded planner persistence and compact `STATUS_SNAPSHOT.plannerVNext` telemetry;
- K1 execution as an `OVERFLOW` process so P2 yields under CPU pressure.

Safety invariants:

- `plannerVNext.authority = SHADOW`;
- legacy `game/room.planner.js` remains authoritative and unchanged;
- P2 never calls `createConstructionSite()`;
- no movement, scouting, spawn, economy/logistics, CPU-threshold or E4 authority changes;
- P3 Min-Cut remains explicitly unimplemented.

Exact offline validation for PR #94:

- tested head `0595e39c1d7143618cf5daf855c6dd30ca692199`;
- canonical `npm test`: success;
- PR merged with merge method `merge`;
- merge SHA `2ab422dfcfcc803da88ec231193dba74b6a8de7b`;
- post-merge `main` canonical test: success.

PR #95 adds a read-only P2 live verifier:

- `npm run verify:p2 -- --start-tick <tick>`;
- checks SHADOW/legacy authority, READY plan status, candidate/path-budget/feasibility contracts, P1 exact-route evidence, independent scheduler telemetry and plan freshness;
- tooling only; no runtime/game authority change;
- merge SHA `ac602bd0189c91d7adbb79be1e26bec55cda9d75`;
- post-merge `main` canonical test: success.

Current stop rule:

- deploy current `main`;
- require the normal 25-tick smoke gate to remain green;
- collect a complete 100-tick general live window;
- run the dedicated P2 live verifier on the same deployment window;
- require P2 to remain `SHADOW`, legacy planner authority `UNCHANGED`, a valid `READY` selected plan, bounded path/candidate counts and sane feasibility scores;
- prefer exact P1 route evidence; geometric-only fallback is WATCH, not automatic promotion evidence;
- do not start P3 Min-Cut or promote P2 authority until the P2 live gate is reviewed;
- E4 remains strictly `SHADOW / SHADOW_EVIDENCE`.

## 2026-10-07 — P2 live SHADOW gate

Deployment smoke window `3761879–3761903` passed with `9 PASS / 0 WATCH / 0 FAIL`.

The complete 100-tick general live window `3761879–3761978` completed with `13 PASS / 6 WATCH / 0 FAIL`:

- no runtime or collector errors;
- CPU/bucket safe;
- dedicated mining active;
- no hard stall;
- durable telemetry contiguous;
- hauler capacity sufficient;
- no consumer fallback/waiting/critical pressure;
- K0/K1/I0 platform telemetry present;
- VNext authority remained shadow/evidence-only.

The remaining general WATCH findings were evidence cadence/optimization observations only: productive-flow window alignment, unavailable exact-window controller/construction/throughput values, Efficiency WATCH, and E4 exact-window evidence alignment.

The dedicated P2 verifier completed `7 PASS / 0 WATCH / 0 FAIL` for the same window:

- `plannerVNext.authority = SHADOW`;
- legacy planner authority remained `UNCHANGED`;
- P2 produced a valid `READY` plan;
- candidate/evaluated counts, path budget, objective scores and feasibility contracts were valid;
- exact P1-backed in-room route evidence was used;
- `planner-vnext-shadow` remained an independent scheduler process;
- plan freshness was valid.

Observed selected P2 candidate:

- anchor `E8N1 (20,29)`, source `CENTROID_OFFSET_6`;
- variant `CORE_BALANCED`;
- score `83.58`;
- extension feasibility `0.806`;
- whole-plan feasibility `0.808`;
- `criticalBlocked = 0`;
- source average route cost `14.5`;
- controller route cost `5`;
- exact route count `4`, fallback route count `0`.

Observed P2 scheduler cost:

- first run CPU `17.485`;
- process class remains `OVERFLOW`;
- minimum interval remains 100 ticks;
- no safety/bucket failure occurred.

Decision:

- P2 passes its initial SHADOW live gate;
- P2 remains SHADOW; no construction authority promotion;
- legacy `game/room.planner.js` remains authoritative;
- the 17.485 CPU planner sample is retained as an optimization target and must not be hidden by threshold changes;
- roadmap may proceed to P3 Min-Cut Defense Perimeter in SHADOW mode;
- P3 must consume economic topology first, generate versioned defensive artifacts, evaluate rampart count/repair burden/tower coverage/breach routes/exit exposure/traffic crossings, and remain non-authoritative;
- E4 remains strictly `SHADOW / SHADOW_EVIDENCE`.

## 2026-10-07 — P3 Min-Cut SHADOW pending live

P2 passed its initial live SHADOW gate before P3 work began:

- P2 verifier window `3761879–3761978`: `7 PASS / 0 WATCH / 0 FAIL`;
- general live window: `13 PASS / 6 WATCH / 0 FAIL`;
- P2 remained `SHADOW`, legacy planner authority remained `UNCHANGED`;
- selected P2 plan was `CORE_BALANCED` at `E8N1 (20,29)`, score `83.58`;
- exact P1 route evidence was present;
- observed first P2 scheduler cost was `17.485 CPU`, retained as an optimization target with no threshold relaxation.

PR #99 implements P3 Min-Cut Defense Perimeter in strict SHADOW mode.

P3 now:

- consumes the READY P2 economic/core topology;
- retains exact P1 route geometry inside internal P2 artifacts for traffic-crossing evaluation;
- builds a bounded 8-neighbor tile graph with node splitting;
- computes an s-t Min-Cut between protected P2 assets and the outside defense boundary;
- uses weighted cut capacity to prefer existing ramparts and avoid traffic crossings;
- independently flood-checks the resulting cut for residual breach routes;
- groups rampart candidates;
- evaluates rampart count, repair burden, tower coverage, breach resistance, exit exposure and traffic crossings;
- stores versioned SHADOW artifacts and compact telemetry;
- records phase evidence for protected-topology build, Min-Cut, and defense scoring.

P3 safety invariants:

- `authority = SHADOW`;
- `constructionAuthority = NONE`;
- legacy `game/room.planner.js` remains authoritative and unchanged;
- P3 never calls `createConstructionSite()`;
- P3 executes only as a K1 `OVERFLOW` process;
- P3 is prohibited from running in the same tick as a freshly computed P2 plan;
- defense graph area is bounded to 900 tiles;
- Min-Cut augmentation count is bounded;
- no CPU thresholds, economy/logistics behavior, movement/scouting authority, or E4 authority changed.

Exact offline validation for PR #99:

- tested head `1ca4887820659f62eb62dc0b67411341790a81bc`;
- canonical `npm test`: success;
- Check-Run: success;
- Classic Statuses: none;
- review threads: none;
- `CHANGES_REQUESTED`: none;
- merge method: `merge`;
- merge SHA `69aefe2cfbb7f6d4189337f1f65c1fb4fbc22397`;
- post-merge `main` canonical test: success.

PR #100 adds the read-only P3 live verifier:

- `npm run verify:p3 -- --start-tick <tick>`;
- validates SHADOW/construction/legacy authority;
- requires a READY defensive cut;
- validates graph/cut/breach/scoring contracts;
- validates P2→P3 dependency ordering;
- validates independent scheduler evidence;
- isolated P3 scheduler CPU: PASS at or below 10, WATCH above 10, FAIL above 20;
- validates artifact freshness;
- tooling only, with no runtime/game authority change;
- merge SHA `24c563122200355aeeba9dd5faab3e3fbe925076`;
- post-merge `main` canonical test: success.

Current stop rule:

- deploy current `main`;
- require the normal 25-tick smoke gate to remain green;
- collect a complete 100-tick general live window;
- run `verify:p2` and `verify:p3` over the same deployment window;
- require P2 to remain SHADOW and READY;
- require P3 to remain SHADOW with `constructionAuthority = NONE`, legacy planner `UNCHANGED`, graph complete, `breachRouteCount = 0`, valid scoring, and correct P2→P3 ordering;
- P3 isolated CPU above 10 is an optimization WATCH and above 20 is a hard FAIL;
- do not promote P2/P3 construction authority from this release;
- do not start the next roadmap slice until P3 live evidence is reviewed;
- E4 remains strictly `SHADOW / SHADOW_EVIDENCE`.

## 2026-10-07 — P3 first live attempt / CPU headroom mitigation

Deployment smoke window `3762415–3762439` passed with `9 PASS / 0 WATCH / 0 FAIL`.

The first P3 deployment window then produced useful partial evidence before the requested 100-tick window was complete:

- general live verification reported no runtime or collector failures, mining active, no hard stall, contiguous durable telemetry and adequate hauler capacity;
- the general live gate hit one hard CPU safety failure at tick `3762500`: total measured tick CPU `21.362` with bucket still `10000`;
- P2 completed `7 PASS / 0 WATCH / 0 FAIL`;
- P3 completed `7 PASS / 1 WATCH / 0 FAIL`.

Observed P2 evidence:

- `authority = SHADOW`;
- legacy planner authority remained `UNCHANGED`;
- selected plan remained `CORE_BALANCED` at `E8N1 (20,29)`, score `83.58`;
- exact P1-backed routes were present;
- latest observed P2 plan tick was `3762479`;
- latest isolated P2 scheduler cost was `19.297 CPU`, EMA `12.849`;
- P2 remains an OVERFLOW-only optimization target and no verifier/scheduler threshold was relaxed.

Observed P3 evidence:

- `authority = SHADOW`;
- `constructionAuthority = NONE`;
- legacy planner authority remained `UNCHANGED`;
- P3 status was `READY`;
- plan tick `3762415`, source P2 tick `3762379`;
- graph area `361`, `252` walkable tiles, `29` augmentations, complete Min-Cut;
- `28` rampart candidates in `4` groups;
- `breachRouteCount = 0`, `exposedAssetCount = 0`;
- planned tower count `4`, minimum and average coverage score `100`;
- defense score `74.8`;
- isolated P3 scheduler cost `9.846 CPU`;
- phase costs: protected topology `1.554`, Min-Cut `6.755`, defense scoring `1.093`;
- the single P3 WATCH was dependency freshness only: P3 had consumed an older valid P2 plan while the newer P2 snapshot was already visible.

CPU profile for failing tick `3762500`:

- total CPU `21.362`;
- attributed scheduler sections `15.565`;
- unattributed `5.758`;
- `rooms = 11.773`;
- `creeps = 3.736`;
- `main.bootstrap = 5.613`;
- `room.capacity-spawn = 2.392`;
- `room.assignment = 2.540`;
- `room.colony-state = 1.654`;
- `room.planner = 1.553`;
- `room.requests = 0.992`;
- `room.logistics-match = 0.969`;
- P2 and P3 did not run on the failing tick.

Interpretation:

- the live failure is not a P3 Min-Cut failure;
- the failing tick combined high first-Memory/bootstrap cost with normal per-room SHADOW planning and authoritative room/creep work;
- the legacy room planner contributed `1.553 CPU` but was not the dominant cause;
- threshold relaxation or moving work merely off heartbeat ticks is explicitly rejected.

PR #102 adds a behavior-neutral SHADOW CPU-headroom guard:

- exact tested PR head `4231cd5a213636ca9b66f58bd1aa200e17e516bd`;
- canonical PR `npm test`: success;
- merge method: `merge`;
- merge SHA `e907778744b78c3a7fb3f515dd68e13f27f9e989`;
- post-merge `main` canonical test: success;
- configured `SHADOW_CPU_RESERVE = 8`;
- E2 capacity-spawn, E1 assignment and E4 logistics matching use existing profiler avg/last CPU observations plus a 15% estimate margin;
- once projected SHADOW work would consume reserved current-tick headroom, the remaining optional SHADOW stages return their existing `deferredSnapshot` with reason `CPU_HEADROOM`;
- deferral is cascading for the current room/tick;
- request production, colony state, legacy spawn/planner, creep execution, economy/logistics authority, P2/P3 authority and all live verifier thresholds remain unchanged;
- E4 remains strictly `SHADOW / SHADOW_EVIDENCE`.

Revalidation stop rule:

- deploy `main` at or after `e907778744b78c3a7fb3f515dd68e13f27f9e989`;
- require a new 25-tick smoke gate with no FAIL;
- collect a fresh complete 100-tick live window;
- run general live, P2 and P3 verifiers over the exact same deployment window;
- require no hard general CPU/bucket failure;
- CPU-headroom deferrals are acceptable only as explicit SHADOW evidence and must not suppress authoritative gameplay;
- require P2 to remain SHADOW/READY with legacy planner unchanged;
- require P3 to remain SHADOW/READY with construction authority NONE, graph complete and zero breach routes;
- review P3 dependency freshness again after the new P2 artifact is visible;
- do not begin the next roadmap slice or promote P2/P3 authority until this revalidation is complete.

## 2026-10-07 — P3 SHADOW live gate passed

Revalidation deployment after the SHADOW CPU-headroom mitigation completed successfully.

Smoke gate:

- window `3762764–3762788`;
- `9 PASS / 0 WATCH / 0 FAIL`;
- Node `24.21.0`;
- runtime/collector health, CPU/bucket, mining, hard-stall and telemetry continuity all passed.

Complete 100-tick live window:

- window `3762764–3762863`;
- general verifier: `12 PASS / 7 WATCH / 0 FAIL`;
- P2 verifier: `7 PASS / 0 WATCH / 0 FAIL`;
- P3 verifier after cadence-safe dependency fix: `8 PASS / 0 WATCH / 0 FAIL`.

General live hard-safety result:

- window complete;
- no runtime errors;
- no collector errors;
- CPU and bucket stayed within safety thresholds;
- mining remained active;
- no hard spawn/economy stall;
- durable telemetry remained contiguous;
- modeled hauler capacity passed;
- K0/K1/I0 telemetry remained present;
- VNext authority remained shadow/evidence-only.

Remaining general WATCH findings are non-safety evidence/optimization observations only:

- productive-flow window cadence does not align exactly with the deployment-relative window;
- consumer self-supply fallback occurred;
- exact-window controller progress unavailable;
- exact-window construction progress unavailable;
- exact-window productive throughput unavailable;
- Efficiency reported `UNDERUTILIZED`;
- E4 matching evidence did not align exactly with the requested window.

These findings do not justify blind economy/logistics tuning; the previously frozen optimization rule remains in force unless a real regression is demonstrated.

P2 result:

- `authority = SHADOW`;
- legacy planner authority remained `UNCHANGED`;
- plan status `READY`;
- selected `CORE_BALANCED` at `E8N1 (20,29)`;
- score `83.58`;
- feasibility `0.808`, extension feasibility `0.806`, `criticalBlocked = 0`;
- exact route count `4`, fallback route count `0`;
- latest observed plan tick `3762779`;
- isolated planner CPU `10.797`, EMA `11.26`;
- P2 remains SHADOW and does not gain construction authority.

P3 result:

- `authority = SHADOW`;
- `constructionAuthority = NONE`;
- legacy planner authority remained `UNCHANGED`;
- status `READY`;
- graph complete;
- `breachRouteCount = 0`;
- `exposedAssetCount = 0`;
- `28` rampart candidates in `4` groups;
- planned tower minimum/average coverage score `100`;
- defense score `74.8`;
- isolated P3 CPU `9.846`;
- plan freshness passed;
- scheduler isolation passed;
- P2→P3 dependency ordering passed.

PR #104 corrected a read-only verifier false positive caused by P2/P3 cadence mismatch:

- P2 may refresh every 100 ticks while P3 runs every 500 ticks;
- a later STATUS_SNAPSHOT may legitimately contain a newer P2 plan than the source consumed by the earlier P3 run;
- the verifier still hard-fails invalid same-tick/newer-than-observed dependency ordering;
- exact PR head `bd712a5245d55808c043d12ed2be43638b784cca`;
- merge SHA `def25c9e1bf0ad634a052214f1d40ffa08e82ddb`;
- canonical PR and post-merge tests succeeded;
- tooling only, with no runtime/scheduler/authority/threshold change.

Decision:

- P3 passes its initial SHADOW live gate;
- the prior CPU revalidation stop rule is satisfied;
- P2 and P3 remain strictly non-authoritative for construction;
- legacy `game/room.planner.js` remains authoritative;
- E4 remains strictly `SHADOW / SHADOW_EVIDENCE`;
- no CPU/live-verifier threshold is relaxed;
- the next roadmap slice is I2 — Remote ROI, because I2 depends on I0 and is now unblocked, while D1 still requires D0 + P3;
- I2 must start in SHADOW/evidence-only mode and must not enable remote mining or create remote execution authority from its first release.

## 2026-10-07 — I2 Remote ROI SHADOW pending live

P3 passed its initial SHADOW live gate before I2 work began:

- complete deployment window `3762764–3762863`;
- general live verifier: `12 PASS / 7 WATCH / 0 FAIL`;
- P2 verifier: `7 PASS / 0 WATCH / 0 FAIL`;
- P3 verifier: `8 PASS / 0 WATCH / 0 FAIL`;
- CPU/bucket, runtime health, collector health, mining, hard-stall safety and telemetry continuity remained green;
- P2 and P3 remain non-authoritative and legacy planning remains unchanged.

PR #106 implements I2 — Remote ROI in strict SHADOW/evidence-only mode.

I2 now:

- discovers only known I0 frontier rooms within bounded depth; unknown rooms remain I1 scouting responsibility;
- requires fresh RoomIntel before economic evaluation;
- rejects owned, occupied, foreign-reserved, source-less and unsupported room-status candidates;
- uses the P1 world-route cache for route feasibility;
- bounds route depth before economic scoring;
- computes expected gross source income;
- separately accounts for miner amortized spawn cost, hauling amortized spawn cost, reservation cost, infrastructure cost, repair cost, travel loss, expected hostile loss and CPU opportunity cost;
- computes confidence-adjusted net energy per tick and a normalized ROI score;
- publishes RemoteAsset-style recommendations only as `CANDIDATE`, `SUSPENDED` or `THREATENED`;
- stores per-home compact remote-score evidence in WorldIntel;
- persists a bounded I2 SHADOW artifact for live verification.

I2 safety invariants:

- `authority = SHADOW`;
- `activationAuthority = NONE`;
- `ENABLE_REMOTE_MINING = false` remains unchanged;
- no candidate may become `ACTIVE` from I2;
- I2 creates no spawn, creep, logistics, claim or construction authority;
- legacy remote/gameplay execution remains unchanged;
- I2 runs only as K1 `OVERFLOW`;
- minimum interval is `PLANNER_INTERVAL * 5 = 250` ticks;
- freshness requirement is `PLANNER_INTERVAL * 20 = 1000` ticks;
- I2 is explicitly prevented from running on a tick where P2 or P3 actually ran;
- no general live CPU threshold or scheduler bucket threshold was relaxed.

Exact offline validation for PR #106:

- tested head `3bd5e988de1bacc7cd371bacb66fcc80bb4b5697`;
- canonical GitHub `npm test`: success;
- merge method: `merge`;
- merge SHA `a34dc53175956a1600760e962e08c24a42841b52`;
- post-merge `main` canonical test: success.

PR #107 adds the read-only I2 live verifier:

- command: `npm run verify:i2 -- --start-tick <tick>`;
- validates I2 STATUS_SNAPSHOT evidence;
- requires `SHADOW`, `activationAuthority = NONE`, and remote mining disabled;
- requires a READY I2 artifact;
- validates candidate/ready/viable/recommended count ordering and compact candidate contracts;
- hard-fails any `ACTIVE` recommendation;
- records whether at least one real candidate was observed;
- validates independent `remote-roi-shadow` scheduler evidence;
- isolated I2 CPU diagnostic thresholds: PASS at or below 5, WATCH above 5 through 10, FAIL above 10;
- validates I2 artifact freshness;
- tooling only; no runtime authority or gameplay behavior change.

Exact offline validation for PR #107:

- tested head `304e4060cc3329bfe08708e623371f81b99c9477`;
- canonical GitHub `npm test`: success;
- merge method: `merge`;
- merge SHA `8ec8725fbeb1b18b253e4c39f8cf44f1ab6e63a9`;
- post-merge `main` canonical test: success.

Current stop rule:

- deploy current `main`;
- require a new 25-tick smoke gate with zero FAIL;
- collect a complete 100-tick live window;
- run `verify:live`, `verify:p2`, `verify:p3` and `verify:i2` over the same deployment window;
- require no hard general runtime/collector/CPU/bucket/mining/stall/telemetry failure;
- require P2 to remain SHADOW/READY and legacy planner authority `UNCHANGED`;
- require P3 to remain SHADOW/READY with `constructionAuthority = NONE`, graph complete and zero breach routes;
- require I2 to remain `SHADOW`, `activationAuthority = NONE`, `remoteMiningEnabled = false`, and READY;
- require I2 candidate/count contracts to remain valid and no `ACTIVE` remote recommendation;
- require independent I2 scheduler evidence;
- isolated I2 CPU above 5 is an optimization WATCH and above 10 is a hard I2 FAIL;
- a `candidate-observation` WATCH is acceptable only as evidence that no known remote candidate existed in that window; it does not authorize activation or justify inventing a target;
- do not enable remote mining or create remote execution authority from this release;
- do not start the next major roadmap slice until I2 live evidence is reviewed;
- E4 remains strictly `SHADOW / SHADOW_EVIDENCE`;
- P2/P3 remain non-authoritative for construction.

## 2026-10-07 — I2 evidence reviewed; D0.1 prepared

Source baseline: `796fb1d` (PR #110). Read-only server comparison confirmed all
49 deployed runtime modules matched this baseline, apart from the injected
deployment ID. Existing deployment: `20261007213851193-15588`.

- Smoke `3763951–3763975`: 9 PASS / 0 WATCH / 0 FAIL.
- General live `3764001–3764100`: 12 PASS / 7 WATCH / 0 FAIL.
- P2/P3/I2 were also evaluated on `3764001–3764100`: zero FAIL.
- I2 produced a viable E9N1 candidate and remained SHADOW/NONE with mining disabled.
- Existing general WATCH findings do not authorize changes to economic thresholds.

D0.1 candidate `0.3.0-shadow.9-node24` adds bounded threat observations and a
read-only D0 verifier. Full offline regression passes on Node 24.21.0. See
`docs/D0_THREAT_MODEL_SHADOW.md` for implemented behavior and explicit limitations.
This is not completion of D0, D1, or the overall autonomy roadmap.


## 2026-10-08 — D0.1 initial SHADOW live window verified

Runtime source head: `25167a5182b41432486a9724661ef0e7c32b6538`.
Deployment: `20261007215630456-4492`, version `0.3.0-shadow.9-node24`.
All 50 server modules matched the tested source after deployment ID normalization.

- Smoke `3764254-3764278`: 9 PASS / 0 WATCH / 0 FAIL.
- General live `3764254-3764353`: 13 PASS / 6 WATCH / 0 FAIL.
- P2 on that same 100-tick window: 7 PASS / 0 WATCH / 0 FAIL.
- P3: 8 PASS / 0 WATCH / 0 FAIL.
- I2: 9 PASS / 0 WATCH / 0 FAIL.
- D0: 6 PASS / 1 WATCH / 0 FAIL. No armed hostile was observed.
- D0 snapshot tick 3764300: READY / NORMAL, SHADOW / NONE, 0.021 isolated CPU.
- Offline full npm test and GitHub Actions tests passed.

Append-only machine-readable evidence: `docs/verification/d0-1-shadow-live.json`.
The general WATCH findings concern window alignment, unavailable exact-window
productive metrics, and UNDERUTILIZED efficiency. They are not permission to
relax gates. D0.1 remains observational; combat fixtures do not constitute live
combat validation. Continue with D0 path/barrier and coordinated-attack modeling
before any authoritative D1 migration.

## 2026-10-08 — D0.2 candidate prepared

D0.1 merged as PR #111 (`2978c17e1481c7f8543cc6085f4f25c1d1b8f6c2`).
Candidate `0.3.0-shadow.10-node24` adds bounded breach-route estimates and
piecewise coordinated-attack damage. Covering rampart hits are charged once per
asset; an attacker is credited only after its estimated arrival. Matrix costs
may saturate, but reported breach delay always uses actual barrier HP. Mineral
positions remain blocked. Four total PathFinder calls per room remain the cap.

Schema-2 compact telemetry exposes breach paths, coordinated assets and loss
estimates. Breach-route scenarios remain PARTIAL because bounded route search
and independently estimated route breaches are not an optimal tactical solver.
No gameplay or Safe Mode authority changes. Full offline regression passes on
Node 24.21.0; deployment and exact new live evidence are pending.

## 2026-10-09 — D0.2 deployment-boundary review

Continued the current D0.2 candidate on PR #112 rather than starting D1 before
the pending live gate. Fixed the D0 verifier's early version filter: deployment
markers from other or missing versions now remain visible to the boundary check.
A different deployment on the first or last window tick also rejects the window.
Content-based event deduplication preserves distinct events when journal sequence
numbers restart; foreign-version rows cannot satisfy window completion.

CLI regression fixtures cover clean and duplicate evidence, reused journal
sequences, same-version/other-version/unversioned replacement deployments at
both boundaries and mid-window, harmless markers outside the window, and
foreign-version completion evidence. No game modules or release identity change.
Full `npm test` passes on Node 24.21.0, including all 50 game-module syntax checks.
D0.2 deployment and exact new live evidence remain pending; no historical live
evidence is promoted to the new candidate and no gameplay authority is granted.

## 2026-10-09 — D0.2 exact live SHADOW evidence reviewed

Installed candidate `0.3.0-shadow.10-node24` was observed with local Node
`24.21.0`. Read-only live verifiers yielded:

- Smoke `3802115–3802139`: 9 PASS / 0 WATCH / 0 FAIL.
- General live `3802201–3802300`: 12 PASS / 7 WATCH / 0 FAIL.
- D0 `3802115–3802214`: 6 PASS / 1 WATCH / 0 FAIL.
- P2 same D0 interval: 7 PASS / 0 WATCH / 0 FAIL.
- P3 same D0 interval: 8 PASS / 0 WATCH / 0 FAIL.
- I2 same D0 interval: 9 PASS / 0 WATCH / 0 FAIL.

D0 shadow authority, schema-2 model contracts, independent current-tick CPU
attribution and <=5 isolated CPU passed. No armed hostile appeared:
`combat-observation` is WATCH, not simulated live validation.

General live safety gates (versions, errors, collector, CPU/bucket, mining,
stall, telemetry continuity, hauler capacity and shadow authority) passed.
The seven WATCH observations concern cadence-aligned productive attribution,
consumer waiting/critical with fallback zero, missing exact-window controller,
construction and throughput metrics, UNDERUTILIZED efficiency, and incomplete
exact-window E4 matching evidence. P2 isolated CPU last reported 12.293 and
is a monitoring concern, not a recorded P2 verifier failure.

Append-only report: `docs/verification/d0-2-shadow-live-0.3.0-2026-10-09.md`.
The provided CLI transcript did not include the raw logs, deployment receipt ID
or a full server module-content comparison. The exact-receipt D0 verifier
completed successfully; do not extrapolate beyond that.

Release disposition: shadow-only incremental D0.2 evidence is acceptable for
merge with overall WATCH and zero FAIL, subject to GitHub CI/merge requirements.
No Safe Mode, tower/spawn, remote activation, construction or other gameplay
authority promotion follows from this result. D0 and combat modeling remain
partial. D1 stays blocked until its separate roadmap gates are satisfied.


## 2026-10-09 — D0.3 range-aware focused-loss SHADOW candidate

D0.2 merged via PR #112 at `bbf60ffbfb72733ee1e4417bbcccef9660caadce`.
Its recorded `shadow.10` D0/related live gates had zero FAIL, but D0 remained
WATCH without real armed-hostile observation; D1 stayed blocked.

This next narrow candidate is `0.3.0-shadow.11-node24`. A mixed
ATTACK/WORK + RANGED_ATTACK hostile previously combined close and ranged DPS
already from range 3. D0 now separately estimates range-3 ranged access and
range-1 melee/dismantle access, including their different arrival times. Both
channels may contribute when actually in range, but only one attacker is
counted per creep even if it has two active damage channels. Unknown close
access remains explicit PARTIAL. All channels retain the shared maximum four
PathFinder searches at 200 operations each per room.

Regression tests cover range-2/3 undercount/overcount boundary, a proven later
range-1 arrival, one dual-weapon creep vs two actual hostile creeps, and a
dual-mode hostile group exhausting the unchanged path budget.

No intent/authority, spawn, tower, Safe Mode, remote mining, construction,
scheduler priority or telemetry schema changes. Route breach coordination and
path optimality remain unsolved. SHADOW only.

Stop rule: new exact shadow.11 deployment and smoke + live + D0 + P2/P3/I2
evidence are required before any acceptance/merge decision. No earlier
shadow.10 live gate proves this new candidate. D1 remains blocked.


## 2026-10-09 — D0.3 range-aware SHADOW live evidence reviewed

Candidate version `0.3.0-shadow.11-node24`, tested runtime/source head
`b738c4ae4c72fc99d590355e2a2af4fbc619baa6`; local verifier Node 24.21.0.
Exact deploy-receipt/marker D0 verifier completed successfully on this version,
but the pasted console outputs did not expose the deployment ID or full server
module-by-module comparison. GitHub canonical `npm test` for the original
source head passed, workflow `37930706194`.

- Smoke `3809946–3809970`: **9 PASS / 0 WATCH / 0 FAIL**.
- General live `3810001–3810100`: **12 PASS / 7 WATCH / 0 FAIL**.
- D0 `3809946–3810045`: **6 PASS / 1 WATCH / 0 FAIL**.
- P2 same D0 interval: **7 PASS / 0 WATCH / 0 FAIL**.
- P3 same D0 interval: **8 PASS / 0 WATCH / 0 FAIL**.
- I2 same D0 interval: **9 PASS / 0 WATCH / 0 FAIL**.

Aggregate: **51 PASS / 8 WATCH / 0 FAIL**, overall WATCH. D0 threat
telemetry, schema-2 contract, SHADOW/NONE authority, isolated scheduler
and <=5 CPU all passed. No armed hostile was observed; D0
`combat-observation` remains WATCH, never a claim of real combat
predictive validity.

General live safety checks stayed green: exact bot/Node version,
no runtime or collector errors, CPU/bucket safe, mining active,
no hard economy stall, telemetry continuity, sufficient modeled
hauler capacity, platform and VNext shadow authority. General WATCH:
productive-window cadence mismatch; waiting/critical consumers but fallback
zero; no exact-window controller/construction/throughput metrics;
Efficiency WATCH; and E4 matching evidence window mismatch.

P2/READY/SHADOW last reported 10.571 isolated CPU, EMA 5.768
(monitor, not a P2 verifier FAIL). P3 READY with no construction
authority and 0 breach routes; I2 READY with remote mining disabled
and no ACTIVE remote activation. None gained authority.

Append-only report:
`docs/verification/d0-3-shadow-live-0.3.0-2026-10-09.md`.

Disposition: all observed hard SHADOW gates pass with zero FAIL;
incremental D0.3 may be accepted as SHADOW-only, with preserved
WATCH findings. No live combat proof, calibrated threat probability,
D0 completion, Safe Mode authority or D1 advancement follows.
**D1 remains blocked.**
