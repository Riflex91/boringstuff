# Screeps Autonomous Bot v0.2.18-node18

Canonical local repository:

`C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\boringstuff`

Installed Screeps runtime:

`C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\chatgpt`

## v0.2.18 – Dedicated Productive Work

The verified v0.2.17 live window passed every hard safety gate but retained three optimization signals: consumer self-supply fallback, productive throughput below mining capacity, and `INEFFICIENT` colony efficiency. Mining and modeled hauler capacity were already healthy.

The remaining churn is in productive consumers. Builders/workers/repairers currently refill spawn/extensions before doing their own work. With redundant haulers this can send a consumer's carried energy back into infrastructure, leave the consumer empty, and then require a hauler to deliver energy back to the same productive layer.

### Behavior change

- with two or more live haulers, builders/workers/repairers keep carried energy for productive work;
- with zero or one live hauler, the historical infrastructure-first recovery path remains unchanged;
- upgrader behavior is unchanged;
- mining, hauling capacity models, spawn counts, defense, planning, and expansion are unchanged.

### Verification

The regression suite explicitly checks both sides of the invariant: two-hauler colonies skip consumer infrastructure assist, while one-hauler recovery still refills infrastructure first. The standard v0.2.18 acceptance path is:

```powershell
cd "C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\boringstuff"
powershell -ExecutionPolicy Bypass -File .\install.ps1
cd tools
npm install
npm test
npm run doctor
npm run deploy
npm run logs
```

Then, from a second PowerShell window in the installed runtime tools directory:

```powershell
npm run verify:smoke
npm run verify:live
```

Expected runtime version after deployment: `0.2.18-node18`.

---

## Historical documentation from v0.2.16 and earlier

# Screeps Autonomous Bot v0.2.16-node18

Target path:

`C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\chatgpt`

## v0.2.16 – Consumer Starvation Guard

The clean v0.2.15 live window proved that request-driven consumer selection and
per-consumer reservations improved real productive throughput, but a remaining
failure mode appeared during spawn/extension refill bursts. While hard energy
infrastructure was below capacity, every delivering hauler followed the same
absolute infrastructure-first rule. Productive creeps could therefore wait long
enough to enter self-supply fallback even though aggregate hauling capacity was
already sufficient.

### Changes

- hard infrastructure remains the default highest-priority delivery class;
- the single-hauler recovery path is unchanged: with only one live hauler,
  spawn/extensions/towers retain absolute priority;
- when at least two live haulers exist and any consumer is already waiting or in
  logistics fallback, exactly one delivery-ready hauler becomes the Consumer
  Starvation Guard;
- the guard serves a consumer before hard infrastructure while all remaining
  haulers continue refilling spawn/extensions/towers;
- an existing reservation to a critical consumer is kept sticky to prevent
  guard oscillation while the hauler is travelling;
- without an existing critical reservation, the closest delivery-ready hauler
  becomes the guard, with carried energy and stable creep identity as
  deterministic tie-breakers;
- fresh empty consumers remain ordinary requests; the guard activates only once
  actual waiting/fallback pressure exists;
- `economyModel` now exposes `consumerCriticalCount` alongside the existing
  fallback/wait/request/reservation counters;
- mining, hauler sizing, spawn caps, planner, defense, Health, Efficiency, and
  durable telemetry behavior are unchanged.

### Regression coverage

`consumer-supply.test.mjs` now additionally verifies that:

1. exactly one of several ready haulers becomes the starvation guard;
2. the closest ready hauler is selected when no critical reservation exists;
3. an existing critical reservation remains sticky;
4. the guard is disabled when only one hauler exists;
5. a fresh empty consumer does not preempt infrastructure until it actually
   starts waiting.

## Install / update

Extract this package and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Then:

```powershell
cd "C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\chatgpt\tools"
npm install
npm test
npm run doctor
npm run deploy
npm run logs
```

Expected runtime version after deployment: `0.2.16-node18`.

After deployment verify:

```javascript
bot.status()
bot.telemetryStatus()
```

For live acceptance, use a complete 100-tick window. The main gate is that
`haulerCarryDeficit` stays at 0 while `consumerFallbackCount` and
`consumerCriticalCount` fall materially during/after spawn refill bursts,
without reducing spawn safety or controller/construction throughput.

