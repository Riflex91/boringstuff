# Ultimate Autonomous Screeps Bot — Research Knowledge Base

Stand: 2026-10-04  
Status: architecture/research basis for the next bot generation  
Scope: synthesis of four established autonomous Screeps bots plus the measured lessons from our current bot.

## 1. Purpose

This document is the durable knowledge base behind the new master roadmap.

A new development chat should be able to read this file and understand:

- which architectural ideas were studied;
- how the four reference bots make decisions;
- which algorithms are worth reproducing;
- which historical design choices should not be copied;
- how those ideas map into our own architecture;
- which invariants are mandatory for a truly autonomous and portable bot.

This is a clean-room architecture study. Concepts and algorithms may be reimplemented, but code must not be copied blindly. Licensing is tracked explicitly below.

---

# 2. Non-negotiable target

The target is not merely a bot with many automated features.

The target is a **zero-touch autonomous control system**.

After installation / account provisioning, normal operation must not require:

- manual flags;
- manual room targets;
- manual spawn positions;
- manual storage positions;
- manual rally points;
- manual remote selection;
- manual expansion selection;
- manual defense activation;
- manual market decisions;
- manual industry recipes;
- manual creep quotas;
- manual server-specific room-limit configuration;
- manual adaptation to tick rate.

The bot must detect state, infer constraints, choose goals, act, measure outcomes, and recover.

Canonical control loop:

```text
Runtime / Server Capabilities
        ↓
World State + Colony State
        ↓
Problems / Opportunities / Threats
        ↓
Strategic Utility + Safety Constraints
        ↓
Prioritized Needs / Requests
        ↓
Required Capacity
        ↓
Plans: Spawn / Logistics / Work / Build / Combat / Expansion
        ↓
Assignments
        ↓
Creep + Structure Intents
        ↓
Telemetry / Outcome / Prediction Error
        ↓
Model update and replanning
```

Core rule:

```text
Colony decides.
Creeps execute.
Measurements correct the colony model.
```

---

# 3. Portability and zero-touch autonomy contract

## 3.1 No hard-coded server identity

Runtime behavior must not branch on names such as:

- Newbieland
- MMO
- private-server hostname
- current room name
- current spawn name

Server-specific differences belong behind an adapter/capability layer.

## 3.2 No fixed room-limit assumption

Never encode:

```text
maxOwnedRooms = 3
```

as a universal strategy rule.

Instead maintain a discovered claim-capacity model:

```text
ClaimCapacity {
  ownedRooms
  standardGclCapacity
  observedServerCap
  reservedClaims
  lastClaimResult
  confidence
}
```

Inputs include:

- `Game.gcl.level` where applicable;
- current owned controllers;
- outstanding claim/expansion reservations;
- claim results such as `ERR_GCL_NOT_ENOUGH`, `ERR_FULL`, `ERR_ACCESS_DENIED`;
- optional server metadata exposed by the external server adapter.

A failed claim because of a server limit becomes learned capability evidence, not a crash or a reason to require user input.

## 3.3 Tick-rate independence

Game logic must be expressed in **game ticks and observed game state**, never wall-clock assumptions.

Examples:

Bad:

```text
"run every 10 seconds"
"assume 3 seconds per tick"
```

Good:

```text
run when data is stale
run before a deadline
run when CPU budget allows
run every N game ticks when N is a game-mechanics horizon
```

Wall time may be collected for operational telemetry, but must not control game strategy.

If a private server runs faster or slower in real time, the bot still behaves identically in game-time semantics.

## 3.4 Capability discovery

Create a `RuntimeCapabilities` snapshot from actual runtime/API availability.

Candidate fields:

```text
RuntimeCapabilities
- cpu.limit
- cpu.bucketAvailable
- marketAvailable
- interShardMemoryAvailable
- shardName
- pixelGenerationAvailable
- powerCreepsAvailable
- factoryAvailable
- commoditiesAvailable
- observersAvailable
- nukersAvailable
- serverApiAvailable
- worldStatusApiAvailable
- placeSpawnApiAvailable
- roomStatusSemantics
- claimCapacityEstimate
- maxConstructionSitesObserved
- supportedStructureConstants
- supportedResourceConstants
- supportedPowerConstants
```

