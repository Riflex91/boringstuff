# D0.5 — partial live verification for 0.3.0-shadow.13-node24

Date: 2026-10-09  
PR: [#115](https://github.com/Riflex91/boringstuff/pull/115)  
Candidate source: `f126dd1b4da6729f79db5e506ebfd71718992261`  
Runtime: `0.3.0-shadow.13-node24` / Node `24.21.0`  
Room: `E8N1`  
Deployment ID from user-provided deploy command: `20261009184541935-15132`

**Evidence status: five of six read-only live verifiers supplied;
42 PASS / 8 WATCH / 0 FAIL, overall WATCH for this partial set.
The 25-tick smoke result is NOT in the provided transcript.**
This record is not full release/merge clearance.

| Verifier | Exact window | PASS | WATCH | FAIL | Result |
|---|---|---:|---:|---:|---|
| General live | 3811001–3811100 | 12 | 7 | 0 | WATCH |
| D0 | 3810954–3811053 | 6 | 1 | 0 | WATCH |
| P2 | 3810954–3811053 | 7 | 0 | 0 | PASS |
| P3 | 3810954–3811053 | 8 | 0 | 0 | PASS |
| I2 | 3810954–3811053 | 9 | 0 | 0 | PASS |
| **Observed subtotal** | — | **42** | **8** | **0** | **WATCH** |
| Smoke | **NOT SUPPLIED** | — | — | — | **UNKNOWN** |

The general-live and D0/P2/P3/I2 windows are **not identical**.
All five covered `shadow.13`; the general live explicitly validates
the exact bot version and Node runtime.

## General live — 12 PASS / 7 WATCH / 0 FAIL

PASS: complete 100-tick window, correct Node/release, no observed bot
or collector errors, safe CPU/bucket, dedicated mining, no hard
spawn/economy stall, contiguous durable jseq, adequate modeled hauler
capacity, K0/K1/I0 telemetry and VNext observational authority.

Seven WATCH findings:

1. Productive-flow fixed runtime cadence does not match the exact verification window.
2. **Consumers waiting/critical but self-supply fallback stayed zero**.
3. Exact-window 100-tick controller-progress metric not available.
4. Exact-window 100-tick construction-progress metric not available.
5. Exact-window productive-throughput metric not available.
6. **Economy efficiency `UNDERUTILIZED`**, optimization warning, not a hard failure.
7. E4 matching evidence incomplete in the exact window.

Compared with `shadow.12` general-live evidence (13 PASS / 6 WATCH /
0 FAIL, `EFFICIENT`), the latest economy classification degraded to
`UNDERUTILIZED`. `shadow.12` had observed self-supply fallback, whereas
`shadow.13` reports zero fallback with waiting/critical consumers.
These are different sampled windows, **not evidence that D0.5 caused
the change**. Missing progress/throughput metrics are not evidence of
zero progress.

## D0 — 6 PASS / 1 WATCH / 0 FAIL

D0 model-contract, independent scheduler attribution and isolated
CPU <=5 PASS; SHADOW/no Safe Mode authority PASS. No armed hostile was
observed. `combat-observation` remains WATCH; the new path-geometry
checks are regression-tested offline but no live hostile-path
validation or real coordinated barrier-breach event was demonstrated.

## P2, P3 and I2

- **P2 7/0/0 PASS:** READY SHADOW plan at anchor (20,29),
  `CORE_BALANCED`, score 82.4, exact P1-backed in-room routes four,
  fallback zero. Isolated last-run CPU **10.992**, EMA **6.191**.
  Prior `shadow.12` last P2 CPU was 15.506 in its different window.
- **P3 8/0/0 PASS:** READY defensive min-cut for E8N1, proposed
  28 ramparts, 0 modeled breach routes, 0 exposed assets. Authority
  SHADOW, `constructionAuthority=NONE`; last CPU 7.897, EMA 5.506.
- **I2 9/0/0 PASS:** READY ROI scenario, `activationAuthority=NONE`,
  `remoteMiningEnabled=false`, no ACTIVE remote state. Best candidate
  E9N1, estimated 6.961 net energy/tick. Last CPU 2.02, EMA 1.884.

## Deployment provenance and stop rule

Previously user supplied successful local `npm test`, `npm run doctor`
and `npm run deploy`: 50 runtime modules uploaded, activeWorld true,
server version changed `shadow.12` -> `shadow.13`, server-side
deployment verification PASS, receipt
`logs/deployment-receipt-newbieland-chatgpt.json`, deployment ID as
above. Local SHA-256 content comparison to source package PASS.
The syntax check's extra local `game/sw.js` was independently
identified in the *offline game mirror*, **not in the 50-module runtime
folder**. Removal/backup was recommended; a post-removal output has
not yet been supplied, but this did not add a runtime module.

GitHub Actions canonical `npm test` on source candidate head
`f126dd1b4da6729f79db5e506ebfd71718992261` passed on Node
24.21.0, run `37974851446` (#64).

**Still outstanding:** new `shadow.13` 25-tick `verify:smoke` result.
Do not claim it passed from the other five results. Confirm only
the same release/receipt-controlled fresh window; do not redeploy
solely to reconstruct missing console output.

**No merge yet.** PR #115 stays draft. D0 remains observational
SHADOW/NONE, D1 blocked, no Safe Mode/tower/spawn/construction/remote
gameplay authority promotion.
