# Exact-release P3 CPU witness (read-only)

This tool addresses stale P3 scheduler CPU readings observed after the P3.1
deployment. On `newbieland/chatgpt`, version `0.3.0-shadow.15-node24`,
deployment ID `20261009200957502-9092`, the first post-release check at tick
3812825 did not observe a new P3 run. A previous `lastRunTick=3812415` is
**not** proof of P3.1 live performance.

## Requirements

- Collector already running, writing `logs/bot-events-*.ndjson`.
- Exact `logs/deployment-receipt-newbieland-chatgpt.json` from the approved
  deploy, with version and deployment ID.
- Run from `tools` using Node 24.21.0. The witness reads logs, but does
  not start/restart collectors, upload modules, issue intents or merge code.

## Commands

```powershell
Set-Location "C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\chatgpt\tools"
node .\p3-release-evidence.mjs
node .\p3-release-evidence.mjs --wait --min-runs 2 --timeout-seconds 1800
node .\p3-release-evidence.mjs --wait --observe-runs 2 --timeout-seconds 1800
```

The first command is a one-shot inspection. The second polls read-only for
two **distinct** matching post-deployment execution ticks that both have
all-PASS P3 verification windows, with a 30-minute timeout. The third
command is a diagnostic alternative: it exits after two distinct
**complete** P3 windows even when CPU remains WATCH; in that case it
returns exit code 3, not PASS. All commands use the receipt rather than
a guessed start tick. If the
collector is stopped or the scheduler defers, a WATCH/timeout is appropriate;
it is not a reason to force a P3 run.

## Proof constraints

1. Match **both** the event version and deployment ID to the exact receipt
   in the actual `DEPLOYMENT_MARKER`.
2. Reject a subsequent foreign deployment marker instead of returning PASS
   using evidence for a superseded release.
3. Accept a P3 CPU datum only if `defenseMinCut.planTick` exactly matches
   `defense-mincut-shadow.lastRunTick`, both are on/after the deployment
   marker, the run precedes its snapshot by 0–99 ticks, a real `lastCpu`
   and `MINCUT.cpuUsed` are finite, and its 100-tick window is wholly
   post-deployment.
4. Deduplicate repeated snapshots for the same execution tick. Two snapshots
   reporting the same cached `lastRunTick` are **one** measurement.
5. Submit each 100-tick window to the existing `evaluateP3Shadow` checks.
   Print PASS only for the requested number of distinct, complete P3 windows
   whose eight P3 checks PASS. Hard FAIL stops the witness. WATCH is not PASS.
6. The user must still compare representative post-deploy CPU and phase
   measurements against **correctly attributed**, comparable D0.6 execution
   windows. A single low number does not establish a throughput speedup.

## Operational caveats

- The collector's logs are local files. GitHub Actions cannot obtain current
  Windows-client Screeps telemetry; only the operator can run this witness
  against those logs.
- Snapshot cadence is 100 ticks; P3 minimum interval is
  `config.PLANNER_INTERVAL * 10 = 500` ticks. The prior execution at
  3812415 therefore makes **3812915** the earliest interval-eligible
  tick, not a guaranteed execution tick.
- If live conditions prevent a P3 run, preserve WATCH. Do not change CPU
  thresholds, bucket restrictions or SHADOW authority to manufacture data.
- This tool does not validate D0 combat in the absence of armed hostiles,
  does not resolve General Live consumer-supply or exact-window WATCHs,
  and does not authorize any merge/deployment.

## First confirmed shadow.15 P3 execution

The operator observed the first matching new P3 release run at tick
`3812915`, captured by snapshot tick `3813000` after the exact
deployment marker at tick `3812491`.

- Exact 100-tick P3 window `3812901–3813000`: **7 PASS / 1 WATCH / 0 FAIL**.
- Isolated P3 scheduler CPU: **11.19** (>10 WATCH, <20 FAIL).
- MINCUT phase: **4.434 CPU**.
- D0.6 prior identified execution tick `3811915`: scheduler 9.978,
  MINCUT 4.701. Workload comparability is not yet proven; neither a
  total-CPU speedup nor a regression can be attributed to the code from
  this single pair of observations.
- A second distinct post-release run remains necessary. Do not
  overwrite this WATCH with a cached pre-release CPU.

The witness also reports `PROTECTED_TOPOLOGY`, `DEFENSE_SCORE`,
`phaseSumCPU`, and `outsidePhasesCPU = schedulerCPU - phaseSumCPU` when
all three phase measurements exist. `outsidePhasesCPU` is an
**unattributed difference between measurement spans**, not a proven
solver bottleneck or a CPU value that can automatically be recovered.
If any phase is absent, duplicated or non-finite, the derived sum and
difference remain unknown, not zero. CPU readings are rounded telemetry
and may not perfectly balance.



## Two distinct shadow.15 observations (operator evidence)

Second complete P3 window: run tick `3813415`, snapshot `3813500`,
window `3813401–3813500`: **8 PASS / 0 WATCH / 0 FAIL**. Exact
release match to deployment marker tick `3812491`.

| CPU (Screeps) | Run 3812915 | Run 3813415 | Change (second minus first) |
|---|---:|---:|---:|
| Full P3 scheduler | 11.190 | 4.796 | −6.394 |
| Protected topology | 4.821 | 0.674 | −4.147 |
| MINCUT | 4.434 | 2.719 | −1.715 |
| Defense scoring | 1.364 | 0.856 | −0.508 |
| Outside instrumented phases | 0.571 | 0.547 | −0.024 |