Feature managers must self-disable gracefully when their capability does not exist.

## 3.5 Reset / respawn autonomy

A full reset must not require a human to choose the next room.

Two cooperating components are required:

1. **In-game autonomy kernel** — normal Screeps loop.
2. **Autonomy Supervisor** — external optional controller for operations unavailable to normal game code, especially initial spawn placement on servers exposing HTTP APIs.

Supervisor responsibilities:

- detect empty/respawn state;
- discover server API capabilities;
- scan candidate regions;
- score candidate rooms;
- verify the selected tile fresh;
- place the initial spawn when the server supports programmatic placement;
- activate/upload the runtime branch;
- then step out of strategic decision-making.

If a server does not expose a programmatic placement API, record this as a capability limitation. The normal bot must still require no manual strategic input after a spawn exists.

---

# 4. Reference bot A — sklemmer/screeps-bot / TooAngel lineage

Reference:
https://github.com/sklemmer/screeps-bot

Studied linked fork head:
`5acfc96d712b202f54b9caa2ad78c658fa4dd3ab` (2017-05-05)

License:
AGPL-3.0.

## 4.1 Architectural character

TooAngel's defining idea is full automation.

The linked code uses:

- one global `brain`;
- Room prototype methods as colony controllers;
- role modules for creep execution;
- persistent room memory for paths/layout/queues;
- a per-room spawn queue;
- automatic scouting, expansion, remotes, recovery and attacks.

Its architecture is historically prototype-heavy, but several algorithms remain highly relevant.

## 4.2 Room-first execution

Main loop:

1. protect CPU bucket;
2. prepare memory;
3. global expansion handling;
4. squad manager;
5. transaction/player handling;
6. execute each visible room;
7. execute creeps in that room;
8. emit stats/visuals.

Useful principle:

**rooms own decisions; creeps are subordinate executors.**

This aligns strongly with our desired colony-first architecture.

## 4.3 Spawn queue and body grammar

TooAngel separates "a creep is needed" from "spawn can build it now".

Queue entries carry:

- role;
- target room;
- target id;
- level/base;
- routing information.

Queue priority distinguishes local and remote work.

Bodies are generated from a compact grammar:

- prefix;
- repeatable layout;
- repeat count derived from energy/body-size limits;
- optional suffix.

Example conceptual form:

```text
body = prefix + repeat(layout, affordableCount) + suffix
```

This is useful for our future generic body synthesizer, although we should express the result in capabilities rather than role-specific templates.

## 4.4 Predictive replacement

TooAngel creeps calculate a future replacement point from lifetime/birth state and can enqueue their own replacement before death.

Key lesson:

**replacement is a future capacity problem, not a current creep-count problem.**

Our v0.2.20 TTL-aware hauler work independently reached the same conclusion.

Generalize replacement lead time as:

```text
replacementLead =
    queueDelayEstimate
  + energyAcquisitionDelay
  + spawnTime
  + travelToDuty
  + handoffMargin
```

A capacity unit whose TTL is below that horizon should be considered unavailable for future planning.

## 4.5 Route hierarchy and caching

TooAngel first calculates room-level routes, then cached intra-room paths.

Persistent route state contains:

- room route;
- route position;
- target;
- cached path;
- path creation time / invalidation information.

Benefits:

- lower repeated PathFinder cost;
- deterministic traffic corridors;
- reusable road plans;
- easier remote logistics estimation.

Future design should preserve the two-level distinction:

```text
WorldGraphRoute -> RoomPath
```

but cache by path profile and invalidation version rather than creep-owned ad-hoc memory.

## 4.6 BFS scouting

Scout behavior performs breadth-first exploration over room exits, recording seen/skipped rooms.

Useful properties:

- no preconfigured world map required;
- expands naturally from existing colonies;
- learns inaccessible paths;
- can survive partial visibility.

Future system should evolve this into an Intel frontier queue with information-value scoring.

## 4.7 Automated base building

TooAngel generates a room layout around internally selected anchor/path positions.

It precomputes important paths to:

- sources;
- controller;
- mineral;
- exits.

Structures are placed relative to these transport corridors.

Defensive walls are constructed near exits and path crossings become ramparts.

Important lesson:

**layout is a transport-and-defense optimization problem, not a fixed picture.**

