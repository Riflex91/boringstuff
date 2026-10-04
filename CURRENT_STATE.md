# CURRENT STATE — Screeps: World Autonomous Bot

Canonical repository: `Riflex91/boringstuff`

## Canonical source baseline

- Seed baseline: **v0.2.16-node18**
- Current canonical `main`: **0.3.0-shadow.1-node18** at merge commit `8d368ea110229c3d82572f1f7491d01c48c22578`
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

The first post-live follow-up is now implemented in development, but is **not yet live-verified**:

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
