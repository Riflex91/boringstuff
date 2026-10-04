# Screeps Bot — Ultimate Autonomy Master Roadmap

Stand: 2026-10-04  
Repository: `Riflex91/boringstuff`  
Purpose: canonical VNext roadmap for a zero-touch, portable, measurable autonomous Screeps bot.

Detailed research companion:

`docs/ULTIMATE_AUTONOMOUS_BOT_KNOWLEDGE_BASE.md`

A new chat should read **this roadmap first**. It contains the architectural digest needed to continue development without rediscovering the reference systems.

---

# 0. Mission

Build a Screeps bot that can operate from bootstrap through mature empire without strategic manual input.

Target:

```text
install / provision
      ↓
discover runtime + server capabilities
      ↓
bootstrap / recover
      ↓
run colony
      ↓
scout world
      ↓
select remotes
      ↓
defend
      ↓
expand when justified and allowed
      ↓
coordinate empire
      ↓
run industry / market / power
      ↓
conduct justified combat
      ↓
measure outcomes and retune
```

The bot must not depend on:

- manual expansion flags;
- manual remote flags;
- manual spawn target selection;
- manual storage/layout placement;
- manual rally points;
- manual creep quotas;
- manually configured tick rate;
- manually configured room limit;
- a particular public/private server name.

**Zero-touch autonomy and server portability are hard requirements, not optional late-game features.**

---

# 1. Current development context

The existing live bot is valuable and must not be discarded.

Its strongest assets are:

- durable telemetry journal;
- offline collector catch-up;
- structured BOTLOG;
- STATUS_SNAPSHOT;
- Health model;
- Efficiency model;
- Productive Flow attribution;
- exact Node gate;
- deployment IDs;
- deployment receipts;
- exact deployment-marker verification;
- 25-tick smoke verification;
- 100-tick live verification;
- append-only release evidence;
- regression fixtures derived from real live failures.

At the time this roadmap was written:

- last fully accepted main release: `v0.2.19-node18`;
- active behavior work: `v0.2.20-node18 – Critical Consumer Early Dispatch`;
- active release branch: `feature/v0.2.20-critical-consumer-early-dispatch`;
- current behavior candidate during research: `f54164067a4f59f91df45563c027528ca2df8a26`;
- exact Node target: `18.20.4`;
- current live target room: `E8N1`.

This status is volatile. **Current GitHub and live evidence always override this snapshot.**

Do not mix unfinished VNext architecture changes into the active v0.2.20 release branch.

---

# 2. Mandatory repository workflow

Multiple chats may work in parallel.

Before every GitHub write:

1. compare current `main` against the working branch;
2. write only when `behind_by === 0`;
3. if stale, stop writing that branch and create a new branch from current `main`.

Before any merge:

- fresh head SHA;
- `behind_by=0`;
- all relevant checks completed;
- only success/skipped/neutral;
- no pending/failing checks;
- no unresolved review threads;
- no `CHANGES_REQUESTED`;
- draft=false;
- mergeable=true.

Historical verification evidence is append-only.

Behavior changes remain:

```text
small change
-> offline tests
-> deploy
-> smoke
-> live window
-> accept/reject from measured gates
```

VNext accelerates development mainly through **shadow models, replay tests and parallel architecture lanes**, not by weakening release gates.

---

# 3. Non-negotiable autonomy and portability contract

## 3.1 No manual strategic input

Normal operation may not require a human to decide:

- what to build;
- where to build;
- what to spawn;
- what to mine;
- which remote to use;
- which room to scout;
- which room to expand into;
- when to abandon a remote;
- when to defend;
- when to activate safe mode;
- where to send empire support;
- what labs/factory should produce;
- what to buy/sell;
- whether an offensive operation is feasible.

Manual console commands may exist for diagnostics/debugging, but strategy must never require them.

## 3.2 No fixed room limit

Do not encode a universal three-room limit.

Claim capacity is discovered from:

- `Game.gcl.level`;
- owned rooms;
- reserved expansion slots;
- claim return codes;
- optional server API metadata;
- learned server constraints.

A server-specific `ERR_FULL` or other limit becomes evidence in the capability model.

## 3.3 Tick-rate independence

All game strategy uses ticks/state/deadlines.

Do not assume:

- N seconds per tick;
- a real-world duration for 100 ticks;
- server speed;
- MMO timing.

Wall time is operational telemetry only.