## 4.8 Remotes and expansion

Expansion is automatically considered when owned-room count is below GCL and a configured maximum. Scouts search from eligible rooms.

This is conceptually correct but includes a fixed config max-room ceiling. Our architecture replaces that with discovered claim capacity.

Remote harvesting uses:

- source workers;
- containers/links;
- carriers;
- route-aware logistics.

## 4.9 Combat and recovery

TooAngel includes:

- automatic melee/siege squads;
- defender spawning;
- room rebuild/revive behavior;
- player memory / hostility scoring;
- cross-room squad spawning.

Important design lesson:

Recovery and warfare are not separate scripts; both generate work into the same colony machinery.

## 4.10 Concepts to keep

- colony/room owns decisions;
- fully automated expansion intent;
- BFS world exploration;
- predictive TTL replacement;
- route hierarchy and caching;
- body grammar;
- automatic rebuild/recovery;
- durable layout/path memory.

## 4.11 Concepts to reject or modernize

- prototype-heavy global coupling;
- static role-first design;
- fixed server max-room config;
- many hard-coded tick intervals;
- legacy Screeps API assumptions;
- role logic that mixes routing, combat, construction and strategy.

---

# 5. Reference bot B — Code Addicts Anonymous Screeps Bot

Reference:
https://gitlab.com/code-addicts-anonymous/screeps-bot

Studied main source tree:
`main`, latest source commit lineage through 2023-02-26.

## 5.1 Architectural character

This bot is especially valuable because it deliberately targets:

- low CPU;
- few creeps;
- dynamic task assignment;
- topology-aware automatic construction;
- autonomous colony operation.

Its major limitation is exactly what our target forbids: expansion targets and several advanced placements can require manual flags/memory.

Therefore we reuse the **priority/task mechanism**, not the manual control surface.

## 5.2 Hybrid static + dynamic task model

The bot distinguishes:

- tasks naturally bound to a creep;
- temporary tasks allocated by current priority.

Dynamic priorities are computed per room.

Examples:

- energy harvesting priority rises when storage is empty;
- energy transfer priority rises when spawn/extension energy is low;
- controller upgrading becomes critical near downgrade;
- tower refueling scales with tower fill;
- wall repair scales with wall/rampart deficit;
- defense spawning activates from current threat;
- construction tasks become active as structures are missing.

This is one of the strongest concepts in the four bots.

Our generalized form should be:

```text
Need {
  type
  target
  requiredCapability
  amount
  utility
  urgency
  deadline
  risk
  preconditions
  reservation
}
```

Priority should not be a single hard-coded number. It should be derived from utility, urgency, safety and opportunity cost.

## 5.3 Priority history -> spawn demand

Code Addicts does not only inspect instantaneous priorities.

It stores history of post-assignment task priorities and averages them. Persistent unfulfilled demand is then converted into spawn priorities.

This is important because it prevents:

- spawning from one transient spike;
- oscillating creep populations;
- reacting to noise.

Future algorithm:

```text
unmetNeedEMA
  -> capability deficit
  -> predicted deficit over replacement horizon
  -> spawn request
```

## 5.4 Staggered CPU scheduling

The main loop distributes expensive operations across different modulo periods:

- defense;
- task assignment;
- construction;
- wall placement;
- link planning;
- cleanup;
- other expensive scans.

The exact prime-number schedule should not be copied.

The durable lesson is:

**expensive decisions do not need to run every tick.**

Our scheduler should be deadline/budget based:

```text
run process when:
- dirty state exists, OR
- deadline approaches, OR
- max staleness exceeded,
AND
- CPU budget permits
```

This is more portable than fixed modulo constants.

## 5.5 Dynamic construction

The bot automatically places:

- roads;
- extensions;
- towers;
- walls;
- links.

It adapts placement to room topography rather than requiring a full static blueprint.

This should influence our planner as a hybrid:

```text
fixed high-value core stamps
+ topology-derived transport graph
+ dynamically packed extensions
+ computed defense perimeter
```

## 5.6 Expansion scoring

The expansion task classifies a visible target as roughly:

- settling;
- harassment;
- obliteration.

It calculates resource attractiveness from source/mineral value and defense resistance from hostile towers/body strength/path blocking.