One WATCH and one PASS means **overall diagnostic WATCH**, not a
two-PASS release. Around 65% of the observed *difference* occurs in
topology construction; this does not establish that topology has a
repeatable performance defect or that the solver caused the variance.
Inputs may differ, and Screeps first-run/JIT and tick conditions can
matter. Do not extrapolate one run's CPU into steady-state headroom.

The new diagnostic `compareP3ReleaseSamples` reports bounds,
asset count, traffic tiles, graph size, augmentations, rampart and
tower counts for the two observed windows. The `geometryCountersMatch`
indicator is `null` when fields are missing, `false` if visible
dimensions differ, and `true` when all visible geometry counters
match. **Even true does not prove identical full terrain, graph,
inputs, cache/JIT state or causal speedup.** A targeted topology change
requires bounded benchmarks and exact output parity, not timing alone.

Operator read-only one-shot diagnostic for **two** release observations
(uses existing receipt and logs):
```powershell
node .\p3-release-evidence.mjs --observe-runs 2
```
Expected exit code is 3 (WATCH) while the first post-deployment
CPU sample remains above 10. No deploy or merge is needed.


## Third observed release comparison (operator excerpt)

Operator supplied the line:

`WORKLOAD COMPARISON: runTick=3813415 to=3813915
geometryCountersMatch=true knownGeometryFields=10/10 changedFields=[]
cpuDeltaSecondMinusFirst={"scheduler":-1.026,"topology":-0.132,
"mincut":-0.933,"scoring":-0.009,"outsidePhases":0.048}`

Using the independently documented second-run values, the **derived**
third-run CPU values (not copied from an `OBSERVED` or verifier line) are:

| Phase (Screeps CPU) | Run 3813415 | Run 3813915 (derived) |
|---|---:|---:|
| Scheduler | 4.796 | 3.770 |
| Protected topology | 0.674 | 0.542 |
| MINCUT | 2.719 | 1.786 |
| Defense scoring | 0.856 | 0.847 |
| Outside measured phases | 0.547 | 0.595 |

The third comparison provides 10 matching observable geometry fields
with the second run. It does **not** contain the full third-run
`OBSERVED` record, 100-tick completion bit or P3 check counts, so the
third run is **not** independently marked 8 PASS / 0 WATCH / 0 FAIL
in this document. Its derived scheduler CPU would be under the
10-CPU WATCH threshold if confirmed by the full reading.

The live release remains **WATCH** because run `3812915`
was above the 10-CPU warning threshold. The operator's requested
four-distinct-run diagnostic quorum has not yet been established by
the excerpts available here. Do not change threshold or run identity
to manufacture a PASS.


## Five confirmed post-deployment P3 executions

The operator ran the exact-receipt witness at collector evidence tick
`3826125` and supplied **five** distinct, completed 100-tick P3 release
windows for `shadow.15` / deployment
`20261009200957502-9092`. Every run matched the deployed
`defenseMinCut.planTick` and scheduler `lastRunTick`, and consecutive
comparisons reported 10/10 matching visible geometry counters.

| Run tick | Snapshot tick | Scheduler CPU | Topology CPU | MINCUT CPU | Scoring CPU | Outside phase CPU | P3 checks |
|---|---:|---:|---:|---:|---:|---:|---|
| 3812915 | 3813000 | 11.190 | 4.821 | 4.434 | 1.364 | 0.571 | 7 PASS / 1 WATCH / 0 FAIL |
| 3813415 | 3813500 | 4.796 | 0.674 | 2.719 | 0.856 | 0.547 | 8 PASS / 0 WATCH / 0 FAIL |
| 3813915 | 3814000 | 3.770 | 0.542 | 1.786 | 0.847 | 0.595 | 8 PASS / 0 WATCH / 0 FAIL |
| 3825415 | 3825500 | 4.532 | 0.492 | 2.492 | 1.108 | 0.440 | 8 PASS / 0 WATCH / 0 FAIL |
| 3825915 | 3826000 | 3.429 | 0.686 | 1.420 | 0.615 | 0.708 | 8 PASS / 0 WATCH / 0 FAIL |

The four full-PASS CPU windows have scheduler CPU **3.429–4.796**,
arithmetic mean **4.132**, median **4.151**, all below the
10-CPU diagnostic WATCH threshold; the complete first window
remains an 11.190-CPU **WATCH**. These observations establish a
four-PASS CPU quorum, not an all-PASS release history. They provide
no direct evidence of a causal improvement over D0.6, and they do
not clear General Live, I2, D0 combat, or other unrelated WATCHs.

The large distance between ticks `3813915` and `3825415`
(11,500 ticks) cannot, from the available witness summary, determine
whether intervening P3 runs were scheduler-deferred or not captured
by the collector. No inference about scheduler starvation is made.

### Gate behavior regression

The earlier CLI exited 0 when `--observe-runs 4` found four PASS
windows even if there were additional historical WATCH windows in
the same exact release. This condition was too permissive for an
**overall release acceptance** conclusion.

`classifyP3ReleaseWindows` now preserves both distinctions:
four distinct CPU-PASS measurements are reported as achieved, while
one other completed release window still WATCH means
`RELEASE RESULT: WATCH` and exit code **3**. Only if **all observed
complete windows** PASS and the requested PASS quorum is met does
the stricter release gate report exit code 0.

This is a read-only verifier semantic correction. It does not change
the game runtime, telemetry, deployment receipt, threshold,
scheduler, or the already-observed measurements. The historical
CLI text claiming `RELEASE CPU OBSERVED: 4 distinct...` is retained
as user evidence but is not treated as blanket release approval.
