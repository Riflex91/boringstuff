# CURRENT STATE — Screeps: World Autonomous Bot

Canonical repository: `Riflex91/boringstuff`

## Canonical source baseline

- Source baseline: **v0.2.16-node18**
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

## Next release boundary

The next intended release is **v0.2.17-node18 — Live Verification Harness**.

It is a **TOOLS-ONLY / OBSERVABILITY** release. It must not alter colony, spawn, economy, logistics, role, room-planning, or strategic decision behavior.

Intended commands:

- `npm run verify:smoke` — 25-tick safety smoke window.
- `npm run verify:live` — 100-tick performance window.

Expected gate outcomes: `PASS`, `WATCH`, `FAIL`.

Smoke checks should cover runtime version, runtime errors, CPU/bucket, mining active, no hard spawn/economy stall, and telemetry continuity.

Live checks should cover hauler deficit, consumer fallback/critical/waiting, controller/construction progress, productive throughput, telemetry continuity, CPU/bucket, runtime errors, and hard stalls.

Policy:

- `UNDERUTILIZED` alone must not block progression.
- Optimization findings produce `WATCH`.
- Safety/runtime/stall failures produce `FAIL`.
- A behavior release may follow only after smoke and the full 100-tick live gate have passed without hard failure.

A previously reconstructed v0.2.17 candidate existed outside this repository, but it is **not** the canonical original source and must not silently replace this v0.2.16 baseline.

## Current strategic interpretation

`E8N1` is at RCL2 with two sources and both source containers completed. Economy mode is container logistics.

Current verified signals indicate the mining side is no longer the primary bottleneck:

- dedicated/theoretical mining is about `20 e/t`;
- hauling is sufficient;
- consumer starvation is resolved;
- energy is often capped;
- spawn can be idle;
- productive throughput was measured around `14.8 e/t`;
- Efficiency can report `UNDERUTILIZED` while Health remains `HEALTHY`.

Do **not** blindly spawn more creeps from this signal. After v0.2.17 live verification, use fresh telemetry to determine whether the next behavior change should target productive consumer capacity, Builder/Upgrader sizing, dynamic demand, or RCL3/RCL4 transition behavior.

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