---

## Historical documentation from v0.2.15

# Screeps Autonomous Bot v0.2.15-node18

Target path:

`C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\chatgpt`

## v0.2.15 – Demand-aware Consumer Supply

v0.2.14 removed the measured aggregate hauling-capacity deficit, but the clean
`3680201-3680300` window still showed `consumerFallbackCount = 2` while live
haulers supplied 16 CARRY against only 12 recommended CARRY. The remaining
bottleneck was therefore not fleet size but last-mile delivery selection.

The previous delivery policy considered every productive creep with any free
energy capacity a valid target and then applied a static
`builder -> worker -> repairer -> upgrader` priority. Multiple haulers could
also select the same consumer. This allowed active consumers to be repeatedly
topped up while another empty consumer waited long enough to enter self-supply
fallback.

### Changes

- consumer delivery is now request-driven: a consumer is eligible when it is
  empty, explicitly waiting for logistics, or already in logistics fallback;
- logistics fallback is treated as the most urgent request because that creep
  has already exceeded the normal delivery wait;
- otherwise the longest waiting request is served first; energy ratio, role
  priority, and distance are only tie-breakers after urgency;
- each delivering hauler persists a `consumerTargetId` reservation;
- other live haulers exclude reserved consumers, preventing delivery dogpiles;
- stale/full reservations are cleared automatically;
- when a delivery fills a consumer, its wait/fallback state is cleared
  immediately;
- reservations are cleared whenever the hauler returns to acquisition or must
  refill spawn/extensions/towers first;
- `economyModel` now exposes `consumerWaitingCount`, `consumerRequestCount`, and
  `consumerDeliveryReservations` in addition to `consumerFallbackCount`;
- mining capacity, hauler capacity sizing, spawn safety caps, planner policy,
  defense, Health, Efficiency, and durable telemetry retention are unchanged.

### Regression coverage

The new `consumer-supply.test.mjs` verifies that:

1. a partially used active builder does not steal a delivery from an empty
   upgrader;
2. longer wait age outranks static role priority;
3. a consumer already in fallback remains urgent after its wait counter resets;
4. two haulers reserve different waiting consumers rather than dogpiling;
5. a successful full delivery clears the reservation and fallback state.

## Install / update

Extract this package and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Then:

```powershell
cd "C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\chatgpt\tools"
npm install
npm test
npm run doctor
npm run deploy
npm run logs
```

Expected runtime version after deployment: `0.2.15-node18`.

After deployment verify:

```javascript
bot.status()
bot.telemetryStatus()
```

For live acceptance, use a clean 100-tick window. The primary gate is that
`haulerCarryDeficit` stays at 0 while `consumerFallbackCount` and
`consumerWaitingCount` decline without reducing controller/construction
throughput or introducing spawn instability.

---

## Historical documentation from v0.2.14

# Screeps Autonomous Bot v0.2.14-node18

Target path:

`C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\chatgpt`

## v0.2.14 – Capacity-aware Container Logistics

v0.2.14 fixes the first bottleneck identified by the verified Health/Efficiency
telemetry in `container-logistics` mode. The live snapshot at tick `3679900`
reported two haulers, but those bodies provided only 10 active CARRY parts while
the route model required 12. v0.2.13 planned by nominal hauler count, so the
spawn planner stopped at two even while Health correctly reported
`HAULING_DEFICIT`.

This release makes the hauling recommendation capacity-aware without changing
construction, worker, defense, planner, or strategy policy.

### Changes

- `economy.model` now reports `nextHaulerCarryParts`;
- `economy.model` now reports `haulerCarryDeficit`;
- while aggregate live CARRY capacity is below `recommendedHaulerCarryParts`,
  `recommendedHaulerCount` temporarily grows by enough current-sized hauler
  bodies to cover the deficit;
- once aggregate CARRY capacity is sufficient, the recommendation returns to
  the minimum ideal count, allowing transitional overcapacity to age out
  naturally;
- the bootstrap safety ceiling `MAX_BOOTSTRAP_HAULERS = 3` remains unchanged;
- durable telemetry and offline catch-up from v0.2.13 remain unchanged.

### Live regression fixture

The v0.2.14 economy-model regression reproduces the measured state:

```text
energyCapacityAvailable:       550
source route distances:        20 + 9
mining throughput:             20 energy/tick
recommendedHaulerCarryParts:   12
live hauler CARRY:             10
next 550-energy hauler CARRY:   6
```

Expected recommendation while deficient:

```text
haulerCarryDeficit:             2
recommendedHaulerCount:         3
```

After a third 6-CARRY hauler becomes live, aggregate capacity is 16 CARRY and
the recommendation falls back to the ideal count of 2. No haulers are killed or
recycled early; the temporary extra capacity disappears naturally as older
smaller bodies expire.

## Install / update

Extract this package and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Then:

```powershell
cd "C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\chatgpt\tools"
npm install
npm test
npm run doctor
npm run deploy
npm run logs
```

Expected runtime version after deployment: `0.2.14-node18`.

After deployment verify:

```javascript
bot.status()
bot.telemetryStatus()
```

For live validation, wait for a complete 100-tick window and check that
`haulerCarryDeficit` reaches 0, consumer fallback declines, and construction
throughput resumes without introducing CPU or spawn instability.

---

## Historical documentation from v0.2.13

# Screeps Autonomous Bot v0.2.13-node18

Target path:

`C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\chatgpt`

## v0.2.13 – Durable Telemetry Journal / Offline Catch-up

v0.2.13 removes the local PC from the telemetry critical path. The Screeps bot
continues to run exactly as before, while important telemetry is now retained in
server-side `Memory.bot.telemetryJournal`. When the local collector starts or
reconnects, it reads the durable journal first, replays every record newer than
its local sequence cursor, and only then resumes live console capture.

This is an observability-only release. The journal and collector do **not**
influence spawn planning, colony economy, construction, defense, Health,
Efficiency, or Strategy decisions.

### Durable records

The server journal stores:

- every `STATUS_SNAPSHOT`;
- every WARN / ERROR / FATAL record;
- persisted lifecycle events such as `VERSION_CHANGE`, `COLONY_SESSION_START`,
  `SPAWN_OK`, and `PLAN_CHANGED`;
- explicit `ECONOMY_MODE_CHANGE` and `RCL_CHANGE` transitions.

High-frequency `ROOM_HEARTBEAT`, `BOT_HEARTBEAT`, and CPU stream samples remain
live-only so the journal cannot grow without bound.

Each durable record receives a monotonically increasing `jseq`. The journal is
bounded by snapshot count, event count, and an approximate 700 kB byte ceiling.
If the collector stays offline longer than the retained history, it emits a
local `TELEMETRY_RETENTION_GAP` instead of silently pretending the evidence is
complete.

### Collector behavior

`npm run logs` now:

1. acquires a singleton lock so two collectors cannot duplicate the same logs;
2. loads `logs\telemetry-cursor-newbieland.json`;
3. connects/authenticates;
4. reads `Memory.bot.telemetryJournal` over the Screeps HTTP API;
5. replays missing `jseq` records to `bot-events`, `telemetry`, `bot-problems`,
   and `bot-status-latest.json` as applicable;
6. advances the cursor only after records are written locally;
7. resumes the normal websocket live tail.

A stale lock from a hard power-off is detected and replaced automatically on the
next collector start.

### Optional Windows autostart

After installation, the collector can be started automatically on every Windows
logon without Administrator rights:

```powershell
cd "C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\chatgpt\tools"
powershell -ExecutionPolicy Bypass -File .\install-collector-autostart.ps1
```

To remove it again:

```powershell
powershell -ExecutionPolicy Bypass -File .\remove-collector-autostart.ps1
```

Autostart is optional. Durable server-side catch-up remains the source of truth
when the PC is powered off.

### New game-console diagnostics

```javascript
bot.telemetryStatus()
bot.telemetry(20)
```

`bot.telemetryStatus()` reports the newest sequence number, retention floor,
record counts, approximate journal bytes, and oldest/latest retained ticks.

## Install / update

Extract this package and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Then:

```powershell
cd "C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\chatgpt\tools"
npm install
npm test
npm run doctor
npm run deploy
npm run logs
```

Expected test tail includes:

```text
console capture tests passed
telemetry journal tests passed
colony health tests passed
colony efficiency tests passed
game syntax checks passed (25 modules)
```

