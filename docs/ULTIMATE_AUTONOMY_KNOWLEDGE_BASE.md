# Ultimate Autonomous Screeps Bot – Reference Architecture Knowledge Base

Stand: 2026-10-04  
Status: canonical research input for the next-generation architecture  
Repository: `Riflex91/boringstuff`

## 0. Purpose

This document captures the concepts, algorithms, architecture patterns, strengths, weaknesses, and reusable design lessons found while studying four autonomous Screeps bots:

1. `sklemmer/screeps-bot` (TooAngel lineage)
2. `code-addicts-anonymous/screeps-bot`
3. `kasami/kasamibot`
4. `The-International-Screeps-Bot/The-International-Open-Source`

The target is **not** to merge four foreign codebases. The target is a clean, independently designed bot that uses the best proven ideas while preserving our own measured, testable architecture.

The canonical synthesis is:

```text
Runtime / Server Capabilities
        ↓
World + Colony State
        ↓
Problems / Opportunities / Threats
        ↓
Prioritized Requests / Needs
        ↓
Required Capacity + Resource Budgets
        ↓
Spawn / Logistics / Work / Combat Plans
        ↓
Assignments
        ↓
Creep / Structure Intents
        ↓
Telemetry + Outcome Measurement
        ↓
Prediction Error / Replanning / Adaptation
```

Creeps are executors. Colonies and the empire decide what is needed.

---

# 1. Non-negotiable target properties

## 1.1 Zero-touch autonomy

The finished bot must require **no manual gameplay input** after initial code deployment.

Forbidden as required operating mechanisms:

- expansion flags;
- manually chosen expansion rooms;
- manually placed first spawns for later colonies;
- manually placed storage / rally / lab / tower anchors;
- manual remote selection;
- manual combat targets for normal operation;
- manual market thresholds that are necessary for survival;
- manual room-role assignment;
- manual reaction selection;
- manual recovery actions.

Debug commands and optional operator overrides may exist, but normal behavior must never depend on them.

## 1.2 Server independence

The bot must not assume Newbieland-specific rules.

It must operate on official Screeps, private servers, modified servers where compatible with the Screeps API, and worlds with differing:

- tick rates;
- CPU limits;
- bucket behavior;
- GCL / claim rules;
- room ownership limits;
- map sizes / room availability;
- shard availability;
- market availability;
- power systems;
- optional structures/features;
- reset schedules;
- construction-site policies;
- novice / respawn area rules.

Server-specific observations may be cached, but defaults must be conservative and self-correcting.

## 1.3 Tick-rate independence

Gameplay algorithms operate in **game ticks and measured throughput**, not assumptions about seconds per tick.

Examples:

- creep replacement uses TTL, spawn ticks and path travel ticks;
- economy uses energy/tick;
- construction uses progress/tick;
- logistics uses resource/tick and round-trip ticks;
- CPU scheduling uses actual Game.cpu state;
- freshness uses Game.time deltas.

Wall-clock time is observability only unless a server API explicitly requires it.

## 1.4 Dynamic limits instead of hard-coded room caps

No future architecture may contain a strategic invariant such as `MAX_ROOMS = 3` unless it comes from a detected server rule or explicit test fixture.

Claim capacity is derived from runtime state:

```text
known available claim capacity
= game/GCL capability
- currently controlled rooms
- active claim commitments
- discovered server restrictions
```

If the server returns a claim-related error such as `ERR_GCL_NOT_ENOUGH` or `ERR_FULL`, the capability layer records the restriction, invalidates stale assumptions, backs off, and replans.

The current Newbieland three-room rule remains a live-server constraint for the current release line, but **must become discovered policy**, not next-generation architecture.

---

# 2. Research anchors and licensing boundary

## 2.1 sklemmer / TooAngel lineage

Source:
- https://github.com/sklemmer/screeps-bot
- inspected linked fork `master` around commit `5acfc96d712b202f54b9caa2ad78c658fa4dd3ab` (2017-05-05)
- upstream lineage: https://github.com/TooAngel/screeps

License in linked fork: **AGPL-3.0**.

Consequence: use architectural concepts and independently implement algorithms. Do not copy source into this project without an explicit licensing decision.

## 2.2 Code Addicts Anonymous

Source:
- https://gitlab.com/code-addicts-anonymous/screeps-bot
- public project created 2021; latest visible project update in 2023
- inspected `src/priorities.js`, `tasks.js`, `taskhandling.js`, `taskexecution.js`, `placement.js`, `scan.js`, `pathing.js`, `creeps.js`

No root LICENSE file was visible in the inspected project tree.

Consequence: treat the source as **reference-only**. Do not copy code.

## 2.3 KasamiBot

Sources:
- https://github.com/kasami/kasamibot
- https://kasami.github.io/kasamibot/
- https://kasami.github.io/kasamibot/features.html

The current master removed the historical source in commit `c1dd61799f682dc118f4b58ae19a21878052d456`. The last published source before removal was inspected through parent commit:

`6830e7be851385249ad53cac5aaf259fad2b60e6`

That source contains the original TypeScript manager tree.

License: **CC-BY-3.0** in `LICENSE.md` / package metadata.

Consequence: concepts are useful; direct software-code reuse has non-standard licensing implications. Prefer independent implementation.

## 2.4 The International

Source:
- https://github.com/The-International-Screeps-Bot/The-International-Open-Source
- inspected `Main` and architecture/source tree

Observed reference heads during research:
- Main: `7e5106eebffb9627cf08cf893b6846012d970b90`
- Development: `825c1ba9804fea87342f3c4e454b03433c167c3f`

License warning:
- root `LICENSE` says MIT;
- `package.json` says `GNU GPLv3`.

Until that metadata conflict is intentionally resolved, use it as a design reference and avoid blind source copying.

---

# 3. Bot study: sklemmer / TooAngel lineage

## 3.1 Architectural model

TooAngel is historically important because it was designed around the explicit objective of a fully automated Screeps player.

The linked implementation is prototype-heavy:

```text
main
→ brain/global coordination
→ room.execute()
→ owned/external room logic
→ creep.handle()
→ role action / routing
```

A room owns a spawn queue. Roles provide settings and behavior. Routing and room planning are persisted in Memory.

The important lesson is not the old prototype structure. It is the commitment to **closed-loop automation and recovery**.

## 3.2 Spawn queue

Each room keeps `memory.queue`.

Key ideas:

- requests enter a room queue;
- queue entries are sorted by role/target priority;
- same-room economic roles beat remote work;
- remote priority incorporates distance;
- queue entries have TTL so impossible requests eventually expire;
- body generation is parameterized by room/controller conditions;
- body templates are repeated until energy or 50-part limits are reached.

Useful synthesis:

