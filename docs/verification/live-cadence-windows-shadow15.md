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

## Subsequent exact-aligned P2/I2 and efficiency evidence

The operator executed the cadence-inspector at collector evidence tick
`3826550`, then original read-only verifiers. This confirmed:

- **P2** `3825979–3826078`: **7 PASS / 0 WATCH / 0 FAIL**,
  READY planner, independent scheduler execution, isolated **6.149 CPU**.
- **I2** `3825766–3825865`: **8 PASS / 1 WATCH / 0 FAIL**,
  READY ROI, independent scheduler, isolated **5.522 CPU** above
  existing diagnostic WATCH 5 (below hard FAIL 10). Activation remains
  NONE and remote mining disabled.
- Newer I2 ROI/scheduler candidate at `3826266` records **1.771 CPU**
  (unverified until its `3826266–3826365` 100-tick gate runs).
  Another candidate at `3826016`: 1.626 CPU.
- Exact productive window `3826302–3826401`, recorded at snapshot
  `3826500`. E4's distinct exact window `3826393–3826492`,
  also carried at snapshot `3826500`. These 100-tick schedules
  **do not overlap exactly**; both need separately aligned tests.
  Four recent E4 windows each report **0 observed duplicate reservation
  ticks**, but their critical-coverage ratio still requires gating.

Latest efficiency snapshot tick `3826500`:

| Metric | Value |
|---|---:|
| `status` / `overallScore` | UNDERUTILIZED / 58 |
| `productiveUse` / `energyUse` | 60 / 65 |
| `spawnUse` / `flow` | 0 / 100 |
| productive throughput / capacity | 10.88 / 18 work units per tick |
| spawn utilization / capped-energy ratio | 0 / 0.35 |
| pressure | SURPLUS, 35; demand score 0 |
| reasons | MODELED_DEMAND_NOT_REALIZED |

The observed productivity ratio is **10.88/18 = 60.4%**. The
score 58 comes from weighted components (45% productivity,
25% energy use, 15% spawn, 15% flow), not solely hauling failure:
consumer supply had PASS and flow component was 100. A 0% busy
spawn amid some surplus does **not** establish a missing-role
problem: `spawn.manager.desired` deliberately declines to spawn
once its bounded role targets are met. No role-target bypass is
authorized based on this score alone.

The follow-up read-only inspector now surfaces, from one actual
STATUS_SNAPSHOT, current creep counts, energy available/capacity/stored,
construction sites, economic need/deficit counters, and last
100-tick productive work breakdown. It separately reports logged
`SPAWN_IDLE_SURPLUS`, `SPAWN_OK` and `SPAWN_RC` events in a
bounded recent 500-tick slice, explicitly noting that an *absence*
of events does not prove that no spawning or idle event occurred.
Missing serialized fields are null, never invented as zero. CI
regressions enforce exact version, room, window bounds and
provenance. This tool remains purely diagnostic.

### Next safe proofs

```powershell
node .\i2-live-verification.mjs --start-tick 3826266
node .\live-verification.mjs live --start-tick 3826302
# After installing only the exact shadow.15 read-only verifier fix #121:
node .\live-verification.mjs live --start-tick 3826393
node .\live-cadence-inspector.mjs
```

No old WATCH is reclassified without rerunning the underlying gate;
no live gameplay module, body/role target, threshold, deployment or
merge is changed by this diagnostic.


## Follow-up: exact I2 PASS, temporary fallback, and E4 undercoverage

The operator installed the local exact shadow.15 verification fixes, then
reported the following direct original-verifier results:

| Window | Verifier | PASS | WATCH | FAIL | Evidence |
|---|---|---:|---:|---:|---|
| 3826266–3826365 | I2 | **9** | **0** | **0** | independent ROI/scheduler, 1.771 CPU |
| 3826302–3826401 | General Live | 16 | 3 | 0 | productive attribution/controller/build/throughput PASS; consumer-supply, efficiency, E4 WATCH |
| 3826393–3826492 | General Live | 12 | 7 | 0 | exact E4 is WATCH due to **incomplete critical-request coverage**, not merely cadence |

The exact E4 window had `duplicateReservationTicks=0`.
The coverage WATCH is **not** safe to erase by alignment or by
changing a threshold; the matching algorithm can leave critical
requests unmatched despite no duplicate reservation IDs.

The inspector at latest evidence tick `3826701` reported recent
completed E4 windows 3826293–3826392, 3826393–3826492,
3826493–3826592 and 3826593–3826692, each with 0 observed
duplicate-reservation ticks. These are not individually all-PASS
until their critical-request coverage is checked.

Economy/efficiency snapshot at tick `3826700`:

- RCL **5**, `constructionSites=0`, stored energy **4634**,
  energy available **902/1050**, no spawn currently busy.
- Last complete economy window `3826502–3826601`:
  controller progress **1464**, construction progress **0**,
  productive throughput **14.64** versus observed modeled productive
  capacity **15.9**; productive utilization about **92%**.
- `UNDERUTILIZED` score **65** is now mostly driven by
  `ENERGY_SURPLUS_UNCONSUMED` and `SPAWN_IDLE_WITH_SURPLUS`:
  capped-energy ratio **0.9**, spawn utilization **0.1**,
  productive-use component **92**, energy-use component **10**,
  spawn-use component **40**, flow component **100**.