Very useful idea:

**the same target-evaluation engine can decide peaceful expansion vs military prerequisite.**

Our implementation must remove the manual target flag and source candidates from the World Model automatically.

## 5.7 Defense / Safe Mode signals

Interesting heuristics include:

- enemy body-part count vs friendly body-part count;
- spawn damage;
- repeated worker deaths;
- tower attack/heal/repair priority;
- siege mode.

We should retain the idea of multiple independent danger indicators, but replace raw body-count ratios with effective combat simulation.

## 5.8 CPU-health monitoring

The bot keeps a heartbeat and relative CPU usage history, enabling it to detect CPU-limit transgressions.

Future extension:

- per-process CPU EWMA;
- deadline misses;
- cache hit rate;
- planner cost;
- pathfinding cost;
- optional-work shedding.

## 5.9 Concepts to keep

- room-local dynamic task priorities;
- priority history smoothing;
- spawn need derived from persistent unmet work;
- sparse scheduling of expensive work;
- topology-driven building;
- safety signals from deaths / damage / hostile capability;
- expansion modes based on target state.

## 5.10 Concepts to reject or modernize

- manual spawn/storage/rally/expansion flags;
- random remote-room selection;
- one-spawn assumptions;
- fixed modulo scheduling;
- fixed numeric wall thresholds as universal policy;
- limited inter-room cooperation;
- lack of late-game capability support.

---

# 6. Reference bot C — KasamiBot

Reference:
https://github.com/kasami/kasamibot
Documentation:
https://kasami.github.io/kasamibot/

Source was removed from current head, so the architecture study also inspected historical commit:
`6830e7be851385249ad53cac5aaf259fad2b60e6`
which still contains the TypeScript source released for v1.0.

License:
CC-BY-3.0 according to repository LICENSE/package metadata.

## 6.1 Architectural character

KasamiBot is the strongest reference for broad strategic automation.

Its historical source separates many independent managers:

- Memory
- Intel
- Upgrade
- Logistics
- Expansion
- Room level
- Scouting
- Outposts
- Minerals
- Defense
- Boosts
- Operations
- Military
- Market
- Crisis
- Links
- Mining
- Hauling
- Power
- Trade
- Build
- Maintenance
- Roads
- Labs
- Walls
- Poaching
- Harass
- Spawn

That decomposition is valuable even when individual algorithms are dated.

## 6.2 CPU-priority operating model

Kasami runs managers at priority classes:

```text
Critical
Standard
Low
Trivial
Overflow
```

CPU budget is dynamically derived from current bucket.

High bucket permits more optional work; low bucket sheds low-priority managers.

This is one of the best patterns to adopt.

Our successor should use a generalized process scheduler:

```text
Process {
  criticality
  nextDeadline
  maxStaleness
  predictedCpu
  dirty
  dependencies
}
```

The scheduler should maximize strategic utility without risking critical execution.

## 6.3 Spawn orders

Managers create spawn Orders; the SpawnManager only executes them.

Orders include:

- body;
- role/capability;
- target;
- tier;
- priority;
- optional twin order.

Queue is sorted by priority.

Strong principle:

**demand producers do not call spawn directly.**

Our future Spawn Planner should accept normalized capacity requests, synthesize bodies, predict completion/handoff, then schedule all spawns globally/locally.

## 6.4 Room maturity state machine

Kasami uses explicit RoomLevel stages instead of relying only on controller RCL.

This is strategically important.

Two RCL5 rooms may have completely different maturity:

- one has storage, links, stable remotes and defense;
- another has just recovered from collapse.

Our model should use derived maturity states:

```text
BOOTSTRAP
STABILIZING
ESTABLISHED
INDUSTRIALIZING
MATURE
RECOVERING
SIEGE
```

These are derived states, not manually set labels.

## 6.5 Adaptive CPU and energy consumption

Kasami creates additional upgraders when stored energy is abundant and reduces optional work when resources are constrained.

Important generalization:

```text
productive allocation = function(
  sustainableIncome,
  buffers,
  backlog,
  threat,
  spawnOpportunityCost,
  strategicGoal
)
```

No fixed builder/upgrader counts.

## 6.6 Base planner

Kasami combines:

- a compact core;
- adaptive extension wings;
- fallback extension packing;
- roads to sources/controller/mineral/remotes;
- staged RCL construction;
- automatic reconstruction of missing structures;
- internal and outer defensive layers.

The best idea is the **hybrid fixed-core / adaptive-periphery model**.

Our future planner should add:

- min-cut defense;
- traffic measurements;
- future RCL feasibility;
- multiple candidate anchors;
- lifecycle cost scoring.

## 6.7 Mining and hauling evolution

Kasami changes its economy as the room matures:

- pioneers early;
- dedicated miners later;
- assigned container haulers;
- pooled haulers at higher maturity.

This is a useful evolutionary pattern, but should not be keyed to hard-coded RCL thresholds alone.

Our economy should switch architecture when measured conditions support it:

```text
directCarry -> dedicatedMining -> containerLogistics -> link/hubLogistics
```

Transitions depend on available structures, throughput and ROI.

## 6.8 Intel and scouting

Rooms learn their surroundings and refresh stale intel periodically.

Expansion rooms are scored from:

- local sources;
- nearby sources;
- mineral value;
- other strategic characteristics.

When expansion capacity exists, candidate rooms across the empire compete.

This becomes the basis for our World Model + Expansion Market.

## 6.9 Remote selection

Kasami selects outposts by distance and source value and increases remote scope as the economy matures.

Future model should use net value rather than fixed remote counts:

```text
RemoteValue =
  expectedIncome
  - minerCost
  - transportCost
  - reservationCost
  - infrastructureAmortization
  - expectedLoss
  - CPUCost
  - defenseOpportunityCost
```

## 6.10 Inter-room support

Kasami can:

- transfer minerals;
- transfer energy;
- move boosts;
- send defense support;
- bootstrap new rooms.

This is essential for a true empire layer.

## 6.11 Labs, boosts, power and market

Kasami demonstrates that late-game systems can be autonomous through desired-stock policies:

- maintain boost inventory;
- choose reactions from deficits;
- request boosts for combat/work units;
- detect power banks;
- evaluate energy/spawn capacity before power operations;
- distribute scarce resources across rooms;
- buy missing resources / sell excess.

Our future Industry Planner should implement a single dependency graph for reactions, commodities, power and market procurement.

## 6.12 Concepts to keep

- manager separation;
- CPU priority classes;
- demand-generated spawn queue;
- explicit maturity states;
- hybrid adaptive base plan;
- autonomous intel refresh;
- empire-wide expansion competition;
- inter-room logistics;
- autonomous industry/market;
- operation abstraction for multi-creep missions.

## 6.13 Concepts to reject or modernize

- config-controlled strategic modes as required behavior;
- hard-coded remote counts by RCL;
- manual override surfaces as normal workflow;
- dated role proliferation;
- fixed bucket thresholds without measured process cost;
- layout assumptions that are not scored against alternative anchors.

---

# 7. Reference bot D — The International

Reference:
https://github.com/The-International-Screeps-Bot/The-International-Open-Source

Studied branch:
`Main`, repository head observed during research:
`7e5106eebffb9627cf08cf893b6846012d970b90`.

Licensing caution:
the root LICENSE text is MIT, while package metadata declares GNU GPLv3. Treat direct code reuse as restricted until clarified. Use clean-room reimplementation of concepts.

## 7.1 Architectural character

The International is the strongest modern reference.

Its design document explicitly favors data-oriented organization:

- Data = state;
- Utils = pure-ish queries;
- Procs = processing;
- Ops = operational logic;
- Services = plural orchestration;
- Managers only when stateful management is unavoidable.

This maps well to our target because it limits hidden coupling.

## 7.2 Main pipeline

The loop separates:

- memory optimization;
- migrations;
- initialization / respawn;
- stats;
- collective/empire state;
- garbage collection;
- room data update/init;
- transactions;
- requests;
- player intel;
- creep organization;
- power creeps;
- construction sites;
- market;
- room services;
- visuals;
- segments;
- end-tick work.

Key lesson:

**build explicit deterministic pipeline stages instead of allowing modules to call each other arbitrarily.**

## 7.3 Request architecture

The International has empire-level request classes for:

- work;
- combat;
- haul.

Requests can be unassigned, scored, assigned to a capable commune, abandoned temporarily, then reconsidered.

