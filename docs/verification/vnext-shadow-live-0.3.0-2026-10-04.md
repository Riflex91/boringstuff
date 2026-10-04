# VNext 0.3.0-shadow.1-node18 — First Shadow Live Verification

Date: 2026-10-04  
Repository: `Riflex91/boringstuff`  
Release merge commit: `8d368ea110229c3d82572f1f7491d01c48c22578`  
Bot version: `0.3.0-shadow.1-node18`  
Runtime Node: `18.20.4`  
Screeps branch: `chatgpt`  
Primary room: `E8N1`

## Evidence status

This record is append-only evidence for the first VNext shadow live window.

The verifier outcome was **WATCH**, not PASS.

No PASS is inferred or manufactured from the absence of FAIL checks.

## 100-tick live window

Window:

`3690501-3690600`

Verifier summary:

- PASS: 15
- WATCH: 3
- FAIL: 0
- Overall outcome: `WATCH`

Checks:

- PASS — `node-version`: Node runtime is 18.20.4.
- PASS — `bot-version`: window contains only `0.3.0-shadow.1-node18` bot events.
- PASS — `window-complete`: evidence reaches tick 3690600.
- PASS — `runtime-errors`: no bot/runtime errors were observed.
- PASS — `collector-health`: no collector errors were observed.
- PASS — `cpu-bucket`: CPU and bucket remained inside safety thresholds.
- PASS — `mining-active`: dedicated mining is active.
- PASS — `hard-stall`: no hard spawn/economy stall evidence was observed.
- PASS — `telemetry-continuity`: durable telemetry jseq values are contiguous.
- PASS — `productive-attribution`: productive-flow attribution is complete for the 100-tick window.
- PASS — `hauler-capacity`: modeled hauler capacity meets requirement.
- WATCH — `consumer-supply`: consumer self-supply fallback occurred; optimization may still be needed.
- PASS — `controller-progress`: controller progressed during the window.
- PASS — `construction-progress`: construction progress is acceptable for the current workload.
- WATCH — `productive-throughput`: productive throughput trails mining capacity; optimization finding, not a safety failure.
- WATCH — `efficiency-status`: Efficiency is `WATCH`; optimization finding only.
- PASS — `vnext-platform-shadow`: K0/K1/I0 platform telemetry is present.
- PASS — `vnext-shadow-authority`: O1/E0/E1/E2/O2 remain `SHADOW` / `SHADOW_EVIDENCE`.

## Interpretation

The first live VNext shadow deployment crossed its hard safety gates:

- no runtime or collector failure;
- no hard economy/spawn stall;
- CPU/bucket stayed inside safety thresholds;
- mining remained active;
- telemetry remained contiguous;
- productive attribution was complete;
- controller and construction continued making progress;
- K0/K1/I0 telemetry was present;
- O1/E0/E1/E2/O2 did not gain gameplay authority.

The overall verifier result remains `WATCH` because three optimization findings remain:

1. consumer self-supply fallback occurred;
2. productive throughput remained below mining capacity;
3. Efficiency reported `WATCH`.

These findings must not be represented as a VNext live PASS.

They also do not, by themselves, prove a regression against the historical `0.2.19-node18` baseline because this verifier output does not contain the numeric values required for an apples-to-apples comparison.

## Release decision

The release is accepted as **first VNext shadow live evidence with zero hard failures**.

VNext remains evidence-only / shadow-only. No gameplay authority promotion is authorized by this result.

Before any authority migration, subsystem-specific shadow comparison and equivalence/superiority evidence remain required by the VNext roadmap.