- keep a central spawn demand queue;
- requests need deadlines / TTL;
- calculate bodies from required capacity rather than fixed role sizes;
- distance belongs in the cost function;
- queue starvation must be observable.

## 3.3 Predictive creep replacement

TooAngel contains an early version of an idea we independently rediscovered during v0.2.20:

- creeps calculate a future replacement point;
- before death, they enqueue their successor;
- role/routing identity can be preserved.

This is a key proof that **replacement belongs in planning, not post-death recovery**.

Our next generation generalizes this from a per-creep trigger to:

```text
replacementLead =
spawnQueueDelay
+ spawnDuration
+ deploymentTravel
+ safetyMargin
```

and compares projected surviving capacity against future need.

## 3.4 Routing

TooAngel uses:

1. room-level routing with `Game.map.findRoute`;
2. cached intra-room paths;
3. named paths between a central path start, exits, sources, controller and targets;
4. path timestamps for invalidation;
5. path-aware road construction;
6. congestion handling / creep movement cooperation.

Useful lesson: separate **strategic route selection** from **tile-level travel**, and cache stable paths aggressively.

## 3.5 Base planning

The linked design constructs a base from geometric/path anchors:

- central storage/upgrader/filler/path-start region;
- paths to sources, controller, mineral and exits;
- major structures placed around important path geometry;
- walls around exits, replacing path crossings with ramparts;
- automatic structure checking/rebuilding.

Strength: layout derives from room topology rather than a completely fixed coordinate list.

Weakness: planning is tightly coupled to historic role assumptions and old APIs.

## 3.6 External economy

Roles such as `sourcer` and `carry` establish a producer/transport split:

- source creep mines at source;
- container/link provides buffer;
- carry creep transports;
- remote sourcer can create/maintain container;
- transport behavior can reverse direction based on carried capacity and conditions;
- road building is coupled to repeated travel.

The important abstraction is a **transport lane with producer, buffer, route and carrier demand**.

## 3.7 Expansion

`brain.handleNextroom` checks ownership count vs GCL and a configured maximum, then periodically sends scouts from suitable rooms.

Useful:
- expansion begins from strategic capacity, not arbitrary timers;
- parent colonies participate;
- new rooms can receive bootstrap units from existing rooms;
- fallen rooms can be rebuilt.

Do not copy:
- configured hard room maximum;
- periodic scout cadence as a fixed strategic rule.

## 3.8 Defense / combat

The bot includes:

- friend/enemy memory;
- rampart-oriented defenders;
- ranged flee logic;
- squads with siege/heal groups;
- staged move → attack state;
- automatic target preference;
- autoattack concepts.

The code is old and tactical logic is relatively heuristic. Its main value is demonstrating that defense and offense can be incorporated into the same autonomous lifecycle.

## 3.9 Market / player state

Incoming transactions and player behavior influence player memory. Market orders are filtered/scored and room transaction energy cost is considered.

Important lesson: world actors need durable reputation/intel state; market decisions must include **transaction energy cost**, not only price.

## 3.10 What we keep conceptually

- zero-touch goal;
- persistent room route model;
- automatic room rebuild/recovery;
- proactive replacement;
- spawn queue;
- dynamic body templates;
- automatic scouting/expansion trigger;
- external producer/carrier split;
- player reputation memory.

## 3.11 What we reject

- prototype-global coupling;
- fixed configured maximum room count;
- role-first economy;
- manual configuration as a normal dependency;
- path/layout assumptions tied to one base style;
- old combat heuristics as strategic decision logic.

---

# 4. Bot study: Code Addicts Anonymous

## 4.1 Core differentiator: hybrid dynamic task system

This is the strongest concept in the project.

Rather than assigning every worker a permanent role, the bot defines task IDs and assignment classes such as:

- worker;
- scout;
- soldier;
- claimer;
- spawn/control.

Tasks include:

- energy harvesting;
- energy transfer;
- controller upgrading;
- tower/extension/road/wall/storage/link construction;
- wall repair;
- tower refuel;
- scouting;
- expansion influence;
- defense;
- spawning.

Each room calculates task priorities from current state.

## 4.2 Priority functions

Examples of state-derived priority:

- harvesting rises when storage energy falls;
- energy transfer rises when spawn energy ratio falls;
- controller upgrade is forced high near downgrade risk;
- tower refueling is based on the least-filled tower;
- wall repair uses desired wall hit points;
- expansion combines resources and defense difficulty.

This maps directly to our desired:

```text
state → need severity → priority
```

instead of:

```text
role count → spawn more
```

## 4.3 Marginal-priority task allocation

Task assignment contains a particularly useful algorithm:

1. find the highest-priority task compatible with a creep;
2. assign it;
3. decrement that task's priority;
4. repeat for the next creep.

This approximates **marginal utility allocation**: the first worker goes to the most urgent need, but after adding capacity the task becomes less attractive.

There is also a **task continuation bias**. A creep does not switch tasks for a tiny priority improvement.

This is directly useful for our next-generation Job/Assignment layer.

Generalized version:

```text
score(creep, request) =
request.marginalUtility
- travelCost
- switchCost
- capabilityMismatch
- deadlineRisk

after assignment:
request.remainingCapacity -= creep.capacity
recompute marginalUtility
```

## 4.4 Blocked-task feedback

If a task cannot progress, it can be temporarily blocked for a defined period. Reassignment avoids that task until the blockage expires.

This is valuable because many Screeps systems fail transiently:

- no reachable target;
- no energy;
- construction unavailable;
- unsafe path;
- temporary capacity shortage.

Our request system should store:

```text
blockedUntil
blockReason
failureCount
lastFailureTick
retryPolicy
```

instead of allowing a creep to thrash every tick.

## 4.5 Priority history → spawn demand

The bot keeps recent post-assignment priority history. Persistent unmet worker-task priority is converted into **spawning priority**.

This is an important bridge:

```text
unmet work demand over time
→ required additional execution capacity
→ spawn request
```

That is more robust than static population targets.

Our version should avoid role counts entirely where possible and calculate missing WORK/CARRY/MOVE/CLAIM/combat capacity.

## 4.6 CPU-aware spawning

Spawning can be suppressed when average CPU usage approaches the budget.

Good concept, but our implementation should not stop critical recovery spawning simply because CPU is high. CPU pressure must reduce optional work first.

Priority order:

```text
survival / defense / recovery
> core economy
> replacement
> growth
> optimization
> opportunistic work
```

## 4.7 Dynamic construction

The placement system is highly topology-driven.

Observed techniques:

- roads planned from spawn to sources/controller;
- road plans persisted and checked incrementally;
- only a small number of positions are processed per tick;
- extension placement follows a generated spiral/search path and looks for free grouped rectangles;
- towers are positioned relative to path/defense geometry;
- remote defensive structures are placed from room-exit/wall geometry;
- invalid anchors are banned and alternative anchors are attempted;
- expensive placement work is spread across ticks.