- Latest economic model reports no harvester, hauler, fallback or
  consumer-critical deficit. A separate **earlier** General Live
  window nevertheless observed consumer self-supply fallback.
  Those facts concern different ticks and are not contradictory.
- Recent spawn logs contain **6 SPAWN_OK**, **4 SPAWN_IDLE_SURPLUS**,
  **0 SPAWN_RC** within the last 500 collector ticks. The latest
  idle-surplus event had desired upgrader **3** and actual **3**.
  The most recent snapshot had 2 upgraders; the data alone cannot
  establish a persistently missing role or justify spawning more
  Creeps. No live spawn policy changed.

### Exact E4 diagnostic counts

The E4 model exposes these raw, independently collected 100-tick
counters: `criticalRequestTicks`, `criticalMatchedTicks`,
`unmatchedCriticalTicks`, `criticalNoCandidateTicks`,
`criticalCandidateRequestTicks`,
`criticalCandidateUnmatchedTicks`, and
`criticalSlotCapacityTicks`. They distinguish:

1. Requests with **no feasible pre-revalidation candidate**.
2. Requests with feasible candidates that **remained unmatched**.
3. The independent **hauler slot capacity** bound, which can
   explain structural undercoverage but is not itself a causal proof.

They must not be inferred from a missing or truncated field.
The new `live-cadence-inspector.mjs` displays these counters per
exact E4 window and counts waiting/critical/fallback consumer-ticks
per exact economy window. It prints UNKNOWN on absent numbers. It
does not modify `game/logistics.matching.shadow.js`, E4 authority,
hauler targeting, or the original verifier's PASS/WATCH/FAIL.

**Next read-only operator command**, after explicitly updating
the two inspector files from this PR's tested commit:

```powershell
node .\live-cadence-inspector.mjs
```

Record the E4 `criticalNoCandidateTicks`,
`criticalCandidateUnmatchedTicks` and `criticalSlotCapacityTicks`
alongside critical request/matched totals. An E4 scheduling or
capacity fix requires that evidence plus deterministic adversarial
parity tests. Retain SHADOW and all original thresholds.


## Shadow E4 critical-demand spike: exact operator data

The operator next supplied the read-only inspector at latestEvidenceTick
`3826801`. Four consecutive completed **100-tick E4 SHADOW** windows:

| E4 window | Critical request-ticks | Matched | Unmatched | Shadow slot cap | No-candidate | Candidate-unmatched | Duplicate-reservation ticks |
|---|---:|---:|---:|---:|---:|---:|---:|
| 3826393–3826492 | 232 | 213 | 19 | 215 | 0 | 19 | 0 |
| 3826493–3826592 | 101 | 81 | 20 | 81 | 0 | 20 | 0 |
| 3826593–3826692 | 96 | 83 | 13 | 83 | 0 | 13 | 0 |
| 3826693–3826792 | **1017** | **125** | **892** | **129** | **0** | **892** | **0** |

Latest critical coverage **125/1017 = 12.3%** versus 83/96 =
86.5% in the preceding E4 window. The arithmetic shows **888**
request-ticks in excess of the model's total one-job-per-hauler
slot ceiling; the remaining **4** slots were unfilled (125/129 =
96.9% realized shadow-slot coverage). Every critical request
had at least one pre-revalidation candidate (`criticalNoCandidateTicks=0`).
This is a **shadow matching slot bottleneck**, **not proof of actual
hauler CARRY capacity or actual failure to deliver energy**. E4
does not issue physical intents, and the counters count demand
repeated over ticks rather than 1017 separate structures/creeps.
Earlier live consumer fallback is a separate, real observation but
does not by itself prove shadow and legacy prioritization are identical.

The independent economy window `3826602–3826701` observed
productive throughput **3.58** vs modeled capacity **12.0**,
consumer waiting-ticks **31**, critical-ticks **79**, fallback-ticks
**48**, controller progress **358**. That economy interval overlaps
the E4 surge window `3826693–3826792` for only **nine ticks**.
Do not attribute the productive decline to the full later E4
surge on these nonaligned aggregates.

### Candidate source hypothesis (not established)

`game/request.logistics.shadow.js` creates an
`EMERGENCY_DELIVER` request for **each** unfilled spawn,
extension or tower when `energyAvailable < min(300,
energyCapacityAvailable)`. Waiting/fallback consumers can also
create emergency delivery requests. Hence many critical E4
requests could arise simultaneously from depleted infrastructure
without a comparable rise in distinct consumers. The current
100-tick E4 evidence does **not** distinguish those origins.

The read-only inspector now correlates any logged
`ROOM_HEARTBEAT` samples **inside each exact E4 window**
with `energy`, `logisticsRequests.byKind.EMERGENCY_DELIVER`,
and `logisticsMatching` critical/hauler counts. Missing or
serializer-truncated fields remain UNKNOWN; absent logs never
prove that no infrastructure emergency occurred. The output also
prints the model's request-vs-slot arithmetic, explicitly
labeled SHADOW, not measured physical throughput.

A gameplay fix to spawn counts, consumer fallback, matching
priority or infrastructure reserve needs confirmed causal
evidence and deterministic parity tests. No such modification
has been authorized or deployed.
