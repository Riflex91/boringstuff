# D0.3 — 0.3.0-shadow.11-node24 live-verification evidence

Date: 2026-10-09  
Repository: `Riflex91/boringstuff`  
Pull request: [#113](https://github.com/Riflex91/boringstuff/pull/113)  
Original tested source head: `b738c4ae4c72fc99d590355e2a2af4fbc619baa6`  
Observed game version: `0.3.0-shadow.11-node24`  
Local verifier Node version: `24.21.0`  
Screeps branch: `chatgpt`  
Primary room: `E8N1`

## Evidence provenance and exact status

This record transcribes the six PowerShell CLI verifier outputs supplied on
2026-10-09 for the installed D0.3 candidate. The output confirms an exact
`0.3.0-shadow.11-node24` version in smoke and general-live windows and a
successful 100-tick D0 receipt/marker-checked verifier run. The source text
did **not** include the actual deployment ID, full collector log archive,
local `npm test` output, `npm run doctor` output, or server-wide source
module-content comparison. Do not assert those extra checks independently.

The exact source head `b738c4a` passed the GitHub Actions canonical test
suite on Node `24.21.0` (workflow `37930706194`, `npm test` job success;
includes 50 game module syntax checks). Subsequent documentation-only commits
must not be represented as a separate runtime deployment.

**Overall WATCH, not PASS. Zero FAIL.** D0 has no live armed-hostile
observation, so the model's combat prediction is not live validated.

## Six verification results

| Verifier | Window (ticks) | PASS | WATCH | FAIL | Outcome |
|---|---|---:|---:|---:|---|
| `npm run verify:smoke` | 3809946–3809970 | 9 | 0 | 0 | PASS |
| `npm run verify:live` | 3810001–3810100 | 12 | 7 | 0 | WATCH |
| `npm run verify:d0` | 3809946–3810045 | 6 | 1 | 0 | WATCH |
| `npm run verify:p2` | 3809946–3810045 | 7 | 0 | 0 | PASS |
| `npm run verify:p3` | 3809946–3810045 | 8 | 0 | 0 | PASS |
| `npm run verify:i2` | 3809946–3810045 | 9 | 0 | 0 | PASS |
| **Total check results** | — | **51** | **8** | **0** | **WATCH** |

The general live verification used a later complete 100-tick window; the
subsystem-specific gates share the earlier 100-tick window. Do **not**
describe all six as the same window.

### D0.3: 6 PASS / 1 WATCH / 0 FAIL

All hard D0 checks passed:

- `window-complete`: evidence reached tick 3810045.
- `threat-evidence`: every observed room snapshot contained D0 evidence.
- `shadow-authority`: D0 remained observational with no Safe Mode authority.
- `model-contract`: counts, strengths, risk states, current tick and bounded
  path work matched the expected schema-2 contract.
- `scheduler-isolation`: independent current-tick scheduler attribution.
- `cpu-budget`: observed isolated D0 CPU at most 5.

`combat-observation`: **WATCH**. The room had no observed armed hostile in
the verification window. The mixed ATTACK/WORK versus RANGED_ATTACK
arrival/range behavior and unique attacker accounting passed offline
regressions, but they were **not validated by real hostile combat**. Actual
optimal breaching, team barrier coordination, friendly defense/healing,
combat probability, and adversarial decisions remain unproven.

### General live: 12 PASS / 7 WATCH / 0 FAIL

PASS: exact Node and bot version, complete 100-tick window, zero bot/runtime
and collector errors, CPU and bucket safety, mining active, no hard economy or
spawn stall, contiguous durable telemetry, modeled hauler capacity, K0/K1/I0
telemetry present, and unchanged VNext SHADOW authority.

Seven WATCH findings (unaltered):

1. Fixed-cadence productive-flow evidence did not align exactly to this
   verifier's 100-tick window.
2. Consumer supply: waiting/critical consumers; self-supply fallback **zero**.
3. No exact-window 100-tick controller progress metric available.
4. No exact-window 100-tick construction progress metric available.
5. No exact-window productive throughput metric available.
6. Efficiency `WATCH` (optimization finding).
7. E4 matching evidence incomplete for the exact verification window.

No numeric productive-work improvement, controller progress or E4 equivalence
may be inferred from these WATCH lines.

### Related SHADOW gates

- **P2: PASS (7/0/0)**. READY / SHADOW; legacy planner authority unchanged;
  selected E8N1 (20,29), `CORE_BALANCED`, score 82.4;
  exact routes 4, fallback routes 0. Last isolated planner CPU **10.571**,
  EMA 5.768: continue monitoring, although P2 verifier passed.
- **P3: PASS (8/0/0)**. READY / SHADOW; `constructionAuthority=NONE`,
  28 rampart candidates, 0 breach routes, 0 exposed assets,
  defense score 74.1, last isolated scheduler CPU 4.559.
- **I2: PASS (9/0/0)**. READY / SHADOW; `activationAuthority=NONE`,
  `remoteMiningEnabled=false`, no ACTIVE remote state.
  Best evidence-only remote candidate E9N1; estimated net 6.961 energy/tick.
  Last isolated scheduler CPU 2.527.

## Release disposition

The D0.3 incremental SHADOW candidate meets the verified non-authoritative
live safety and telemetry contracts with **zero FAIL**, supported by passing
GitHub CI for the original tested runtime head. A release/PR merge can be
considered solely for **SHADOW-only** functionality, retaining WATCH overall.

- No gameplay intent, Safe Mode, spawn/tower, construction or remote
  activation authority change is approved.
- The four PathFinder searches at maximum 200 operations each remain bounded.
- D0 is incomplete and no real hostile fight was observed.
- **D1 and authoritative defense remain blocked** until the separate
  roadmap/model/validation gates have been satisfied.
- Preserve these WATCH findings and original tick windows; no threshold
  relaxation or retrospective PASS relabeling.
