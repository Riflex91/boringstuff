# D0.4 — all six read-only verifier outputs for 0.3.0-shadow.12-node24

Date: 2026-10-09  
PR: [#114](https://github.com/Riflex91/boringstuff/pull/114)  
Runtime candidate source head: `6e939d185b2f65f6ba812de045ecf4aa31729978`  
Observed runtime: `0.3.0-shadow.12-node24`  
Local Node: `24.21.0`; observed room: `E8N1`

**Read-only verification outcome: 52 PASS / 7 WATCH / 0 FAIL across six gates.
Overall WATCH, not PASS.** The smoke output was provided separately after
the five-gate partial report
[`d0-4-shadow-live-partial-0.3.0-2026-10-09.md`](d0-4-shadow-live-partial-0.3.0-2026-10-09.md).
That report remains an accurate record of what was available earlier;
this report supersedes its *coverage status*, not its underlying findings.

| Verification | Exact tick window | PASS | WATCH | FAIL | Result |
|---|---|---:|---:|---:|---|
| Smoke | 3810466–3810490 | 9 | 0 | 0 | PASS |
| General live | 3810501–3810600 | 13 | 6 | 0 | WATCH |
| D0 | 3810466–3810565 | 6 | 1 | 0 | WATCH |
| P2 | 3810466–3810565 | 7 | 0 | 0 | PASS |
| P3 | 3810466–3810565 | 8 | 0 | 0 | PASS |
| I2 | 3810466–3810565 | 9 | 0 | 0 | PASS |
| **Total** | — | **52** | **7** | **0** | **WATCH** |

The smoke and D0/P2/P3/I2 windows share start tick 3810466. The
general-live window starts at 3810501; they are not the same 100 ticks.

## Smoke — 9 PASS / 0 WATCH / 0 FAIL

User-supplied `VERIFY SMOKE 3810466-3810490: PASS`:

- Node runtime `24.21.0` and exact `0.3.0-shadow.12-node24` bot events.
- Window completed at tick 3810490.
- No observed bot/runtime or collector errors.
- CPU and bucket inside safety thresholds.
- Dedicated mining active; no hard spawn/economy stall evidence.
- Contiguous durable telemetry journal sequences.

This validates the 25-tick smoke window, **not** the local deploy
command output, deployment ID or individual remote module hashes.

## General live — 13 PASS / 6 WATCH / 0 FAIL

Exact `3810501–3810600` 100-tick window: node/bot identity, continuity,
runtime and collector error absence, CPU/bucket safety, mining, no hard
economy/spawn stall, hauler-capacity, VNext SHADOW authority and
`EFFICIENT` efficiency status all PASS.

Six WATCH items:

1. Productive-flow fixed cadence did not exactly match the window.
2. **Consumer self-supply fallback occurred**, unlike the `shadow.11`
   observation of zero fallback; keep as an optimization finding.
3. Controller progress metric not available for the window.
4. Construction progress metric not available for the window.
5. Productive throughput metric not available for the window.
6. E4 matching evidence incomplete for the exact window.

No productivity improvement or progress rate can be inferred from
unavailable metrics.

## D0 — 6 PASS / 1 WATCH / 0 FAIL

Exact `3810466–3810565`: complete D0 room snapshot evidence, bounded
schema-3 model contract, SHADOW / no Safe Mode authority, independent
scheduler attribution, and D0 isolated CPU <=5 all PASS.

`combat-observation` remains **WATCH**: no armed hostile observed in
this peaceful window. The presence of schema-3 contract evidence does
not demonstrate a real coordinated barrier-breach event or nonzero
`sharedBarrierGroups` in battle. D0.4's single-barrier shared-damage
algorithm is supported by offline regression tests, not live combat
validation.

## P2, P3 and I2

- **P2 7/0/0 PASS:** READY SHADOW anchor (20,29) `CORE_BALANCED`,
  score 82.4; exact in-room routes 4, fallback 0. Last observed isolated
  scheduler CPU **15.506**, EMA **6.247**; monitor peak.
- **P3 8/0/0 PASS:** READY SHADOW min-cut with 28 proposed ramparts,
  0 breach routes, 0 exposed assets, no construction authority.
  Last observed isolated CPU 7.568, EMA 5.24.
- **I2 9/0/0 PASS:** READY SHADOW remote ROI; activationAuthority NONE,
  remote mining disabled, no ACTIVE remote state. Best candidate E9N1,
  estimated net 6.961 energy/tick. Last isolated CPU 1.408.

## Provenance, unresolved evidence and release decision

The supplied six read-only verifier outputs establish 52/7/0 and
exact smoke/live version identity. The user previously supplied
`shadow.12` local `npm test` and `npm run doctor` PASS. GitHub
Actions `npm test` on the original deployed-candidate source head
`6e939d185...` passed on Node `24.21.0` (run `37971174451`).

**Still not supplied:** `npm run deploy` command output, deployment
receipt ID, complete collector log archive, final evidence that the
previously observed extra `sw.js` was moved out of the install
directory before deployment, and server module-by-module hash
comparison. The read-only D0 verifier did accept the current release's
deployment-marker/receipt controlled observation, but the concrete
receipt contents are not visible in these transcripts.

Therefore the **six read-only live verifiers are complete**, but
**deployment/file-integrity confirmation is still pending**. Do not
assert complete end-to-end release provenance based on the verifier
outputs alone. Do not generate another deployment just to reproduce
an old console line; a fresh deploy creates a new evidence boundary.

**Accept only the observed SHADOW telemetry and runtime safety findings
at overall WATCH / zero FAIL.** Leave PR #114 unmerged pending explicit
authorization and assessment of outstanding deployment/file evidence.
No Safe Mode, spawn/tower, construction, remote activation or other
gameplay authority changes are authorized. D0 is incomplete; D1 remains
blocked. Do not claim combat prediction validated by a peaceful window.