Responder selection considers:

- room status compatibility;
- route distance;
- hostile/keeper path weights;
- energy capacity;
- current request load;
- resource availability.

This is an excellent prototype for our future distributed planner.

Generalized form:

```text
Request
  producer
  target
  capability demand
  utility / urgency
  deadline
  travel cost
  risk
  responder constraints
  reservation
  state
```

## 7.4 Room logistics requests

Structures and resources publish logistics requests such as:

- withdraw;
- pickup;
- transfer;
- offer.

Priorities scale from fill level and role.

Examples:

- source container: withdraw request;
- controller container: transfer request with downgrade urgency;
- dropped resources: pickup request;
- storage/terminal: offer/transfer balancing.

The system uses reserved-store accounting to avoid overcommitting the same energy/capacity.

This is directly relevant to our current consumer-fallback work.

Future logistics should extend this from structure requests to **all energy/resource flow**, including creeps as short-lived consumers.

## 7.5 Spawn requests as capacity descriptions

Spawn requests are not just "spawn role X".

They can describe:

- body default parts;
- repeat parts;
- quotas;
- parts quota;
- min/max cost;
- priority;
- target;
- group;
- memory additions.

Hauler spawning is based on missing carry parts:

```text
carryNeed - currentCarryParts
```

This is much closer to our desired capacity model than fixed role counts.

Future version should generalize to:

```text
CapabilityDemand {
  work
  carry
  move
  claim
  attack
  ranged
  heal
  dismantle
  effectiveRange
  terrainProfile
}
```

## 7.6 Adaptive hauler sizing

The International estimates commune hauler need and can adapt minimum hauler cost/size.

Useful principle:

**optimize fleet composition as capacity, not count.**

Our model should go further and optimize against:

- route cycle time;
- terrain;
- road state;
- pickup wait;
- delivery deadline;
- TTL horizon;
- spawn congestion.

## 7.7 Planner stack

The repository contains:

- commune planner;
- base plans/stamps;
- rampart plans;
- min-cut;
- tower planner;
- remote planner.

This is the strongest reference for a modern planner decomposition.

Target decomposition:

```text
Anchor Candidate Generator
-> Core Stamp Solver
-> Extension / Peripheral Packing
-> Transport Graph
-> Defensive Min-Cut
-> Tower Coverage
-> RCL Feasibility
-> Cost / ROI Score
-> Plan Version
```

Construction execution remains separate from plan generation.

## 7.8 Defense

The International models combat strength and creates defense requests from required:

- damage;
- melee healing;
- ranged healing;
- tower conditions.

Threat data also updates persistent player threat/hate.

This should evolve into our combat simulator:

```text
effectiveDamage(position,t)
effectiveHeal(position,t)
toughMitigation
towerDamage
movement / fatigue
rampart ownership
boost multipliers
timeToBreach
```

Defense should generate capability requirements rather than select a hard-coded defender role.

## 7.9 Remote and empire assignment

Remote management and request assignment distinguish local commune state from empire-level response.

This validates the architecture:

```text
Room local need
-> Empire request
-> best eligible responder
-> capacity allocation
```

## 7.10 Segments and caching

The International uses RawMemory segments for large persistent datasets such as base plans and IDs.

Useful for:

- world intel;
- path caches;
- base plans;
- historical model parameters;
- combat profiles;
- replay snapshots.

Use capability detection because private servers may differ in feature support.

## 7.11 Concepts to keep

- data-oriented module boundaries;
- deterministic pipeline stages;
- request/responder model;
- reserve accounting;
- capacity-based spawn requests;
- planner/min-cut decomposition;
- combat-strength requirements;
- empire-level request routing;
- segments / large-data separation;
- first-class telemetry and performance tooling.

## 7.12 Concepts to reject or modernize

- any manual settings required for strategic autonomy;
- role proliferation where capability assignment can replace it;
- fixed distance thresholds as universal constants;
- arbitrary random scheduling where measured staleness is better;
- incomplete/experimental neural network as a core decision system;
- direct code copying until licensing metadata is reconciled.

---

# 8. Synthesis — target architecture

## 8.1 Layer 0 — Platform / Capability Adapter

Owns all assumptions about the runtime/server.

Responsibilities:

- feature detection;
- server API adapter;
- claim-limit model;
- room-status interpretation;
- tick/runtime telemetry;
- CPU model;
- reset detection;
- external initial-spawn bootstrap where supported.

No strategy module may access server-specific special cases directly.

## 8.2 Layer 1 — World Model

Persistent facts and confidence:

```text
WorldModel
- rooms
- routes
- players
- threats
- portals
- highways
- keeper rooms
- resources
- ownership
- reservations
- structures
- intelAge
- reachability
- uncertainty
```

Every datum includes age/confidence where relevant.

## 8.3 Layer 2 — Colony State Model

Normalized state, independent of individual role implementation:

```text
ColonyState
- income
- buffers
- consumers
- transport graph
- productive backlog
- spawn capacity
- workforce capability
- replacement horizon
- infrastructure
- controller safety
- defense state
- CPU cost
- maturity
- recovery state
```

## 8.4 Layer 3 — Need / Request Graph

All managers publish needs.

Examples:

```text
HarvestNeed
TransportNeed
SpawnEnergyNeed
BuildNeed
RepairNeed
UpgradeNeed
DefenseNeed
ScoutNeed
ReserveNeed
ClaimNeed
IndustryNeed
MarketNeed
RemoteNeed
EvacuationNeed
```

Needs are data, not immediate actions.

## 8.5 Layer 4 — Strategic Utility Engine

Ranks needs from:

- survival;
- hard safety invariants;
- deadline;
- expected economic value;
- strategic value;
- opportunity cost;
- risk;
- confidence.

Canonical precedence remains:

```text
Recovery > Growth
Economy > Expansion
Defense > Expansion
Safety invariants > Strategy
```

But within those constraints, utility is quantitative.

## 8.6 Layer 5 — Capacity Planner

Transforms needs into required capabilities.

Example:

```text
Source route:
income = 10 e/t
round trip = 34 ticks
required transport = 340 energy in flight
=> 7 CARRY minimum before safety margin
```

Capacity planning must include future loss from TTL.

## 8.7 Layer 6 — Plan generators

Independent planners consume normalized demand:

- Spawn Planner
- Logistics Planner
- Work Planner
- Construction Planner
- Path/Traffic Planner
- Defense Planner
- Combat/Operation Planner
- Remote Planner
- Expansion Planner
- Industry Planner
- Market Planner

They emit declarative plans.

## 8.8 Layer 7 — Assignment / Execution

Creeps receive jobs/tasks based on capability, position and switching cost.

Assignment objective:

```text
maximize fulfilled utility
- travel cost
- task switching
- lateness
- collision risk
- opportunity cost
```

Roles may remain as optimized executors, but strategy may not depend on fixed role counts.

## 8.9 Layer 8 — Measurement and learning

Every plan should expose expected outcomes.

Examples:

```text
predicted haul throughput
predicted build throughput
predicted controller progress
predicted remote profit
predicted defense DPS
predicted replacement handoff
```

Telemetry computes prediction error.

Persistent model calibration may tune:

- route safety margins;
- replacement margins;
- build allocation;
- remote risk;
- market thresholds;
- CPU process costs.

Do not use opaque ML where a measurable model is sufficient.

---

# 9. Key algorithms to implement

## 9.1 Deadline-aware replacement

```text
effectiveFutureCapacity(t) =
  sum(capacity of units whose TTL > activationLead)
  + capacity of already-spawning replacements
```

Spawn when predicted capacity at duty time falls below required capacity.

## 9.2 Logistics request matching

Each request has:

- resource;
- amount;
- source/target;
- deadline;
- priority/utility;
- reservation.

Each hauler has:

- cargo;
- free capacity;
- location;
- route cost;
- TTL;
- current assignment.

Match score:

```text
value =
  requestUtility
  - pickupTravel
  - deliveryTravel
  - deadlinePenalty
  - cargoMismatch
  - assignmentSwitchCost
```

Reserve both resource and receiving capacity atomically in planning state.

## 9.3 Demand smoothing

Use rolling windows / EMA for non-emergency capacity:

```text
smoothedDeficit =
  alpha * currentDeficit
  + (1-alpha) * previousDeficit
```

Hard safety needs bypass smoothing.

## 9.4 Remote ROI