Expected runtime version after deployment: `0.2.13-node18`.

After deployment, run:

```javascript
bot.status()
bot.telemetryStatus()
```

The first command verifies the runtime version; the second verifies that the
durable journal is active.

---

## Historical documentation from v0.2.12

# Screeps Autonomous Bot v0.2.12-node18

Target path:

`C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\chatgpt`

## v0.2.12 – Phase 3B Colony Efficiency / Pressure telemetry

v0.2.12 extends the verified v0.2.11 Colony Health model with a separate,
strictly observational utilization model. Health continues to answer whether the
colony is stable; Efficiency answers whether available economic capacity is
being converted into useful work.

New in v0.2.12:

- new `colony.efficiency.js` module with a 0-100 `overallScore`;
- status values `PENDING`, `EFFICIENT`, `WATCH`, `UNDERUTILIZED`, and `INEFFICIENT`;
- component scores for `productiveUse`, `energyUse`, `spawnUse`, and `flow`;
- separate pressure classification `SURPLUS`, `BALANCED`, `DEMAND`, or `UNKNOWN`;
- diagnostic reason codes including `PRODUCTIVE_THROUGHPUT_LOW`, `ENERGY_SURPLUS_UNCONSUMED`, `SPAWN_IDLE_WITH_SURPLUS`, `MODELED_DEMAND_NOT_REALIZED`, `CONSUMER_FALLBACK_ACTIVE`, and `HAULING_PRESSURE`;
- `ROOM_HEARTBEAT` and `STATUS_SNAPSHOT` include the full efficiency object;
- `Memory.stats.efficiency` stores compact score/status/pressure summaries;
- efficiency is observational only and does **not** influence spawn, strategy,
  planner, safe-mode, or economy decisions;
- regression tests include the measured v0.2.11 live state from tick 3672900.

### Calibration against the verified v0.2.11 live window

The clean `3672801-3672900` live window had Health `96 / HEALTHY`, while the
colony held full energy for 97% of the window, used 0% spawn time, still had
productive backlog, and converted about 6.77 energy/tick into controller +
construction progress against 18 energy/tick dedicated harvest capacity.

The v0.2.12 regression fixture intentionally classifies that state as roughly:

```json
{
  "health": { "score": 96, "status": "HEALTHY" },
  "efficiency": {
    "overallScore": 31,
    "status": "UNDERUTILIZED",
    "pressure": { "state": "SURPLUS" }
  }
}
```

This is the intended semantic separation: a colony can be safe and stable while
still leaving substantial productive capacity unused.

## Install / update

Extract this package and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Then:

```powershell
cd "C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\chatgpt\tools"
npm install
npm test
npm run doctor
npm run deploy
npm run logs
```

Expected test tail:

```text
spawn planner tests passed
spawn safety tests passed
console capture tests passed
economy model tests passed
logistics fallback tests passed
spawn economy tests passed
colony health tests passed
colony efficiency tests passed
game syntax checks passed (24 modules)
```

Expected runtime version after an approved deployment: `0.2.12-node18`.

## Live validation target after deployment

- Health remains stable and independently interpretable;
- Efficiency reports `UNDERUTILIZED / SURPLUS` when energy remains capped while
  useful work is still available and the spawn is idle;
- productive throughput, capped-energy ratio, spawn utilization, and pressure
  reasons match raw telemetry;
- no behavior changes occur solely because of Health or Efficiency;
- CPU bucket remains healthy.

---

## Historical documentation from earlier releases


Target path:

`C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\chatgpt`

## Node 18 edition

The local tools support Node.js `18.20.0` or newer. The in-game bot itself runs on the Screeps server.

## Install / update

Unpack the archive and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

The installer preserves an existing `tools\screeps.json`, all logs, and older planner reports.

Then:

```powershell
cd "C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\chatgpt\tools"
npm install
npm run doctor
npm test
```

Expected:

```text
spawn planner tests passed
spawn safety tests passed
```

## Configuration

A working `screeps.json` can stay unchanged. Newbieland normally uses:

```json
{
  "newbieland": {
    "protocol": "http",
    "hostname": "screeps.newbieland.net",
    "port": 21025,
    "path": "/",
    "branch": "chatgpt",
    "email": "DEIN_LOGINNAME_ODER_EMAIL",
    "password": "DEIN_PASSWORT"
  }
}
```