This strongly supports our requirement that planning be:

- incremental;
- topology-aware;
- cached;
- restartable;
- capable of invalidating a failed anchor.

## 4.8 Expansion / combat

The project can settle empty rooms or attack occupied ones. Expansion priority uses resource quality and defense difficulty.

However, **target selection is manually initiated via flags/memory mappings**.

We keep:
- scoring empty vs occupied targets differently;
- staged attack composition;
- path feasibility in expansion score.

We reject:
- manual expansion flags;
- manual parent-force mapping;
- manual spawn/storage/rally anchor flags.

## 4.9 Remote mining

Workers can transition into remote mining and retreat from dangerous rooms. Remote suitability is checked dynamically.

Useful lesson: remote mining should be a request generated by a profitability model, not a permanently assigned room role.

## 4.10 What we keep conceptually

- room-local dynamic needs;
- marginal-priority allocation;
- continuation/switching hysteresis;
- blocked-task backoff;
- persistent unmet demand → spawn demand;
- incremental dynamic placement;
- topology-first structure placement;
- CPU-aware optional work;
- dynamic worker utilization.

## 4.11 What we reject

- manual expansion target workflow;
- manual spawn/storage/rally anchors;
- fixed creep type as the main capacity model;
- lack of empire-level cooperation;
- limited late-game systems.

---

# 5. Bot study: KasamiBot

## 5.1 Architecture

Historical TypeScript source is manager-oriented.

Core orchestrates many managers:

- Memory
- Intel
- Upgrade
- Logistics
- Expansion
- Roomlevel
- Scouting
- Outpost
- Mineral
- Defense
- Boost
- Operation
- Military
- Market
- Crisis
- Link
- Mining
- Hauling
- Power
- Trade
- Build
- Maintenance
- Road
- Lab
- Wall
- Poaching
- Harass
- Spawn

This is a useful domain decomposition, but the next generation should use clearer data contracts and less manager-owned mutable state.

## 5.2 Multi-priority CPU scheduler

Kasami's Core runs managers at multiple priority levels:

```text
Critical
Standard
Low
Trivial
Overflow
```

Lower-priority passes only run while CPU remains below a dynamic budget. Overflow work runs with a very high bucket.

Its CPU budget itself scales with current bucket.

This is one of the strongest ideas in KasamiBot.

Our generalized scheduler should support:

- critical every-tick processes;
- deadline processes;
- sleepable processes;
- event-triggered processes;
- background planning;
- overflow optimization;
- per-process measured CPU;
- starvation protection;
- degraded mode.

## 5.3 Spawn orders

Other managers create orders; SpawnManager only processes them.

Orders have:

- priority;
- body;
- role;
- memory/target;
- optional twin order.

Before entering the queue, bodies are validated against:

- room energy capacity;
- non-empty body;
- 50-part maximum.

The spawn queue is sorted by priority.

The architectural lesson is critical:

**the spawn should not decide what the colony needs.**

The planner produces requests. Spawn scheduling executes them.

## 5.4 Room-level lifecycle

Kasami models room development in stages / room levels, changing behavior as infrastructure matures.

Examples from documentation:

- pioneers cover multiple jobs early;
- dedicated miners appear later;
- links change upgrader logistics;
- pooled haulers replace source-specific haulers at higher maturity;
- labs/power/industry activate only when the economy supports them.

We should retain lifecycle awareness but replace rigid RCL-only transitions with capability predicates:

```text
canUseDedicatedMining =
container/link available
AND replacement safety
AND transport capacity sufficient
```

RCL is a capability input, not the entire state machine.

## 5.5 Hauling evolution

Kasami transitions from:

- self-hauling pioneers;
- dedicated container miners;
- source-specific haulers;
- pooled haulers.

This supports a key next-gen principle:

**logistics topology should evolve with infrastructure.**

Possible modes:

```text
direct carry
→ dedicated lane
→ shared haul pool
→ hub / link / terminal network
```

The mode should be selected from measured cost, not hard-coded age alone.

## 5.6 Intel and expansion scoring

Rooms gather regional intel with proximity scouts and age the information.

Expansion candidates are evaluated from:

- mineral;
- source access;
- nearby source opportunities;
- room characteristics;
- strategic value.

Each colony can nominate candidates and a higher-level decision chooses among them.

This is the right hierarchy:

```text
local candidate generation
→ empire-wide comparison
→ selected expansion operation
```

We must make the whole pipeline automatic.

## 5.7 Expansion bootstrap

Kasami uses expansion workers until the new room reaches sufficient independence, then transitions to normal colony operation.

This suggests an explicit colony lifecycle:

```text
DISCOVERED
→ CANDIDATE
→ CLAIMING
→ BOOTSTRAPPING
→ RECOVERABLE
→ STABLE
→ MATURE
```

Support should taper automatically as the child colony becomes self-sufficient.

## 5.8 Defense

Kasami includes:

- outpost defenders;
- support requests;
- owned-room active defenders;
- rampart defenders;
- ranged defenders;
- neighboring-room assistance;
- inner fortress/border defense;
- Safe Mode when the core is threatened.

Important abstraction: defense is not room-local only. It is a **regional support problem**.

## 5.9 Military operations

The architecture contains explicit operations and specialized teams:

- power-bank operations;
- guard;
- haul;
- drain;
- harass;
- wrecker/team combat;
- source-keeper operations.

Useful lesson: complex multi-creep activity should be represented as an **Operation object/state machine**, not scattered role conditions.

## 5.10 Market / trade / distribution

Kasami separates:

- internal distribution;
- market logic;
- terminal logistics;
- strategic stock targets.

It distributes energy, minerals, power and boost resources between rooms before/alongside market use.

This is exactly what an Empire Resource Allocator should eventually do.

## 5.11 Pathing

Kasami's Traveler implementation includes:

- room-route filtering;
- highway preference;
- SK avoidance;
- hostile-room avoidance;
- structure matrix caching;
- creep matrix caching;
- stuck detection;
- path invalidation;
- serialized compact path strings;
- portal awareness;
- route distance restrictions.

This remains an excellent conceptual pathing reference.

## 5.12 What we keep conceptually

- multi-priority CPU scheduling;
- order-producing domain systems with dumb spawn execution;
- room lifecycle;
- logistics topology evolution;
- intel aging;
- local candidate → empire expansion selection;
- operation objects/state machines;
- regional defense support;
- strategic inter-room resource distribution;
- robust travel/path caching.

## 5.13 What we reject

- configuration switches required for normal strategic behavior;
- RCL alone as lifecycle truth;
- large collection of permanent specialized roles as the primary architecture;
- fixed periodic timings where event/deadline scheduling is better.