## 3.4 Feature discovery

Managers activate only if their required capabilities exist.

Examples:

- Market only if market API exists.
- Inter-shard logic only if shard/inter-shard facilities exist.
- Power logic only if power systems/constants exist.
- Factory logic only when supported.
- Initial spawn API only through a server adapter that discovered it.

## 3.5 Reset autonomy

A reset/respawn must be recoverable without strategic human selection.

The architecture therefore includes an **Autonomy Supervisor** outside the in-game kernel for operations unavailable through normal in-game APIs, especially initial spawn placement on supported private-server APIs.

---

# 4. Knowledge digest from the four reference bots

This section is intentionally embedded in the roadmap so a new chat knows the architectural source material immediately.

## 4.1 TooAngel / sklemmer lineage

Reference:
`https://github.com/sklemmer/screeps-bot`

Core ideas:

- full automation as primary goal;
- room-first control;
- per-room spawn queue;
- scalable body templates;
- persistent routing/path cache;
- BFS scouting;
- automatic base layout;
- remote harvesting;
- automatic expansion search;
- automatic attacks;
- fallen-room recovery;
- TTL-aware replacement.

Key algorithmic lessons:

### Predict capacity loss before death

Do not wait for creep count to drop.

```text
replacementLead =
 queueDelay
 + energyDelay
 + spawnTime
 + travelToDuty
 + safetyMargin
```

### Two-level routing

```text
world room route
-> cached in-room path
```

### Body grammar

```text
prefix + repeat(layout) + suffix
```

Useful as a primitive for a generic body synthesizer.

What not to copy:

- prototype-heavy coupling;
- role-first strategy;
- fixed max-room config;
- legacy APIs;
- many static tick intervals.

License caution: AGPL-3.0.

---

## 4.2 Code Addicts Anonymous

Reference:
`https://gitlab.com/code-addicts-anonymous/screeps-bot`

Core ideas:

- low-CPU architecture;
- low creep counts;
- hybrid static + dynamic tasks;
- room-local priorities;
- priority history;
- spawn demand derived from persistent unmet tasks;
- dynamic roads/extensions/towers/links/walls;
- automated defense;
- expansion target evaluation.

Important priority examples:

- empty storage -> harvest priority rises;
- spawn/extension deficit -> transfer priority rises;
- controller downgrade risk -> upgrade becomes critical;
- empty towers -> refuel priority rises;
- walls below target -> repair priority rises;
- current threat -> defense spawning;
- visible expansion target -> settling/harassment/obliteration evaluation.

Most important lesson:

```text
current state
-> task priority
-> assignment
-> remaining unmet priority
-> smoothed demand history
-> spawn need
```

This avoids spawning from transient noise.

CPU lesson:

The bot staggers expensive tasks across ticks. We keep the principle but replace fixed prime modulo scheduling with a deadline/budget scheduler.

Critical limitation to eliminate:

- manual expansion targets;
- manual spawn/storage/rally placement;
- limited inter-room cooperation.

---

## 4.3 KasamiBot

References:

- `https://github.com/kasami/kasamibot`
- `https://kasami.github.io/kasamibot/`

Historical TypeScript source studied at:
`6830e7be851385249ad53cac5aaf259fad2b60e6`.

Core ideas:

- broad manager decomposition;
- explicit CPU priority classes;
- room spawn-order queues;
- room maturity levels;
- flexible core + adaptive extensions;
- staged logistics evolution;
- intel refresh;
- autonomous outposts;
- empire-wide expansion selection;
- inter-room support;
- autonomous labs/boosts;
- power-bank operations;
- trade/distribution;
- market;
- military operations.

CPU architecture:

```text
Critical
Standard
Low
Trivial
Overflow
```

Managers run only as CPU/bucket budget allows.

We generalize this to a process scheduler using:

- criticality;
- dirty state;
- deadline;
- max staleness;
- measured CPU cost.

Strategic maturity lesson:

Do not equate RCL with economic maturity.

Use derived states such as:

```text
BOOTSTRAP
STABILIZING
ESTABLISHED
INDUSTRIALIZING
MATURE
RECOVERING
SIEGE
```

Remote lesson:

Kasami evolves from general workers -> dedicated miners -> assigned haulers -> pooled hauling.

We use measured economics rather than fixed RCL thresholds.

Expansion lesson:

all colonies contribute candidates; the empire selects the best target.