Never upload the real credentials file.




## v0.2.7 respawn-ruin compatibility

The final spawn verifier now mirrors the Screeps private-server placement rules more closely for respawns. A `ruin` on the chosen initial-spawn tile is retained in the verification evidence but is classified as non-blocking, so the destroyed previous spawn does not create a false `occupied-tile` failure. Real blocking objects still fail verification.

For the current E8N1 respawn case, rerun:

```powershell
npm run spawn:verify -- --room E8N1 --x 20 --y 29 --name Spawn1
```

If all checks pass, placement can be executed with:

```powershell
npm run spawn:auto -- E8N1 --name Spawn1
```

## v0.2.5 neutral public spawn naming

The default first-spawn name is now `Spawn1` instead of `ChatGPT-Prime`. This only affects future placements; Screeps spawn names are immutable after creation.

## v0.2.4 final spawn safety

v0.2.4 fixes Newbieland room-status parsing and adds a separate read-only preflight before first-spawn placement. Newbieland returns room status in a nested shape such as `room.status`; the verifier now recognizes both nested and top-level response forms.

Run after the deep report has selected the desired target:

```powershell
npm run spawn:verify
```

With no arguments, this loads the newest `initial-spawn-plan-*.json` and verifies its selected room and coordinates using fresh API data. It checks:

- `user/world-status` is exactly `empty`
- room status is exactly `normal`
- a controller still exists and is neither owned nor reserved
- the exact spawn tile is inside the room, not a border tile, not a wall, and has no room object on it
- the requested spawn name is available through `/api/game/check-unique-object-name`
- the expected World branch is present when the server reports branch metadata (missing branch is a warning, not a placement-safety failure)
- `/api/game/place-spawn` is **never called** by `spawn:verify`

The verifier writes `initial-spawn-verification-*.json` to the normal `logs` folder.

For an explicit target:

```powershell
npm run spawn:verify -- --room E8N1 --x 20 --y 29 --name Spawn1
```

`spawn:auto` now reuses the same strict verifier again immediately before the irreversible `place-spawn` call. A failed world-status, room-status, ownership, reservation, tile, or spawn-name check blocks placement.

## Spawn Planner v3: risk, routing and RCL8 blueprint analysis

v0.2.3 keeps the large-area scanner from v0.2.2 and adds a fresh deep-analysis pass for the strongest candidate rooms.

New in v0.2.3:

- non-linear hostile-proximity penalties; an owned room directly next door is now much more serious than a room two or three rooms away
- opponent profiling using observable controller RCL, account room count, username when available, and a coarse recent-activity signal from the stats endpoint
- fresh revalidation of deep candidates, independent of the normal room cache
- explicit top-candidate room-status verification; unsupported private-server endpoints are recorded as unsupported instead of silently treated as verified
- exact terrain-aware routes from the proposed spawn through matching room exits to sources in cardinally adjacent remote rooms
- connected expansion-corridor analysis rather than counting nearby claimable rooms independently
- adaptive RCL8 core-footprint simulation with 3 spawns, 60 extensions, 6 towers, 10 labs, storage, terminal, factory, power spawn, nuker, observer, core link and a road lattice
- eight transformed blueprint variants per spawn anchor
- estimated defensive rampart perimeter, natural-wall usage, object gaps and chokepoint quality
- four separate 0-100 diagnostics: `economyScore`, `layoutScore`, `safetyScore`, and `empireScore`
- a `compositeScore` for diagnosis while the actual planner ranking remains based on the risk-adjusted strategic score
- final pre-placement ownership/reservation/status revalidation immediately before `place-spawn`
- a new deep-review workflow that can reuse the top rooms from an existing planner report, so a 961-room scan does not have to be repeated

## Recommended workflow after the v0.2.2 radius-15 scan

Your existing report can be reused directly. Run:

```powershell
npm run spawn:deep
```

This loads the newest `initial-spawn-plan-*.json` in the `logs` folder, takes its top 10 candidate rooms, refreshes them from Newbieland, and performs the v3 deep analysis.

Equivalent explicit command:

```powershell
npm run spawn:plan -- --from-report latest --deep-top 10 --top-rooms 10 --refresh
```

