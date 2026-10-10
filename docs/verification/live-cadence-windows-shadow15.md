# Shadow.15 live cadence and persistent WATCH diagnostics

## Operator evidence (read-only, newbieland/chatgpt)

Operator verified ticks \`3826000–3826099\` on version
\`0.3.0-shadow.15-node24\`, exact deployment ID
\`20261009200957502-9092\` (marker tick \`3812491\`):

| Verifier | PASS | WATCH | FAIL |
|---|---:|---:|---:|
| General Live | 13 | 6 | 0 |
| P2 | 6 | 1 | 0 |
| I2 | 7 | 2 | 0 |
| D0 | 6 | 1 | 0 |
| **Total** | **32** | **10** | **0** |

Current General Live passes runtime, collector, mining, hard-stall,
telemetry continuity, bucket thresholds, hauler modeled capacity,
consumer supply, K0/K1/I0 platform and VNext SHADOW authority.
Its WATCH items are \`productive-attribution\`,
\`controller-progress\`, \`construction-progress\`,
\`productive-throughput\`, \`efficiency-status\`, and
\`e4-matching-evidence\`.

P2 latest READY plan \`planTick=3825979\` and scheduler
\`lastRunTick=3825979\`, isolated CPU \`6.149\`, lies just outside
the arbitrary test start \`3826000\`. I2 latest READY ROI and
matching scheduler \`evaluatedTick=lastRunTick=3825766\`, CPU
\`5.522\`, also lies outside that window. A cached plan or CPU
reading is not proof of an in-window execution.

I2 remains SHADOW, activation authority NONE, remote mining disabled.
The two current candidate neighbors are E8N2 and E9N1; no
activation is implied. D0 is SHADOW/NONE, CPU <=5; the peaceful
window cannot validate actual combat outcomes and must remain WATCH.

## Correctness-safe diagnostic

\`\`\`powershell
# From Screeps chatgpt/tools after downloading the two new inspector files
node .\live-cadence-inspector.mjs
node .\live-cadence-inspector.mjs --json
\`\`\`

The pure inspector reads the exact receipt and local collector NDJSON,
then lists completed economy productive windows, E4 matching windows,
and P2/I2 scheduler executions matching their original plan/ROI ticks.
It includes the latest efficiency \`overallScore\`, \`components\`,
\`pressure\`, \`reasons\`, and modeled productivity metrics.

The output is a **window candidate list, not a verification PASS**.
The investigator must run the original, unchanged gate for each
candidate. With the specific execution ticks from the uploaded log,
the following completed 100-tick windows include the relevant
execution and a later status snapshot:

\`\`\`powershell
node .\p2-live-verification.mjs --start-tick 3825979
node .\i2-live-verification.mjs --start-tick 3825766
\`\`\`

Both are suggestions grounded in the supplied tick references, not
pre-validated outcome claims. CPU failure/watch thresholds remain
unchanged. No artificial scheduler run, reset or upload is permitted.

## Exact later E4 carrier limitation

A 100-tick E4 result can complete between fixed STATUS_SNAPSHOT
ticks. The deployed shadow.15 verifier currently selects E4 evidence
from a snapshot inside the requested window. Even an immutable exact
E4 block carried later can therefore remain WATCH.

The new inspector locates exact E4 blocks without modifying any
verifier verdict. A release-version-specific verifier correction is
tracked separately and must preserve the deployed shadow.15 version,
all original safety checks, immutable exact boundaries, no
cross-deployment snapshots, and fail-closed duplicate evidence.
Do not substitute the shadow.14 verifier file from this PR for the
locally installed shadow.15 version.

## Remaining hold points

1. Select actual completed economy and E4 100-tick boundaries from
   existing events, not a guessed multiple of 100.
2. Rerun the original General Live verifier on a candidate completed
   economy window and separately on an E4 window. Nonmatching
   independent cadences may prevent all-pass single-window evidence.
3. Inspect efficiency WATCH \`reasons\`, pressure and components;
   do not relabel performance findings as PASS.
4. D0 combat WATCH remains until either safe deterministic fixtures or
   natural real encounters provide appropriate evidence. Never induce
   an attack or enable any gameplay authority for validation.
5. No merge and no deployment without separate user approval.