License: CC-BY-3.0 in repository metadata.

---

## 4.4 The International

Reference:
`https://github.com/The-International-Screeps-Bot/The-International-Open-Source`

Core ideas:

- modern data-oriented architecture;
- deterministic processing pipeline;
- Room Services / Ops / Procs / Utils separation;
- room logistics requests;
- reserve accounting;
- capability-oriented spawn requests;
- dynamic hauler capacity;
- work/combat/haul request responders;
- remote manager;
- commune planner;
- stamps/base plans;
- min-cut defense;
- tower planning;
- player/threat memory;
- power creeps;
- labs/factory/market;
- RawMemory segments;
- stats/performance tooling.

Most important logistics pattern:

```text
producer / structure
-> logistics request
-> reservation
-> eligible hauler
-> fulfillment
```

Most important empire pattern:

```text
local room need
-> empire request
-> candidate responders
-> feasibility / distance / capacity
-> assigned responder
```

Spawn requests describe capacity/quota/body construction instead of directly spawning from business logic.

Planner decomposition strongly supports:

```text
anchor
-> stamps/core
-> extensions
-> roads
-> min-cut ramparts
-> tower coverage
-> RCL feasibility
-> score
```

Licensing caution:
root LICENSE is MIT while package metadata says GNU GPLv3. Reimplement concepts cleanly unless clarified.

---

# 5. Unified architecture

The new bot architecture is:

```text
Autonomy Supervisor
└── Platform / Server Adapter

In-game Kernel
├── Capability Registry
├── Process Scheduler
├── World Model
├── Colony State Model
├── Need / Request Graph
├── Strategic Utility Engine
├── Capacity Planner
├── Plan Generators
│   ├── Spawn
│   ├── Logistics
│   ├── Work
│   ├── Construction
│   ├── Path / Traffic
│   ├── Defense
│   ├── Remote
│   ├── Expansion
│   ├── Industry
│   ├── Market
│   └── Combat Operations
├── Assignment / Executors
└── Measurement / Calibration
```

---

# 6. Canonical data contracts

These contracts are the key to faster parallel development.

## 6.1 RuntimeCapabilities

```text
RuntimeCapabilities {
  cpu
  bucket
  market
  shard
  interShard
  power
  factory
  commodities
  observer
  nuker
  serverApi
  initialSpawnApi
  roomStatusSemantics
  claimCapacityEstimate
}
```

## 6.2 Need

```text
Need {
  id
  type
  colony
  target
  capability
  amount
  utility
  urgency
  deadline
  risk
  confidence
  preconditions
}
```

## 6.3 Capacity

```text
Capacity {
  entity
  capability
  amount
  location
  availableFrom
  availableUntil
  assignment
}
```

## 6.4 Request

Requests are routable Needs with reservation/response state.

```text
Request {
  needId
  scope
  responder
  reservation
  state
  predictedCost
  expectedValue
}
```

## 6.5 Plan

```text
Plan {
  inputsVersion
  intents
  expectedOutcome
  expiry
  safetyConstraints
}
```

## 6.6 Outcome

```text
Outcome {
  planId
  expected
  actual
  error
  reason
}
```

These shared contracts let different chats implement separate modules without inventing incompatible representations.

---

# 7. Core decision laws

## 7.1 Safety hierarchy

```text
Safety invariants > all strategy
Recovery > Growth
Defense > Expansion
Economy > Expansion
Sustainable throughput > nominal capacity
Measured outcome > theoretical assumption
```

## 7.2 No count-first economy

Never ask:

```text
"How many haulers?"
```

Ask:

```text
"How much transport capacity is required over this route and deadline?"
```

Then synthesize the fleet.

Same for:

- mining WORK;
- build WORK;
- repair WORK;
- upgrade WORK;
- attack;
- heal;
- claim.

## 7.3 Future-state planning

Current capacity is insufficient.

Always plan:

```text
capacity at activation time
capacity after expected TTL losses
capacity while spawn queue executes
```

## 7.4 Reservations everywhere

Reserve scarce resources during planning:

- energy;
- carried resources;
- target free capacity;
- spawn time;
- lab slots;
- boost mineral;
- terminal cooldown/budget;
- claim slot;
- defender assignment.

This prevents multiple agents from planning against the same capacity.

---

# 8. Development acceleration strategy

The old roadmap is mostly serial.

VNext is organized as **one foundation plus parallel lanes**.

