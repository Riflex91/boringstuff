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