---

# 6. Bot study: The International

## 6.1 Architectural direction

The International explicitly documents a primarily data-oriented design.

It distinguishes:

- Utils: pure information helpers;
- Procs: processing logic;
- Ops: operational logic;
- Services: plural/batch execution;
- Managers: stateful orchestration, to be minimized;
- Data: state separated from functions.

This is the closest reference to the architecture we want.

## 6.2 Main-loop composition

The main loop coordinates systems such as:

- Memory optimization;
- migration/init/respawn;
- collective state;
- room data;
- requests;
- player intelligence;
- creeps;
- power creeps;
- construction;
- market;
- room services;
- segments;
- stats;
- garbage collection;
- map visuals.

This demonstrates a scalable global lifecycle where empire services surround per-room execution.

## 6.3 Spawn requests by capacity

Spawn request constructors can build bodies from:

- minimum cost;
- maximum cost;
- default parts;
- repeated extra parts;
- creep quota;
- parts quota;
- max creeps;
- current spawn group.

The particularly useful concept is **parts quota** rather than only creep quota.

Example abstraction:

```text
need 24 CARRY capacity
current active projected CARRY = 14
queued projected CARRY = 4
missing = 6
→ construct cheapest suitable body(s) that supply ≥6 CARRY
```

This is directly aligned with our Dynamic Economy target.

## 6.4 Logistics request model

The source tree and commune flow show explicit room logistics requests for:

- transfers;
- offers;
- storing structures;
- containers;
- dropped resources;
- tombstones;
- ruins;
- spawning structures.

Structures publish logistics requests instead of haulers containing all world policy.

This is a core pattern to adopt.

## 6.5 Hauler need

The architecture contains explicit hauler-need calculation and adaptive minimum hauler cost.

This demonstrates separation between:

- how much logistics capacity is needed;
- how large individual haulers should be;
- how many requests/bodies satisfy that capacity.

Our version should calculate transport work directly:

```text
requiredCarryParts
≈ ceil(resourcePerTick × roundTripTicks / CARRY_CAPACITY)
```

then adjust with measured queue latency and loss.

## 6.6 Remote model

Remotes maintain persistent source/path/controller data and can change path type depending on colony infrastructure.

Per-source state includes harvest capacity and hauling requirements.

Useful:
- remote = persistent economic asset model;
- source-level paths;
- credit/need accounting;
- periodic usability checks;
- ability to detach a remote.

Our version adds explicit ROI and threat probability.

## 6.7 Construction / planner

The source contains:

- base plans;
- stamp-based planning;
- rampart plans;
- tower planning;
- Min-Cut;
- remote planning;
- construction management;
- experimental neural-network code.

The strongest reusable concepts are:

- separate plan from execution;
- stamps as reusable local geometry;
- Min-Cut for defense perimeter;
- path-aware plan evaluation;
- persist plans in segments;
- version/migrate plans.

Do **not** make a neural network part of the critical planning path unless a measurable supervised/optimization objective exists.

## 6.8 Custom pathfinder

The custom pathfinder supports weighting:

- exits;
- planned structures;
- remote paths;
- stationary positions;
- creeps;
- enemy ranges;
- keeper lairs;
- impassable structures;
- custom coordinate maps.

Key lesson: movement should consume the same world model as planning and defense. A unified cost-field model is preferable to each role calling `moveTo` independently.

## 6.9 Defense

The architecture separates defense processes, utilities, tower behavior and combat requests.

This supports:

```text
Threat Model
→ Defense Request
→ Required Combat Strength
→ Spawn/Assignment
→ Tower/Rampart Coordination
```

instead of “hostile exists → spawn defender”.

## 6.10 Stats and tick length

The stats layer records:

- energy inputs/outputs;
- spawn usage;
- remote input;
- CPU;
- memory;
- heap;
- GCL/GPL;
- tick-length timestamp delta.

This is important for portability: real tick length can be observed without using it as a gameplay constant.

## 6.11 Segments

Segments persist larger data such as base plans and IDs outside normal Memory.

Use cases for our bot:

- world intel;
- planner blueprints;
- route cache;
- long-horizon telemetry summaries;
- learned policy parameters.

The bot must degrade correctly if segments are unavailable.

## 6.12 Late-game breadth

The International contains modules for:

- labs;
- factories;
- terminal;
- market;
- observer;
- nuker;
- power spawn;
- power creeps;
- remotes;
- squads / duo / quad combat;
- inter-player protocol.

This makes it the broadest technical reference of the four.

## 6.13 What we keep conceptually

- data-oriented contracts;
- request-based logistics;
- part-capacity spawn quotas;
- remote persistent models;
- Min-Cut defense planning;
- stamp/planner separation;
- custom cost-field pathing;
- segments as optional large-state backend;
- broad late-game modularity;
- measured stats.

## 6.14 What we reject / improve

- architecture complexity without strict dependency boundaries;
- hard-coded strategic values that can be derived;
- experimental ML in safety-critical planning;
- any need for manual flags in normal operation;
- license ambiguity as a reason for direct code reuse.

---

# 7. Cross-bot synthesis

| Problem | Best observed idea | Our synthesized implementation |
|---|---|---|
| Full autonomy | TooAngel | Zero-touch invariant + automatic recovery |
| Dynamic work | Code Addicts | Need/request graph + marginal utility assignment |
| CPU scheduling | Kasami | priority/deadline scheduler with bucket-aware background work |
| Spawn architecture | Kasami + International | domain-generated capacity requests, centralized spawn executor |
| Body sizing | TooAngel + International | capacity quotas + energy/travel/survival body optimizer |
| Replacement | TooAngel + our v0.2.20 findings | projected future capacity using TTL + queue + spawn + travel |
| Logistics | International + Kasami | request network + shared haul pool + evolving topology |
| Base planning | all four | topology analysis + stamps + path objectives + Min-Cut + incremental planning |
| Pathing | Kasami + International | world route graph + shared cost fields + cached path representation |
| Expansion | Kasami | automatic candidate discovery + empire-level scoring + operation lifecycle |
| Dynamic expansion combat | Code Addicts | feasibility/defense score feeding autonomous operation planner |
| Defense | Kasami + International | threat strength model + regional requests + rampart/tower coordination |
| Recovery | TooAngel | explicit recovery state with hard safety invariants |
| Intel | Kasami + International | freshness-aware persistent world model |
| Late game | International | modular capability-driven industry/power/market |
| Evidence-driven tuning | our bot | offline fixtures + deploy receipt + smoke + live gates |

---

# 8. Canonical next-generation architecture

## 8.1 Layer 0 – Runtime Capability Discovery

New module family:

```text
runtime.capabilities
server.profile
feature.registry
policy.discovery
```