```text
NetRemoteValue =
  realizedIncome
  - spawnAmortization
  - reservation
  - hauling
  - roads/containers
  - repair
  - CPU
  - expectedCombatLoss
```

Deactivate remotes whose confidence-adjusted net value remains negative.

## 9.5 Expansion scoring

```text
ExpansionValue =
  LocalRoomValue
  + RemotePortfolioValue
  + MineralDiversity
  + EmpireSynergy
  + StrategicReach
  + MutualDefenseValue
  - BootstrapCost
  - RouteRisk
  - EnemyPressure
  - CPUCost
```

No manual target.

## 9.6 Base candidate scoring

Evaluate multiple anchors/layout variants.

```text
BaseScore =
  spawnFillEfficiency
  + sourceLogistics
  + controllerLogistics
  + mineralLogistics
  + trafficCapacity
  + towerCoverage
  + futureRCLFeasibility
  - defensivePerimeterCost
  - swampCost
  - congestion
  - rebuildCost
```

## 9.7 CPU scheduler

Each process advertises:

```text
criticality
dirty
deadline
maxStaleness
predictedCost
lastRun
```

Critical processes always run.

Optional processes compete for remaining CPU based on utility / predicted cost.

Bucket increases optional-work budget automatically.

## 9.8 Threat capability model

Do not compare raw creep counts.

Normalize active boosted parts into:

- melee DPS;
- ranged DPS;
- heal;
- ranged heal;
- effective HP;
- dismantle;
- move/fatigue;
- claim/controller threat.

Then simulate relevant tactical geometry.

---

# 10. Zero-touch decision rules

The following must eventually require no human input:

## Bootstrap

- detect empty account;
- choose starting region/room;
- choose spawn anchor;
- place spawn through supported API;
- start runtime.

## Colony

- decide population/capacity;
- build structures;
- choose layouts;
- recover losses;
- reserve energy;
- tune upgrade/build split.

## World

- scout;
- refresh stale intel;
- select remotes;
- abandon bad remotes;
- select expansion;
- respect learned claim capacity.

## Defense

- identify threat;
- retreat civilians;
- spawn defense;
- tower targeting;
- rampart policy;
- safe mode;
- request empire support.

## Empire

- route resources;
- choose which colony responds to requests;
- choose industrial specialization dynamically;
- choose expansion parent;
- help recovering colonies.

## Late game

- mine minerals;
- reactions;
- boosts;
- factory;
- power;
- observers;
- nukes;
- market.

## Combat

- identify strategically justified targets;
- estimate feasibility;
- choose operation;
- compose force;
- boost/stage;
- execute;
- abort/reinforce from measured outcome.

---

# 11. What must remain from our current bot

The four reference bots provide algorithms, but our current project already has a major differentiator that should become the foundation:

- durable telemetry journal;
- local catch-up;
- deployment IDs;
- exact deployment-marker verification;
- offline regression suite;
- Node-version gate;
- smoke gate;
- 100-tick live gate;
- Health model;
- Efficiency model;
- Productive Flow attribution;
- evidence-driven corrections;
- append-only release evidence.

Do not replace this with a foreign bot architecture.

Instead:

```text
Reference algorithms
        +
our measurement / verification discipline
        =
new architecture
```

This is how development becomes faster without becoming less reliable.

---

# 12. Research conclusions

The four systems converge on several truths:

1. Full autonomy requires the **room/colony**, not the individual creep, to own decisions.
2. Spawn demand should be generated by unmet work/capacity, not fixed population tables.
3. Logistics is best represented as requests/reservations rather than role-specific if/else chains.
4. Predictive replacement is mandatory for stable capacity.
5. Intel must be persistent and refreshed by information value.
6. Expansion should be a scored empire decision, not a flag.
7. CPU work must be scheduled by importance and staleness.
8. Base planning must combine transport efficiency, RCL feasibility and defense.
9. Multi-room play needs an empire request/responder layer.
10. Recovery must be a first-class state.
11. Safety gates must remain invariant even while higher strategy adapts.
12. Telemetry must measure expected vs actual outcomes so the bot can tune itself.

The new roadmap should therefore optimize development around **shared data contracts and vertical control-loop slices**, not around implementing isolated roles one after another.
