# CURRENT STATE — Screeps: World Autonomous Bot

Canonical repository: `Riflex91/boringstuff`

## Canonical source baseline

- Seed baseline: **v0.2.16-node18**
- Current canonical source baseline before this release prep: `29ad209af552f0a20ea50c0e7c8ad4e32a567e05`
- Release candidate identity: **0.3.0-shadow.7-node18**
- Latest VNext live gate: **WATCH — 15 PASS / 3 WATCH / 0 FAIL**
- Runtime target: **Node.js 18.20.4**
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