## 8.1 Foundation first

Only a small shared foundation is blocking:

1. capability registry;
2. normalized ColonyState v2;
3. Need/Capacity/Request contracts;
4. process scheduler;
5. replay/shadow evaluation harness.

Once these contracts stabilize, multiple development chats can work independently.

## 8.2 Parallel lanes

### Lane A — Platform / Runtime

- capability discovery;
- server adapters;
- claim-capacity learning;
- reset detection;
- autonomous initial-spawn supervisor;
- CPU scheduler;
- migration/versioning.

### Lane B — Economy / Logistics / Spawn

- demand graph;
- flow accounting;
- request/reservation logistics;
- capacity-based spawn planner;
- predictive TTL replacement;
- generalized work assignment.

### Lane C — Planner / Pathing / Traffic

- anchor scoring;
- core stamps;
- dynamic peripheral packing;
- road graph;
- path cache;
- traffic heat map;
- min-cut defense;
- tower coverage.

### Lane D — Intel / Remote / Expansion

- World Model;
- intel aging/confidence;
- frontier scouting;
- remote ROI;
- automatic remote portfolio;
- expansion candidate generation;
- expansion scoring;
- autonomous claim.

### Lane E — Defense / Combat

- threat capabilities;
- civilian safety;
- tower targeting;
- defender capacity planning;
- safe mode model;
- combat requests;
- squad/operation planner.

### Lane F — Empire / Industry

- inter-colony request routing;
- resource balancing;
- terminals;
- minerals;
- labs/reactions;
- boosts;
- factory;
- power;
- market;
- specialization.

Shared contracts prevent these lanes from becoming separate incompatible bots.

---

# 9. Vertical release slices

Each slice must deliver an end-to-end control loop, not just a class/file.

## U0 — Capability Registry + Autonomy Contract

Goal:
remove hidden server assumptions.

Deliver:

- RuntimeCapabilities;
- detected feature flags;
- learned claim limit;
- server adapter interface;
- tick-rate-independent scheduling primitives;
- telemetry of detected capabilities.

No behavior change initially.

Gate:
same current live behavior on Newbieland with capabilities correctly reported.

## U1 — Colony State v2 + Need Graph

Goal:
represent current colony problems as data.

Deliver:

- normalized ColonyState;
- Need records;
- hard/soft needs;
- utility/urgency/deadline;
- shadow-only conversion of current behavior into needs.

Gate:
shadow needs explain existing spawn/logistics decisions with high agreement.

## U2 — Logistics v2

Goal:
replace fragmented delivery logic with requests/reservations.

Deliver:

- withdraw/pickup/transfer/offer requests;
- creep consumer requests;
- resource and capacity reservation;
- route-aware request scoring;
- one generic hauler assignment layer.

Initial migration:
energy only.

Later:
all resources.

Gate:
consumer waiting/fallback and transport utilization improve without hard-infrastructure starvation.

## U3 — Capacity Spawn Planner

Goal:
spawn capacity, not role counts.

Deliver:

- CapabilityDemand;
- body synthesizer;
- spawn-time reservation;
- future TTL capacity;
- replacement lead;
- queue-delay prediction;
- recovery priority.

Gate:
no predictable capacity trough across natural creep deaths.

## U4 — Generic Work Assignment

Goal:
workers execute highest-value compatible work.

Deliver:

- build/repair/upgrade jobs;
- capability matching;
- task switching penalty;
- deadlines;
- reservations;
- persistent assignment where useful.

Gate:
productive throughput improves while creep count stays equal or lower.

## U5 — Process Scheduler

Goal:
replace scattered modulo work with measurable scheduling.

Deliver:

- process registry;
- criticality;
- dirty state;
- deadlines;
- max staleness;
- measured CPU EWMA;
- bucket-aware optional work.

Gate:
critical loop remains safe under constrained CPU and optional planners scale automatically with available CPU.

## U6 — Planner vNext

Goal:
room layout optimized from state.

Deliver:

- candidate anchors;
- core stamp;
- adaptive extensions;
- transport graph;
- future RCL feasibility;
- min-cut ramparts;
- tower coverage;
- planner score;
- versioned migrations.

Gate:
planner can produce complete feasible RCL8 plans across a terrain fixture corpus.

## U7 — World Model + Autonomous Scouting

Goal:
persistent strategic world awareness.

Deliver:

- room/player records;
- intel confidence/age;
- frontier queue;
- information value;
- scout/observer scheduling;
- reachability.

Gate:
world intel refreshes without manual targets and stale information is explicitly represented.

## U8 — Remote Portfolio

Goal:
only profitable remotes run.

Deliver:

```text
NetRemoteValue =
 income
 - spawn
 - haul
 - reserve
 - infrastructure
 - repair
 - CPU
 - risk
```

Bot automatically:

- selects;
- activates;
- sizes;
- defends;
- pauses;
- abandons remotes.

Gate:
each active remote has positive measured net contribution.

## U9 — Defense vNext

Goal:
capability-based autonomous defense.

Deliver:

- threat model;
- boost-aware combat strength;
- tower model;
- civilian retreat;
- defender requirements;
- safe-mode decision;
- cross-room defense request.

Gate:
fixture/replay corpus plus live intrusion evidence shows correct escalation without wasting safe mode on harmless scouts.

## U10 — Autonomous Expansion

Goal:
remove all expansion manual input.

Candidate generation comes from World Model.

```text
ExpansionValue =
 room economy
 + remote portfolio
 + mineral diversity
 + empire fit
 + strategic reach
 + mutual defense
 - bootstrap
 - threat
 - route risk
 - CPU
```

Claim only when discovered claim capacity permits.

Gate:
room selected, claimed, bootstrapped and handed to normal colony control without flags or target configuration.

## U11 — Empire Request Router

Goal:
colonies cooperate automatically.

Requests:

- energy support;
- resources;
- boosts;
- hauling;
- builders;
- defense;
- expansion;
- combat.

Responder chosen by:

- feasibility;
- distance;
- cost;
- colony health;
- opportunity cost.

Gate:
support improves target colony without destabilizing responder.

## U12 — Industry Graph

Goal:
autonomous late-game production.

One dependency graph for:

- minerals;
- reactions;
- boosts;
- commodities;
- power;
- market procurement.

Desired stock is generated from forecast demand.

Gate:
production is justified by actual need/value, not static recipes.

## U13 — Strategic Combat Operations

Goal:
autonomous offense only when justified.

Pipeline:

```text
intel
-> target utility
-> feasibility simulation
-> required capability
-> operation plan
-> boost/logistics
-> stage
-> execute
-> measure
-> reinforce / retreat / abort
```

Gate:
bot refuses economically or tactically irrational attacks.

## U14 — Self Calibration

Goal:
use telemetry to tune models.

Allowed auto-tuning:

- replacement safety margin;
- travel-time correction;
- remote risk;
- logistics safety capacity;
- scheduling cost estimates;
- build/upgrade allocation;
- market thresholds.

Not allowed:
opaque learning overriding safety invariants.

---

# 10. Milestones

## v0.3 — Autonomy Kernel

Must contain:

- U0 capability registry;
- U1 Need Graph shadow model;
- U5 scheduler foundation;
- replay/shadow harness.

Still compatible with existing executors.

## v0.4 — Flow Colony

Must contain:

- U2 Logistics v2;
- U3 Capacity Spawn Planner;
- U4 generic work assignment.

Outcome:
single colony economy no longer depends on fixed role quotas.

## v0.5 — Self-Planned Colony

Must contain:

- U6 planner;
- traffic/path cache integration.

Outcome:
new colony can plan/build itself through RCL progression.

## v0.6 — Autonomous Territory

Must contain:

- U7 World Model;
- U8 Remote Portfolio;
- U9 Defense vNext.

Outcome:
bot autonomously understands and exploits its surrounding territory safely.

## v0.7 — Autonomous Expansion

Must contain:

- U10 expansion;
- reset/bootstrap supervisor mature enough for supported servers.

Outcome:
no manual expansion target or initial-room strategic choice.

## v0.8 — Autonomous Empire

Must contain:

- U11 Empire Router.

Outcome:
multiple colonies operate as one resource/capacity system.

## v0.9 — Autonomous Industry

Must contain:

- U12 Industry Graph.

## v1.0 — Ultimate Autonomous Bot

Must contain:

- U13 strategic combat;
- U14 calibration;
- complete zero-touch recovery;
- portable capability adapters;
- full live benchmark suite.

---

# 11. Faster testing strategy

## 11.1 Telemetry replay

Every live failure should become a replay fixture.

Goal:

```text
recorded ColonyState sequence
-> candidate planner
-> compare proposed decisions
-> evaluate invariants
```