Produces a normalized object such as:

```text
RuntimeCapabilities
- apiVersion / environment fingerprint
- shardName / shardCount if available
- cpuLimit
- bucketCurrent
- bucketObservedMax
- heapStatsAvailable
- rawSegmentsAvailable
- marketAvailable
- interShardMemoryAvailable
- powerCreepsAvailable
- controllerStructureCapabilities
- currentGCL
- ownedRoomCount
- observedClaimRestriction
- constructionSiteBehavior
- worldStatusCapabilities
- measuredTickDurationStats (observability only)
```

Feature checks must be defensive. Missing optional APIs must disable only the dependent subsystem.

## 8.2 Layer 1 – World Model

Persistent normalized entities:

```text
WorldModel
├── ServerProfile
├── EmpireState
├── PlayerIntel
├── RoomIntel[]
├── RouteIntel[]
├── MarketIntel
└── FeatureCapabilities
```

RoomIntel fields include:

- ownership/reservation;
- RCL;
- sources/mineral;
- terrain summary;
- exits;
- highways/SK/portal classification where applicable;
- structures;
- threat;
- lastSeen;
- confidence/freshness;
- travel costs;
- remote value;
- expansion value;
- defense geometry;
- neighboring-room relationships.

All intel has freshness and confidence.

## 8.3 Layer 2 – Colony State

Colony State contains facts, not policy:

- source production;
- stored resources;
- projected income;
- construction backlog;
- controller safety;
- spawn availability;
- creep capacities;
- future creep capacities after TTL;
- logistics requests;
- infrastructure;
- defense state;
- local CPU cost.

## 8.4 Layer 3 – Needs / Request Graph

Canonical request structure:

```text
Request
- id
- domain
- target
- resource / capability
- amount
- currentSatisfied
- priority
- deadlineTick
- utilityCurve
- maxUsefulCapacity
- location
- risk
- blockedUntil
- failureReason
- dependencies[]
- reservations[]
```

Examples:

- deliver 100 energy to spawn by tick X;
- maintain 10 WORK harvesting capacity at source;
- supply 12 CARRY transport capacity for route;
- build 500 construction progress;
- keep controller downgrade risk below threshold;
- provide 600 ranged DPS at breach;
- scout room because intel confidence expired.

## 8.5 Layer 4 – Capacity Planner

Converts requests to capacity deficits:

```text
Need
→ required WORK / CARRY / MOVE / CLAIM / ATTACK / HEAL / RANGED / TOUGH
→ projected active capacity
→ subtract reserved/queued/future capacity
→ deficit
```

This replaces most fixed role counts.

## 8.6 Layer 5 – Assignment Engine

Use marginal-utility assignment inspired by Code Addicts:

```text
for each free/reassignable executor:
    score feasible requests
    include travel cost
    include switch cost
    include deadline risk
    choose highest marginal score
    reserve capacity
    reduce request's remaining utility
```

Properties:

- hysteresis to prevent oscillation;
- reservations to prevent dogpiling;
- blocked-task backoff;
- locality preference;
- capability matching;
- emergency preemption.

## 8.7 Layer 6 – Spawn Planner

Spawn requests are produced by capacity deficits, not by the spawn.

Each candidate body is scored for:

- capacity delivered;
- spawn cost;
- spawn duration;
- travel-to-work;
- terrain/path MOVE need;
- expected lifetime utilization;
- replacement timing;
- energy opportunity cost;
- boost availability where relevant.

Projected-capacity planning must account for creeps that will expire before replacement becomes productive.

## 8.8 Layer 7 – Logistics Flow Engine

Represent resource movement as:

```text
SupplyNode
→ TransportEdge
→ BufferNode
→ DemandNode
```

Each edge has:

- distance / travel ticks;
- terrain profile;
- resource/tick;
- required CARRY;
- current projected CARRY;
- queue latency;
- loss/risk;
- infrastructure mode.

Logistics evolves:

```text
self carry
→ dedicated lane
→ shared hauler pool
→ links/hub
→ terminal inter-colony flow
```

Use reservations and matching so multiple haulers do not duplicate work.

## 8.9 Layer 8 – Planner / Construction Engine

Pipeline:

```text
terrain + exits + sources + controller + mineral
→ candidate anchors
→ core/stamp placement
→ logistics path graph
→ structure placement
→ defense Min-Cut
→ traffic simulation / route cost
→ multi-objective score
→ persisted blueprint
→ RCL/capability construction schedule
```

Planner is separate from build priority.

Plans are versioned and migratable.

## 8.10 Layer 9 – Intelligence / Scouting

Scout requests are automatically generated when:

- candidate frontier intel is missing;
- remote intel is stale;
- threat uncertainty is high;
- expansion evaluation lacks data;
- observer can cheaply refresh a room;
- route intelligence is stale.

No scout flags.

## 8.11 Layer 10 – Strategy Director

Strategy chooses among goals:

```text
RECOVER
SURVIVE
STABILIZE
DEFEND
GROW
BUILD
UPGRADE
REMOTE
EXPAND
INDUSTRY
POWER
TRADE
WAR
```

Hard policy precedence:

```text
Recovery > Growth
Defense > Expansion
Core Economy > Optional Industry
Safety invariants > Strategy utility
```

Strategy creates requests. It does not micromanage creeps.

## 8.12 Layer 11 – Operations

Long-running multi-agent activities are explicit state machines:

```text
Operation
- objective
- target
- parent colonies
- phase
- required capacity
- assigned units
- supply budget
- abort conditions
- success conditions
- expected value
- observed value
```

Used for:

- expansion;
- remote bootstrap;
- defense reinforcement;
- siege;
- power bank;
- deposit harvesting;
- evacuation;
- recovery support.

## 8.13 Layer 12 – Empire Resource Allocator

All colonies publish:

- surplus;
- deficit;
- strategic reserve;
- production capability;
- transfer cost.

Allocator decides:

- terminal transfers;
- support creeps;
- lab specialization;
- factory chains;
- boost production;
- energy aid;
- military support.

## 8.14 Layer 13 – CPU Operating System

Processes declare:

```text
priorityClass
deadline
estimatedCost
minimumInterval
freshnessRequirement
canSleep
canDegrade
```

Classes:

```text
CRITICAL
DEADLINE
STANDARD
BACKGROUND
OVERFLOW
```

CPU scheduler:

- measures actual cost;
- respects bucket;
- prevents background starvation;
- spreads expensive planners across ticks;
- caches stable outputs;
- degrades gracefully under low CPU;
- never suppresses survival/recovery logic.

## 8.15 Layer 14 – Measurement / Adaptation

Every planner prediction should be comparable with outcome.

Examples:

```text
predicted route throughput vs actual throughput
predicted replacement coverage vs observed gap
predicted remote ROI vs actual net energy
predicted build rate vs actual
predicted combat damage vs actual
predicted CPU cost vs actual
```

Tuning uses repeated evidence, never one snapshot.

Advanced optimization can adjust safe bounded parameters only after:

1. offline fixture;
2. shadow mode;
3. live observation;
4. canary behavior;
5. release gate.

---

# 9. Universal server capability policy

## 9.1 Detection-first rule

Never branch on server name for normal gameplay.

Bad:

```js
if (server === 'newbieland') maxRooms = 3
```

Target architecture:

```text
observe available capabilities
observe errors/rules
cache ServerProfile
choose compatible policy
```

Server adapters may exist for API transport/deployment tooling, but in-game strategic behavior should depend on normalized capabilities.

## 9.2 Claim-limit discovery

Use layered evidence:

1. standard GCL ownership capacity;
2. server-provided world/account metadata if available;
3. observed claim attempts;
4. `ERR_GCL_NOT_ENOUGH`;
5. `ERR_FULL` or server-specific errors normalized by adapter;
6. current owned/reserved state.

A failed claim updates `ServerProfile.claimPolicy` and invalidates queued claims.

## 9.3 Optional feature registry

Example:

```text
feature.market.enabled = typeof Game.market !== 'undefined'
feature.segments.enabled = RawMemory && RawMemory.segments capability
feature.power.enabled = POWER_CREEP APIs/constants available
feature.interShard.enabled = InterShardMemory available
feature.factory.enabled = structure constants / controller limits available
```

Subsystems register dependencies and do not crash if the feature is absent.

## 9.4 Tick-rate policy

Do not convert strategic values from assumed seconds.

Use:
- TTL ticks;
- travel ticks;
- spawn ticks;
- event age ticks;
- measured energy/tick.

Track timestamp deltas only for dashboards and external operator information.

---

# 10. Development anti-patterns now explicitly forbidden

1. **Manual gameplay dependency**
   - flags required for normal expansion/building/war are not acceptable.

2. **Role count as economy truth**
   - “need 3 haulers” is secondary; “need 12 CARRY over this route” is primary.

3. **Reactive replacement only**
   - planning must project future surviving capacity.

4. **One giant manager**
   - state, policy and execution remain separate.

5. **Per-role pathfinding**
   - use shared route/cost/path services.

6. **Fixed server assumptions**
   - no permanent Newbieland-specific limits in core strategy.

7. **Fixed wall-clock tick rate**
   - use Game.time and measured throughput.

8. **Unbounded planner work**
   - expensive search must be incremental/cached/scheduled.

9. **Behavior changes without observability**
   - add enough telemetry to prove the hypothesized bottleneck first.

10. **ML before objective functions**
    - no neural network in a critical loop until deterministic scoring is insufficient and training/evaluation data exists.

11. **Copying incompatible/unclear licensed code**
    - clean-room implementation is the default.

12. **Optimizing a single snapshot**
    - evaluate windows, cohorts and lifecycle transitions.

---

# 11. Concepts already validated by our own bot

The external research reinforces work already proven useful in `Riflex91/boringstuff`:

- source/route-based economy model;
- capacity-aware hauling;
- durable telemetry;
- Health vs Efficiency separation;
- productive-flow attribution;
- deployment IDs / exact live evidence;
- strict smoke + 100-tick release gates;
- TTL-aware replacement;
- request/reservation thinking in consumer logistics.

Therefore VNext should **evolve** the current bot rather than replace it with an imported architecture.

---

# 12. Canonical implementation principle

When choosing between two designs, prefer the one that answers:

1. What fact did we observe?
2. What need does that fact create?
3. What capacity satisfies that need?
4. What is the cheapest safe plan?
5. Which executor should perform it?
6. How do we know it worked?
7. When should it be reconsidered?

If a subsystem cannot answer those questions, it is probably too role-driven, too hard-coded, or insufficiently observable.

---

# 13. Deep-source algorithm refinements

The first architecture pass established the major patterns. A second source-level pass produced more specific implementation lessons.

## 13.1 Kasami expansion is a resource-budgeted operation, not only a GCL check

Historical `ExpansionManager` demonstrates several useful principles:

- refuse expansion when ownership already consumes current GCL capacity;
- gate expansion on available CPU headroom as well as claim capacity;
- require candidate parent colonies to be sufficiently mature and not under siege;
- compare the best targets proposed by all eligible parent colonies;
- modify candidate value for mineral diversity, catalyst value, nearby Source Keeper mineral diversity, proximity to existing colonies and nearby occupied rooms;
- find an initial spawn position automatically before committing;
- timestamp an expansion attempt and mark/abandon a candidate when establishment fails;
- automatically order claim/bootstrap/support creeps.

Canonical VNext rule:

```text
ExpansionAllowed =
claimCapacityAvailable
AND parentMaturitySufficient
AND empireCpuHeadroomSufficient
AND economySupportBudgetSufficient
AND candidateExpectedValuePositive
AND strategicRiskAcceptable
```

Do not copy Kasami's fixed CPU formula or maturity thresholds. VNext derives them from measured per-colony CPU, current headroom, spawn opportunity cost and recovery reserves.

## 13.2 Expansion score is portfolio value, not only local room quality

Keep two separate functions:

```text
RoomQuality(room)
EmpireFit(room, empire)
```

`RoomQuality` measures the room in isolation. `EmpireFit` measures mineral/resource diversity, support distance, regional overlap, new remote frontier, threat neighborhood, route topology, CPU burden, terminal-network value and military support geometry.

## 13.3 Expansion needs failure memory and retry discipline

Kasami abandons attempts that fail to establish and remembers bad candidates. VNext generalizes this into operation evidence:

```text
attemptCount
lastAttemptTick
failureClass
failureEvidence
blockedUntil
confidence
```

Failure classes include claim-policy rejection, target occupation, unsustainable bootstrap, unsafe routes, no viable planner anchor, vanished support budget and CPU pressure. Structural failures back off much longer than transient failures.

## 13.4 Outposts are portfolio assets with lifecycle

Kasami continually reevaluates desired outpost count, reservers, defenders/supporters, maintenance, occupancy, undefendability and next candidates.

Canonical lifecycle:

```text
DISCOVERED
→ CANDIDATE
→ ACTIVE
→ THREATENED
→ SUSPENDED
→ RETIRED
```

A historically useful remote must be abandoned automatically when its current marginal value becomes negative.

## 13.5 Regional defense is a dispatch problem

Kasami can request help from neighboring healthy rooms. VNext models this as an empire defense request containing target room, required effective combat capacity, latest useful arrival tick, local capacity, tower/rampart support, candidate donor colonies, donor spawn opportunity cost, travel ETA and boost readiness.

