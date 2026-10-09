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

Legacy haulin…12383 tokens truncated…ed first P2 scheduler cost was `17.485 CPU`, retained as an optimization target with no threshold relaxation.

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
