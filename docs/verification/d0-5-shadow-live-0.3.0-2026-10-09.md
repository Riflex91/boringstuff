# D0.5 — six-gate SHADOW live verification for 0.3.0-shadow.13-node24

Date: 2026-10-09  
PR: [#115](https://github.com/Riflex91/boringstuff/pull/115)  
Candidate game/source head at time of deployed build: `f126dd1b4da6729f79db5e506ebfd71718992261`  
Observed runtime version: `0.3.0-shadow.13-node24`  
Node: `24.21.0`  
Room: `E8N1`  
User-supplied deployment ID: `20261009184541935-15132`

**All six read-only verifier command outputs received: 51 PASS / 8 WATCH / 0 FAIL.
Overall outcome WATCH, not PASS; zero hard FAIL.** Live performance
and authority gates are acceptable for consideration of a **SHADOW-only**
merge, not D0 combat validation or D1 enablement.

## Exact verification windows

| Verifier | Tick window | PASS | WATCH | FAIL | Outcome |
|---|---|---:|---:|---:|---|
| Smoke | 3810954–3810978 | 9 | 0 | 0 | PASS |
| General live | 3811001–3811100 | 12 | 7 | 0 | WATCH |
| D0 | 3810954–3811053 | 6 | 1 | 0 | WATCH |
| P2 | 3810954–3811053 | 7 | 0 | 0 | PASS |
| P3 | 3810954–3811053 | 8 | 0 | 0 | PASS |
| I2 | 3810954–3811053 | 9 | 0 | 0 | PASS |
| **Total** | — | **51** | **8** | **0** | **WATCH** |

The smoke window begins at the same tick as D0/P2/P3/I2.
The general-live 100-tick window is offset; it is not identical to
the D0 subsystem window. Both explicitly confirmed the exact
`shadow.13` version.

## Smoke — all nine checks PASS

User-submitted output `VERIFY SMOKE 3810954-3810978: PASS`:
node-version `24.21.0`, exact bot-version `0.3.0-shadow.13-node24`,
window-complete at tick 3810978, no observed runtime errors,
no collector errors, CPU/bucket thresholds satisfied, dedicated
mining active, no hard spawn/economy stall, and durable journal
sequences contiguous.

The 25-tick smoke proves observed release identity and basic live
operational safety; it does not by itself prove individual PathFinder
geometry predictions in live combat.

## General live — 12 PASS / 7 WATCH

Exact `3811001–3811100`. PASS: Node/version, complete live window,
no runtime/collector errors, CPU/bucket safety, mining, no hard stall,
journal continuity, hauler modeled capacity, K0/K1/I0 platform
telemetry and observational VNext authority.

WATCH:
1. Productive-flow fixed cadence did not line up exactly with the live window.
2. Consumer supply: waiting/critical consumers, **zero** self-supply fallback.
3. No exact-window 100-tick controller-progress metric available.
4. No exact-window 100-tick construction-progress metric available.
5. No exact-window productive-throughput metric available.
6. Efficiency status: **UNDERUTILIZED**; optimization warning, no hard fail.
7. E4 matching evidence not yet complete for exact window.

Compared with D0.4 `shadow.12`, the observed economy status
shifted from EFFICIENT to UNDERUTILIZED; those are separate sampled
windows and the difference **cannot be attributed to D0.5** without
more evidence. The missing progress/throughput metrics are unknown,
not evidence of zero progress.

## D0 — 6 PASS / 1 WATCH

Exact `3810954–3811053`. PASS: complete 100-tick evidence,
observed D0 room snapshots, bounded model-contract checks,
SHADOW/no Safe Mode gameplay authority, independent scheduler
evidence and isolated D0 CPU <= 5. D0 telemetry retains schema 3.
WATCH `combat-observation`: no armed hostile was observed in the
peaceful live window. Regression fixtures exercise D0.5's
PathFinder route-integrity rules, but the live results do not
demonstrate those cases in real hostile combat.
The unchanged 4-search / 200-maxOps safeguards are covered by
offline tests and bounded runtime model checks.

## P2 / P3 / I2 — all PASS

- **P2 7/0/0:** READY SHADOW plan in E8N1, (20,29)
  CORE_BALANCED, score 82.4, four exact in-room routes and
  zero route fallbacks. Last isolated scheduler CPU 10.992,
  EMA 6.191; legacy planner authority unchanged.
- **P3 8/0/0:** READY SHADOW min-cut, 28 proposed ramparts,
  0 modeled breach routes, 0 exposed assets, construction authority
  NONE. Last CPU 7.897, EMA 5.506.
- **I2 9/0/0:** READY SHADOW remote ROI, best candidate E9N1
  with *modeled* 6.961 net energy/tick, activation authority NONE,
  remote mining disabled, no ACTIVE remote state. Last CPU 2.02,
  EMA 1.884.

## Deployment and release gate

The user previously supplied successful local Node 24.21.0
`npm test` and `npm run doctor`, and a successful
`npm run deploy` from the correct Screeps world bot directory.
The deploy command reported 50 uploaded runtime modules, branch
`newbieland/chatgpt` active, server version changed from
`shadow.12` to `shadow.13`, server-side verification PASS,
receipt `logs/deployment-receipt-newbieland-chatgpt.json`, and
deployment ID above. SHA-256 checks of the 50 installed game
modules against the downloaded exact source passed.
A surplus `game/sw.js` in the **offline mirror** (51-module local
syntax check) was independently identified, not in the 50-module
runtime upload; the test-mirror cleanup output has not been
provided, but no server-side extra module was reported.

Canonical GitHub Actions `npm test` passed for the original
source candidate head `f126dd1b4da6729f79db5e506ebfd71718992261`
(run `37974851446`). Documentation-only updates in this PR
require subsequent exact-head CI verification before merge.

**Result:** all planned live verifier outputs are present with
no hard fail. A SHADOW-only merge decision may be considered after
exact PR-head CI review and explicit user authorization. Retain
all eight WATCH observations, especially economic underutilization,
consumer waiting/critical and lack of real combat evidence.
No D1 authorization, Safe Mode activation, tower/spawn changes,
construction authority or remote activation. D0 remains
observation-only / `actionAuthority=NONE`.