The empire chooses the cheapest reinforcement plan that can arrive before the deadline.

## 13.6 Threat state must be body-aware and evidence-backed

Kasami evaluates hostile body parts and boosts; The International separately maintains enemy-attacker state and defense requests.

Canonical pipeline:

```text
hostile observation
→ effective body strengths after boosts/damage
→ mobility
→ target access / breach path
→ tower-zone interaction
→ projected damage/heal
→ asset-loss probability
→ threat state
```

Safe Mode is a predicted-loss decision, not a generic hostile-presence reaction.

## 13.7 The International planner is a staged search pipeline

The inspected planner proceeds broadly through:

```text
configure candidate
→ fast-filler/core
→ topology grid
→ controller upgrade position
→ source harvest positions
→ hub
→ labs
→ source structures
→ extension grid
→ road/source paths
→ late-game structures
→ grid plan
→ Min-Cut
→ protected/unprotected classification
→ source-plan reconciliation
→ onboarding ramparts
→ tower placement/paths
→ mineral infrastructure
→ general shield
→ per-RCL road quotas
→ plan score
→ record candidate
```

VNext planner output must therefore be an inspectable sequence of subplans rather than a monolith. Each phase should expose inputs, result, score delta, CPU used, failure reason and artifacts produced.

## 13.8 Planner candidate anchors should come from economic geometry

The International seeds planning from meaningful points such as controller, sources and midpoints on important paths instead of uniformly searching all 2500 tiles.

VNext candidate generation should use source-controller path geometry, source-source geometry, exit accessibility, logistics centrality, open-area distance transforms and defense-perimeter potential. Expensive scoring runs only for strong candidates.

## 13.9 Plans encode availability over progression

The International stores `minRCL` for structures and per-RCL road quotas. VNext generalizes this to:

```text
PlannedStructure
- type
- coord
- earliestCapability
- constructionPriorityClass
- dependencies
- replacement/migration rule
```

`earliestCapability` is preferred over only RCL so modified servers and optional structures remain compatible.

## 13.10 Min-Cut comes after economic geometry

The International establishes the economic/core topology before defensive Min-Cut.

Canonical sequence:

```text
economic topology
→ protected asset set
→ traffic crossings
→ Min-Cut candidate
→ rampart groups
→ tower coverage
→ breach/repair cost
→ defensive score
```

Do not choose a core solely because it minimizes ramparts; logistics and future expansion remain first-class objectives.

## 13.11 Hauler need and hauler body sizing are separate problems

The International separates haul demand from spawn-request construction.

Canonical split:

```text
Transport Demand Model
    ↓ required CARRY-over-time
Capacity Planner
    ↓ missing projected CARRY
Body Optimizer
    ↓ bodies that satisfy deficit
Spawn Scheduler
```

No route-demand module should produce 'spawn exactly N haulers' as its primary output.

## 13.12 Logistics objects publish demand; haulers consume demand

The International creates logistics requests from containers, storing structures, spawn infrastructure, ruins, tombstones and dropped resources.

Canonical contract:

```text
producer / buffer / consumer
→ publishes supply or demand request
→ logistics engine reserves/matches request
→ executor transports
→ request records progress
```

This removes target-selection policy from the hauler role.

## 13.13 Planner and strategy obey CPU scheduling

The International gates expensive planning on bucket state; Kasami schedules work by priority classes. VNext combines both:

- planner search is BACKGROUND/OVERFLOW unless needed to unblock a deadline;
- active construction execution remains STANDARD/DEADLINE;
- emergency defense can preempt normal planner work;
- incomplete planner state is resumable;
- stable planner artifacts are persisted;
- CPU pressure may defer optimization, never survival.

## 13.14 Derived VNext tests from the deep pass

Add fixtures for:

1. expansion rejected despite free GCL because measured CPU/support budget is unsafe;
2. equal local room quality but different empire resource diversity;
3. failed expansion enters backoff and later reevaluation;
4. negative-ROI remote is suspended without manual action;
5. neighboring colony wins defense dispatch because its ETA beats local spawn ETA;
6. boosted hostile changes threat state while equivalent unboosted body does not;
7. planner candidate fails a late stage and an alternative candidate is tried;
8. planner remains deterministic across restart/resume;
9. changed capability table changes earliest planned structure availability;
10. transport demand changes optimized hauler bodies/count without the demand module knowing creep count.

---

# 14. Recovery, industry and empire-economy refinements

## 14.1 Recovery is an explicit colony mode

Kasami's CrisisManager provides an important structural lesson: recovery should not be hidden inside normal spawning.

Observed concepts:

- detect colonies that have lost most of their local workforce;
- clear stale/irrelevant queued work when the colony state has fundamentally collapsed;
- spawn emergency generalists using currently available energy;
- request support workers from another colony when local infrastructure cannot bootstrap;
- create inter-room emergency energy hauling when a mature room lacks local terminal support;
- abandon strategically failed colonies only under explicit conditions.

VNext must model a first-class `RECOVERY` colony mode.

```text
RECOVERY_ENTER when:
- productive capacity falls below survival floor
- local spawn path cannot restore it before deadline
- energy acquisition loop is broken
- controller / spawn survival is at risk

RECOVERY actions:
1. cancel or deprioritize non-survival requests
2. reserve spawn energy for bootstrap bodies
3. create minimum mining/logistics/control requests
4. request external aid if cheaper/faster
5. rebuild normal capacity
6. exit only after hysteresis-confirmed stability
```

Do not use Kasami's fixed creep-count thresholds. Use capacity floors and estimated time-to-recovery.

## 14.2 Cross-colony aid is a general request type

Kasami's crisis worker and energy-convoy behavior should be generalized into `SupportRequest` rather than implemented as special cases.

```text
SupportRequest
- targetColony
- capability/resource needed
- amount
- latestUsefulArrivalTick
- expectedRecoveryBenefit
- candidateProviders
- providerOpportunityCost
- routeRisk
- transport/spawn plan
```

This same mechanism can later carry defense reinforcement, bootstrap labor, emergency energy, boost compounds and evacuation support.

## 14.3 Memory is a cache/database with lifecycle, not an infinite dump

TooAngel persists serialized paths/cost matrices; Kasami actively garbage-collects dead creep state, old intel, expired power-bank claims and abandoned-room state; The International version-controls memory and large segment-backed artifacts.

Canonical VNext state classes:

```text
EPHEMERAL     per-tick cache; never persisted
SHORT_LIVED   reservations, transient threats, current requests
COLONY        current operational state
WORLD_INTEL   freshness/confidence governed
ARTIFACT      plans/routes/models with schema version
HISTORY       compact telemetry aggregates/evidence
```

Every persistent schema must have:

- schema version;
- migration path;
- ownership/source;
- freshness or explicit permanence;
- garbage-collection rule.

A code deploy must never depend on manually clearing Memory.

## 14.4 Segments are an optional persistence backend

Kasami stores road information/stats in RawMemory segments. The International stores base plans and ID data and explicitly activates segments before use.

VNext uses a storage abstraction:

```text
ArtifactStore
- get(key)
- put(key, value, schemaVersion)
- delete(key)
- availableCapacity()
- capability = memory | segment | none
```

Segments are preferred for large stable artifacts but are never required for basic survival. If unavailable, the bot falls back to compact Memory or recomputation.

## 14.5 Market is part of the resource allocator

TooAngel already accounts for transaction energy when selecting orders. Kasami separates market-price observation from strategic distribution/trade. The International caches market orders, filters hostile actors and maintains/optimizes orders.

VNext market logic must not optimize nominal credits alone.

Define an internal energy shadow price and effective values:

```text
effectiveBuyCost =
creditCost
+ transactionEnergy * energyShadowPrice
+ terminalOpportunityCost

effectiveSellValue =
creditIncome
- transactionEnergy * energyShadowPrice
- reserveOpportunityCost
```

First compare internal empire transfer against external market trade. Market usage is capability-gated and must tolerate an empty/nonfunctional market.

## 14.6 Strategic reserves replace arbitrary fixed stock thresholds

Historical bots commonly use fixed mineral/energy thresholds. They are useful as reference behavior but are not portable enough for VNext.

Each resource instead has:

```text
ResourceReserve
- survivalReserve
- forecastDemand
- operationReservations
- productionPipelineDemand
- desiredBuffer
- excess
```

Forecast horizon is expressed in ticks and expected consumption/production.

## 14.7 Labs become demand-driven reaction planning

The International models reaction decomposition and boost ordering; Kasami separates Lab and Boost management and distributes boost resources between rooms.

VNext pipeline:

```text
future capability demand
→ required boosts/compounds
→ inventory deficit
→ reaction dependency DAG
→ reagent deficit
→ internal transfer / market acquisition
→ lab assignment
→ logistics requests
→ reaction execution
→ boost appointment
```

Lab reactions are not run merely because labs are idle. Production must have a downstream demand or strategic reserve objective.

## 14.8 Boosts are reserved capacity attached to an operation

A combat or economic operation may request a capability that can be satisfied with more body parts or with boosts.

Body optimizer therefore evaluates alternatives:

```text
unboosted spawn cost + spawn time + travel
vs
boosted body + compound cost + lab time + boost logistics + strategic scarcity
```

Boost stock is reserved when an operation commits so unrelated jobs cannot consume it.

## 14.9 Factory production is a graph problem

The International's factory manager chooses products from available production possibilities. VNext generalizes this into a production DAG.

For each candidate product:

```text
expectedNetValue =
outputStrategicValue
- ingredientShadowValue
- energyCost
- terminalTransferCost
- factoryCooldownOpportunityCost
- CPU/logistics cost
```

Only positive-value or strategically required production enters the queue.

## 14.10 Power processing is subordinate to economy health

The International explicitly avoids power processing when stored energy is below its colony minimum. This is the correct priority relationship.

Canonical rule:

```text
processPower only if
power available
AND powerSpawn logistics satisfied
AND energy above dynamic survival/growth reserve
AND processing has positive strategic value
```

Power must never starve core economy.

## 14.11 Power-bank harvesting is an Operation with synchronized phases

Kasami records power-bank value, distance, decay deadline and available attack positions, reserves a bank globally and delays haulers until bank HP is low.

VNext Operation phases:

```text
DISCOVER
→ VALUE
→ RESERVE_TARGET
→ ASSEMBLE_DAMAGE/HEAL
→ TRAVEL
→ ATTACK
→ DISPATCH_HAULERS_JIT
→ COLLECT
→ RETURN
→ SETTLE_ROI
```

Profitability uses current power shadow value rather than a fixed historical market price.

## 14.12 Requests need responder selection and abandonment/backoff

The International maintains empire-level work/combat/haul requests and assigns responders according to suitability/distance, temporarily abandoning requests that are unreachable, occupied or incompatible with room status.

VNext generalizes responder selection:

```text
request
→ candidate responders
→ cheap feasibility filter
→ expensive route/capability validation
→ expected value / deadline score
→ reserve responder
→ execute
```

Always perform inexpensive rejection tests before costly path/search calculations.

## 14.13 Remote accounting should use credit/debt, not only snapshots

The International keeps per-source remote credit, credit change and reservations. This is a useful model for transport backpressure.

VNext should maintain for each producer lane:

```text
producedButUnmoved
reservedForPickup
expectedProductionUntilArrival
transported
lost/decayed
```

This allows hauler assignment to reason about future pickup value, not merely current container energy.

## 14.14 Migration and respawn are first-class lifecycle events

The International explicitly detects respawn and has versioned Memory migrations.

VNext requires:

- deterministic boot with empty Memory;
- soft schema migration when compatible;
- hard migration fallback that preserves only explicitly portable data;
- respawn detection independent of server name;
- invalidation of stale room ownership/operation reservations;
- reconstruction from observable Game state.

Deployment should never silently interpret old memory under a new incompatible schema.

## 14.15 Derived fixtures from recovery/industry research

Add scenario fixtures for:

1. colony loses all miners/haulers but retains spawn and enough energy for a bootstrap body;
2. local recovery is slower than aid from a neighboring colony;
3. stale spawn queue is cleared when colony enters RECOVERY;
4. unavailable RawMemory segments cause graceful artifact fallback;
5. schema upgrade migrates requests without duplicating reservations;
6. market unavailable / empty produces no exception and no required manual configuration;
7. internal terminal transfer beats cheaper nominal market price after transaction energy;
8. lab demand DAG produces a missing compound from base reagents;
9. boost reservation prevents another operation from consuming committed stock;
10. factory candidate is rejected when ingredient shadow value exceeds output value;
11. power processing pauses below dynamic energy reserve;
12. power-bank haulers launch just in time for expected bank destruction;
13. unreachable empire request enters backoff without repeated expensive pathfinding;
14. remote source accounting reserves future pickup and prevents multiple haulers from overcommitting.

---

# 15. Research sources

Primary public references:

- https://github.com/sklemmer/screeps-bot
- https://github.com/TooAngel/screeps
- https://gitlab.com/code-addicts-anonymous/screeps-bot
- https://github.com/kasami/kasamibot
- https://kasami.github.io/kasamibot/
- https://kasami.github.io/kasamibot/features.html
- https://github.com/The-International-Screeps-Bot/The-International-Open-Source

This document is an architectural study and clean-room synthesis. It intentionally avoids reproducing substantial source code from the referenced projects.