You can also point to a specific report:

```powershell
npm run spawn:plan -- --from-report "C:\path\to\initial-spawn-plan-....json" --deep-top 10
```

This is still **read-only**. No spawn is placed.

## Full scans

Normal regional scan:

```powershell
npm run spawn:plan -- --around W3N7 --radius 5
```

Large scan:

```powershell
npm run spawn:plan -- --around W3N7 --radius 15 --strategic-radius 2 --top-rooms 15
```

The coarse pass uses cache and staged metadata/terrain retrieval. The strongest rooms then receive the fresh deep pass by default.

To disable the deep pass for a quick diagnostic-only scan:

```powershell
npm run spawn:plan -- --around W3N7 --radius 5 --no-deep
```

`--no-deep` is not allowed with automatic placement.

## Deep metrics

For deep-analyzed rooms the JSON report includes:

- `statusVerification`
- `opponentProfiles`
- `deepAnalysis.remoteRoutes`
- `deepAnalysis.expansionCorridor`
- `deepAnalysis.opponentStrengthPenalty`
- `best.blueprint`
- `best.defensePerimeter`
- `categoryScores.economyScore`
- `categoryScores.layoutScore`
- `categoryScores.safetyScore`
- `categoryScores.empireScore`
- `categoryScores.compositeScore`

The remote-source route calculation is terrain-aware for immediately adjacent cardinal rooms and uses matching border tiles. Rooms farther away are still handled by the expansion-corridor model rather than pretending that straight-line room distance equals a real transport route.

The RCL8 blueprint is an adaptive feasibility simulation, not a promise that the final live colony will use exactly that layout. Its purpose is to reject anchors that look open in a simple radius metric but cannot support a mature base footprint cleanly.

## Reports and cache

Reports:

`C:\Users\hansi\AppData\Local\Screeps\scripts\screeps_newbieland_net___21025\chatgpt\logs\initial-spawn-plan-*.json`

v3 cache:

`spawn-planner-cache-v3-newbieland.json`

The cache contains game-map information, not credentials.

## Automatic first-spawn placement

Only after reviewing the deep result:

```powershell
npm run spawn:auto -- E8N1 --name Spawn1
```

Or let the tool choose from a region:

```powershell
npm run spawn:auto -- --around W3N7 --radius 5 --name Spawn1
```

Placement safety:

- cache is disabled for placement mode
- the v3 deep pass is mandatory
- selected room ownership/reservation is checked fresh during analysis
- the v0.2.4 final verifier runs **again** immediately before placement
- Newbieland nested `room.status` is parsed and must resolve to `normal`
- `user/world-status` must still be exactly `empty`
- the exact selected tile must still be buildable and unoccupied
- the spawn name must still pass the unique-name API check
- only then is `/api/game/place-spawn` called
- afterward the tool attempts to activate branch `chatgpt` when that branch exists on the server

## Colony bot after the spawn exists

The game bot currently includes bootstrap logic, dynamic population targets, harvesters, haulers, workers, builders, repairers, upgraders, defenders, scouts, body scaling, towers, construction planning, CPU protection, visuals, scouting, error boundaries, and structured diagnostic logs.

Useful game-console commands:

```javascript
bot.help()
bot.status()
bot.logs(50)
bot.dump()
```

## Local live logs

```powershell
npm run logs
```

Writes console, structured bot events, problems, telemetry and collector errors to the local `logs` folder.
\n\n## v0.2.7 live-bootstrap / collector fixes\n\n- Runtime version is now `0.2.7-node18` and the internal bot label is neutral (`Autonomy`).\n- Fresh-colony RCL1 bootstrap spawns one worker after the first harvester before filling the second harvester slot.\n- Harvesters without source containers now carry full loads to spawn/extensions/towers instead of always dropping energy.\n- Colony sessions are keyed to the owned spawn id; a new session clears stale in-memory log history after a respawn.\n- `STATUS_SNAPSHOT` is emitted every 100 ticks with controller, energy, creep-role, spawn, construction, hostile and CPU data.\n- The local collector decodes Newbieland HTML entities before parsing `[BOTLOG]` JSON.\n- `STATUS_SNAPSHOT` events are appended to telemetry and also written to `logs\\bot-status-latest.json`.\n