# D0.4 — partial live verification, 0.3.0-shadow.12-node24

Date: 2026-10-09  
PR: [#114](https://github.com/Riflex91/boringstuff/pull/114)  
Runtime source candidate: `6e939d185b2f65f6ba812de045ecf4aa31729978`  
Observed version: `0.3.0-shadow.12-node24`; Node `24.21.0`; room `E8N1`

**Evidence status: INCOMPLETE release gate; five read-only verifiers supplied;
43 PASS / 7 WATCH / 0 FAIL across only those five. No smoke result in the
provided transcript, and no actual `npm run deploy` console output.**
Do not claim six-gate completion or accept/merge based on this report alone.

## Supplied live-verifier results

| Verifier | Tick window | PASS | WATCH | FAIL | Outcome |
|---|---|---:|---:|---:|---|
| General live | 3810501–3810600 | 13 | 6 | 0 | WATCH |
| D0 | 3810466–3810565 | 6 | 1 | 0 | WATCH |
| P2 | 3810466–3810565 | 7 | 0 | 0 | PASS |
| P3 | 3810466–3810565 | 8 | 0 | 0 | PASS |
| I2 | 3810466–3810565 | 9 | 0 | 0 | PASS |
| **Subtotal only** | — | **43** | **7** | **0** | **WATCH** |
| Smoke | **NOT SUPPLIED** | — | — | — | **UNKNOWN** |

The general live window does not coincide with the D0/P2/P3/I2 window.
Its bot-version check confirms exclusively `shadow.12` events. Runtime and
collector errors were absent, CPU/bucket limits passed, mining was active,
there was no hard spawn/economy stall, journal sequences were contiguous,
and VNext authority stayed observational. Efficiency was explicitly
`EFFICIENT`, and modeled hauler capacity passed.

Six general-live WATCH findings:

1. Productive-flow fixed cadence misaligned with the exact live window.
2. Consumer self-supply fallback **occurred**, unlike the previous
   `shadow.11` zero-fallback observation; needs continued monitoring.
3. No available exact-window 100-tick controller progress metric.
4. No available exact-window 100-tick construction progress metric.
5. No available exact-window productive throughput metric.
6. E4 matching evidence incomplete for the exact window.

### D0 6 PASS / 1 WATCH

All hard D0 checks pass: complete 100-tick evidence, D0 snapshot presence,
SHADOW/no Safe Mode authority, current-tick model contract (now schema 3),
scheduler isolation, and isolated D0 CPU <= 5.
`combat-observation` remains **WATCH** because the observed window was
peaceful. This does **not** demonstrate that the new shared-barrier scenario
predicts actual coordinated enemy combat. The compact
`sharedBarrierGroups` value itself was not shown in the provided console
excerpt; schema-3 model-contract validation passed, but an explicit
nonzero cooperative scenario was not observed.

### Other subsystem passes and operational findings

- **P2 (7/0/0)**: READY SHADOW plan. Anchor E8N1 (20,29), `CORE_BALANCED`,
  score 82.4; exact in-room routes 4, fallback 0.
  Last observed isolated P2 scheduler CPU **15.506**, EMA **6.247**:
  monitor peak CPU despite verifier PASS.
- **P3 (8/0/0)**: READY SHADOW min-cut, constructionAuthority NONE,
  28 proposed ramparts, 0 breach routes and 0 exposed assets.
  Last isolated P3 CPU **7.568**, EMA **5.24**; P3 verifier PASS.
- **I2 (9/0/0)**: READY SHADOW ROI evidence, activationAuthority NONE,
  remoteMiningEnabled false, no ACTIVE remote activation.
  Best candidate E9N1, estimated net 6.961 energy/tick; last isolated
  I2 scheduler CPU **1.408**.

## Source integrity and stop rule

The supplied file starts with `VERIFY LIVE 3810501-3810600`; it does
**not** contain `npm run verify:smoke`, `npm run deploy`, the deployment
receipt ID, raw collector files, or an exact module-by-module server
comparison. Earlier user output confirmed local `shadow.12` `npm test`
and `npm run doctor` PASS. GitHub Actions `npm test` for candidate
head `6e939d185...` passed on Node 24.21.0 (run `37971174451`).

**Pending before SHADOW-only release decision:**
- Obtain a fresh, valid `npm run verify:smoke` result for this deployed
  `shadow.12` version, and the missing deployment-console output/receipt
  evidence where available.
- Review whether the extra `sw.js` was backed up and excluded from the
  actual deploy source tree. A syntax test counted 51 locally, versus
  50 expected in the candidate; the transcript establishing post-removal
  deploy state has not been supplied.
- Preserve consumer fallback WATCH and P2 CPU peak for follow-up.

**No D1, Safe Mode, authoritative defense, tower/spawn, construction or
remote activation promotion. PR #114 stays draft and unmerged.**