This allows dozens of policy iterations without waiting for dozens of live 100-tick windows.

## 11.2 Shadow mode

New planners first emit:

```text
SHADOW_PLAN
```

without controlling creeps.

Compare:

- existing action;
- proposed action;
- predicted outcome;
- later actual outcome.

Only after evidence is good does the planner receive intent authority.

## 11.3 Feature authority migration

Avoid big-bang rewrite.

For each subsystem:

```text
observe
-> shadow
-> advisory
-> partial authority
-> full authority
-> delete legacy path
```

## 11.4 Fixture corpus

Maintain fixtures for:

- bootstrap;
- zero-creep recovery;
- miner death;
- hauler lifecycle trough;
- consumer starvation;
- spawn congestion;
- controller downgrade;
- room under attack;
- source container missing;
- remote invasion;
- path blockage;
- storage overflow;
- CPU/bucket pressure;
- claim-limit failure;
- missing market/API capabilities.

---

# 12. Development rules for parallel chats

Each implementation chat must state:

- lane;
- slice;
- exact data contract touched;
- whether behavior changes;
- required evidence.

Do not create private one-off models when a canonical contract exists.

Preferred work units:

```text
one contract
+ one algorithm
+ regression
+ telemetry
+ shadow evidence
```

not:

```text
"implement all of remote mining"
```

This allows parallel progress without merge chaos.

---

# 13. Architecture rules derived from prior failures

The current v0.2.x work has already taught several permanent lessons.

## 13.1 Counts are insufficient

"3 haulers" did not prove sufficient logistics.

Track:

- CARRY capacity;
- TTL;
- cargo;
- route;
- readiness;
- reservation;
- delivery deadline.

## 13.2 Aggregate capacity is insufficient

Even sufficient total CARRY can fail if usable energy is in the wrong phase of the pickup/delivery cycle.

Track temporal/positional availability.

## 13.3 Current snapshot is insufficient

A good end snapshot can hide a bad 100-tick history.

Use windowed attribution.

## 13.4 Generic PASS is insufficient

A verifier may call a run WATCH/PASS while a project-specific acceptance threshold still fails.

Release gates belong to the roadmap/release contract.

## 13.5 Same-version deploys need identity

Version string alone is not deployment identity.

Keep unique deployment receipt/marker semantics permanently.

## 13.6 Explain before optimizing

When a signal is ambiguous:

1. add observability;
2. reproduce;
3. isolate;
4. change behavior.

Do not tune population from one WATCH.

---

# 14. Strategic formulas

## 14.1 Remote ROI

```text
RemoteValue =
  expectedRealizedEnergy
  - minerAmortization
  - haulerAmortization
  - reservationCost
  - roadContainerAmortization
  - repairCost
  - cpuCost
  - expectedHostileLoss
```

## 14.2 Expansion

```text
ExpansionValue =
  RoomValue
  + RemotePortfolioValue
  + EmpireFit
  + StrategicValue
  - BootstrapCost
  - ThreatRisk
  - CPUCost
```

## 14.3 Logistics assignment

```text
AssignmentValue =
  RequestUtility
  - PickupTravel
  - DeliveryTravel
  - DeadlinePenalty
  - TaskSwitchPenalty
  - OpportunityCost
```

## 14.4 Productive allocation

```text
AvailableProductiveBudget =
  sustainableIncome
  + intentionalBufferDraw
  - survivalReserve
  - expectedReplacementCost
  - defenseReserve
```

Builder/upgrader/repair allocations compete for this budget.

## 14.5 Combat

```text
OperationValue =
  StrategicBenefit
  - SpawnCost
  - BoostCost
  - EconomicDowntime
  - TravelCost
  - ExpectedLoss
  - DefensiveExposure
```

---

# 15. Definition of "ultimate autonomous"

The project is not complete because it has every feature.

It is complete when the following statement is true:

> Given a supported Screeps environment and sufficient API access for initial bootstrap, the system can discover its operating constraints, choose or recover a starting position, build and sustain colonies, learn the surrounding world, defend itself, exploit profitable territory, expand only when permitted and justified, coordinate all owned colonies, operate late-game industry and market systems, conduct strategically justified combat, recover from losses and resets, and continuously validate its own decisions — without requiring manual strategic commands or server-specific hard-coded rules.

That is the acceptance target for v1.0.
