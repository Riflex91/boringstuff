# D0.2 — 0.3.0-shadow.10-node24 live-verification evidence

Date: 2026-10-09  
Repository: `Riflex91/boringstuff`  
Pull request: [#112](https://github.com/Riflex91/boringstuff/pull/112)  
Source candidate at time of deployment: `6bc4d3af4bf4ca62fd7dbd005c029420dbd3b4f1`  
Bot version observed: `0.3.0-shadow.10-node24`  
Local Node runtime: `24.21.0`  
Screeps branch: `chatgpt`  
Observed room: `E8N1`  
Evidence: user-supplied PowerShell verifier outputs for this candidate; raw logs, receipt contents and full module-by-module server comparison were **not** supplied with this record.

## Evidence status

**D0.2: WATCH, not PASS.** Every D0 hard contract check passed; live combat was not observed.  
**General live: WATCH, not PASS.** All six verifier invocations reported **zero FAIL**.  
Offline Node 24.21.0 regressions and the 50-module syntax suite were reported successful for the pre-documentation PR head; GitHub Actions `npm test` run 37886089418 completed successfully on `6bc4d3a`.

No actual combat accuracy, earliest-loss optimality, barrier-breach optimality, or authorization of D1/authoritative defense follows from this evidence.

## Verifier results

| Verifier | Tick window | PASS | WATCH | FAIL | Outcome |
| --- | --- | ---: | ---: | ---: | --- |
| `npm run verify:smoke` | 3802115–3802139 | 9 | 0 | 0 | PASS |
| `npm run verify:live` | 3802201–3802300 | 12 | 7 | 0 | WATCH |
| `npm run verify:d0` | 3802115–3802214 | 6 | 1 | 0 | WATCH |
| `npm run verify:p2` | 3802115–3802214 | 7 | 0 | 0 | PASS |
| `npm run verify:p3` | 3802115–3802214 | 8 | 0 | 0 | PASS |
| `npm run verify:i2` | 3802115–3802214 | 9 | 0 | 0 | PASS |
| **Total across checks** | — | **51** | **8** | **0** | **WATCH** |

The general live test used its own complete 100-tick window. P2/P3/I2 and D0 evaluated the common earlier 100-tick interval. These are **not** the same general-live window; do not claim otherwise.

## D0-specific acceptance evidence

The 100-tick D0 window passed:

- `window-complete` — events reached tick 3802214.
- `threat-evidence` — every observed `E8N1` room snapshot contained D0 evidence.
- `shadow-authority` — D0 remained observational, no Safe Mode control.
- `model-contract` — threat counts, strength, current tick, risk states and bounded path work met the schema-2 contract.
- `scheduler-isolation` — `threat-model-shadow` had independent current-tick scheduler evidence.
- `cpu-budget` — the isolated D0 CPU remained <= 5 for observed snapshots.

`combat-observation` is **WATCH**: no armed hostile was observed in this peaceful window. Attack fixtures cover representative cases offline but are not a live fight. The D0 CLI requires the exact matching deployment receipt and `DEPLOYMENT_MARKER`; it rejects crossing a replacement deployment. The verifier's successful run supports this exact-boundary check, but the deployment ID itself is not included in the supplied console transcript.

## General safety and optimization findings

General live window 3802201–3802300 passed: exact bot and Node versions, window completion, no runtime/collector errors, CPU/bucket thresholds, dedicated mining, no hard spawn/economy stall, contiguous durable journal sequences, hauler capacity, K0/K1/I0 telemetry, and VNext shadow authority.

The seven **WATCH** observations were:

1. Productive-flow attribution exists but its fixed cadence does not align exactly to this verifier window.
2. Consumers were waiting/critical, although self-supply fallback remained **zero**.
3. Exact-window 100-tick controller progress metric unavailable.
4. Exact-window 100-tick construction progress metric unavailable.
5. Exact-window productive-throughput metric unavailable.
6. Efficiency `UNDERUTILIZED` (optimization only).
7. E4 matching-evidence window not complete for the exact requested live interval.

These observations cannot be promoted to PASS or used to assert controller, construction, E4, or throughput improvement. No general gate was relaxed.

## Related shadow modules

- **P2: PASS (7/0/0).** READY / SHADOW and unchanged legacy planner authority; selected `CORE_BALANCED` at E8N1 (20,29), score 83.58, exact routes 4 and fallback routes 0. Last reported isolated P2 scheduler CPU **12.293** (EMA 6.787). P2 verifier passed, but this diagnostic merits ongoing CPU observation.
- **P3: PASS (8/0/0).** READY / SHADOW; `constructionAuthority=NONE`, legacy planner unchanged, complete graph, 28 rampart candidates, 0 breach routes, 0 exposed assets, defense score 74.1 and isolated scheduler CPU 4.31.
- **I2: PASS (9/0/0).** READY / SHADOW; `activationAuthority=NONE`, remote mining disabled, no ACTIVE candidate, isolated scheduler CPU 1.852. Two viable recommendations observed, E8N2 and E9N1; both evidence-only.

## Release decision and limits

The deployed D0.2 candidate **meets the observed shadow live safety/contract gate with zero FAIL**, but its overall verification status remains **WATCH** because no live armed attack was observed. Acceptable as a *shadow/evidence-only* incremental merge provided CI and repository merge requirements remain satisfied.

- D0.2 is **not** an authoritative defense rollout; D0 is not complete.
- `AUTO_SAFE_MODE`, legacy tower/spawn/room behavior, remote activation and construction authority remain unchanged.
- The bounded barrier-route and coordinated-arrival model is a scenario estimator, not a calibrated probability, complete battle simulator or proven optimal breach/loss bound.
- Preserve the 7 general-live WATCH findings and the P2 CPU diagnostic; do not silently reclassify them.
- **D1 and any defense authority transition remain blocked** pending the remaining roadmap prerequisites, including appropriate hostile combat validation and defense model work.
- Retain this document as human-readable, append-only evidence; original logs and exact deployment ID were not embedded.
