# Screeps Bot – Ultimate Autonomous Roadmap

Stand: 2026-10-04  
Roadmap generation: VNext / Ultimate Autonomy  
Repository: `Riflex91/boringstuff`

> **New-chat boot instruction:** Read this file first. It is intentionally self-contained. For the deeper research behind the architecture, then read `docs/ULTIMATE_AUTONOMY_KNOWLEDGE_BASE.md`. Do not assume an old release snapshot in this document is current; PR/live evidence is authoritative for active releases.

---

# 0. Mission

Build a **zero-touch, autonomous, adaptive, high-performance Screeps bot** that can start from a fresh account/spawn, survive, grow, plan bases, exploit remotes, defend itself, expand, coordinate an empire, operate late-game industry, trade, use power systems when available, and conduct strategic combat without requiring manual gameplay commands.

The bot must run across compatible Screeps servers without depending on:

- a fixed tick rate;
- a fixed room ownership limit;
- a particular shard layout;
- Newbieland-specific constants;
- manual expansion flags;
- manually chosen remote rooms;
- manually placed later spawns/storage/rally points;
- manually selected market/industry/combat targets.

Debug/operator overrides may exist, but normal autonomous operation must not need them.

---

# 1. Mandatory engineering rules

## 1.1 GitHub integrity

Multiple chats may work in parallel.

Before **every GitHub write**:

1. freshly compare `main` against the working branch;
2. only write when `behind_by === 0`;
3. if stale, stop writes on that branch;
4. create a new branch from current `main` and port only intended changes.

Before merge, freshly verify:

- exact current head SHA;
- `behind_by=0`;
- all relevant checks completed;
- only success/skipped/neutral;
- no pending/failing checks;
- no unresolved review threads;
- no `CHANGES_REQUESTED`;
- draft=false;
- mergeable=true.

Merge method: `merge` with exact current `expected_head_sha`.

Verification evidence is append-only.

## 1.2 Live release discipline

Normal behavior release:

```text
small testable change
→ exact offline regression
→ deploy
→ 25-tick smoke
→ 100-tick live window
→ acceptance gate
→ next behavior change
```

Never relax a release threshold merely to ship a change.

## 1.3 Architecture safety hierarchy

```text
Recovery > Growth
Defense > Expansion
Core Economy > Optional Industry
Safety Invariants > Strategic Utility
Measured Evidence > Intuition
```

## 1.4 Clean-room external research rule

The four external bots are architectural references.

Do not blindly copy foreign source.

License observations at research time:

- sklemmer / TooAngel lineage: AGPL-3.0;
- Code Addicts Anonymous GitLab: no root LICENSE observed;
- KasamiBot: CC-BY-3.0;
- The International: root LICENSE says MIT while package metadata says GNU GPLv3.

Default: understand concepts, then independently implement them.

---

# 2. Embedded reference-bot knowledge

This section exists so a new chat can understand the important research without first repeating the external study.

## 2.1 sklemmer / TooAngel lineage

Core lessons:

- historically built around full automation;
- automatic base construction;
- scouting and room acquisition;
- remote harvesting;
- recovery of fallen rooms;
- power/mineral/market/combat automation;
- room-owned spawn queue;
- dynamic body templates;
- cached room/in-room routing;
- path-driven road/base planning;
- proactive creep replacement before TTL expiry;
- durable player/friend/enemy state.

Most important algorithms/concepts to retain:

```text
room queue
+ priority
+ queue TTL
+ dynamic body scaling
+ pre-death replacement
+ cached route graph
+ automatic recovery
```

Do not retain:

- prototype-heavy global coupling;
- hard configured room maximum;
- role count as primary economy model;
- old tactical heuristics.

## 2.2 Code Addicts Anonymous

Strongest contribution: hybrid **dynamic task priority**.

Observed model:

1. room state computes priority for each task;
2. compatible creeps are considered;
3. creep receives highest-priority task;
4. assigned task priority is reduced;
5. next creep sees reduced marginal need;
6. task switching uses continuation bias;
7. blocked tasks are temporarily suppressed;
8. persistent unmet priorities feed spawn priorities.

This is a practical marginal-utility allocator.

Canonical adaptation:

```text
requestPriority
- travelCost
- switchCost
- risk
+ deadlineUrgency
= assignment score

after assignment:
remaining request utility decreases
```

Other useful ideas:

- incremental topology-driven construction;
- bounded expensive lookups per tick;
- persistent road/placement plans;
- ban failed anchors and retry alternatives;
- CPU pressure can suppress optional spawning/work.

Reject:

- manual expansion flag;
- manual storage/spawn/rally flags;
- no empire-level resource cooperation.

## 2.3 KasamiBot

Strongest contributions:

- many domain managers;
- room lifecycle / maturity states;
- prioritized spawn-order queue;
- manager scheduler with priority classes:
  - Critical
  - Standard
  - Low
  - Trivial
  - Overflow
- bucket-aware CPU budget;
- early generalist → dedicated miner → source-specific haul → pooled haul progression;
- freshness-aware intel;
- room scoring for expansion;
- parent-supported expansion bootstrap;
- explicit multi-creep Operations;
- regional defense support;
- internal resource distribution before/alongside market;
- robust Traveler pathing with route filtering, hostile/SK avoidance, stuck detection and caches.

Canonical adaptation:

- keep CPU scheduler and lifecycle thinking;
- express lifecycle as capability predicates, not only RCL;
- use Operation state machines for long-running objectives;
- let empire select expansion automatically.

## 2.4 The International

Strongest technical reference.

Architectural ideas:

- data-oriented split between Data, Utils, Procs, Ops, Services;
- large empire-level main loop;
- explicit logistics requests;
- spawn requests based on **parts quota / capacity quota**;
- persistent remote models;
- hauler-need calculations;
- custom pathfinder with shared cost weighting;
- stamp-based base planning;
- Min-Cut defense planning;
- planner data persisted in segments;
- broad late-game modules;
- detailed stats including energy flows, CPU, memory, tick-length measurement.

Canonical adaptation:

```text
Need says required capacity
→ spawn constructor produces bodies to satisfy missing parts
→ executor does not decide strategy
```

Use request-driven logistics and capacity planning.

Do not place experimental neural networks in a safety-critical loop until deterministic objective functions have been exhausted.

## 2.5 Combined lesson

The new bot is **not role-first**.

Target loop:

```text
Capabilities
→ World State
→ Colony State
→ Problems / Opportunities
→ Requests / Needs
→ Capacity Deficits
→ Resource Budgets
→ Plans
→ Assignments
→ Intents
→ Outcomes
→ Telemetry
→ Replanning
```

## 2.6 Deep-source refinements that are now architectural requirements

The second source-level pass adds these concrete rules:

- **Expansion is budgeted, not merely permitted by GCL.** Free claim capacity is insufficient if CPU headroom, parent maturity, recovery reserve, spawn opportunity cost or support budget cannot safely sustain another colony.
- **Expansion uses `RoomQuality` plus `EmpireFit`.** Resource diversity, support geometry, hostile neighborhood, frontier value, CPU burden and empire topology change a candidate's marginal value.
- **Expansion and remotes remember failure.** Failed operations store failure class/evidence and enter bounded backoff; transient failures may later be reconsidered automatically.
- **Remotes are dynamic portfolio assets.** They move through candidate/active/threatened/suspended/retired states and are automatically dropped when expected net value turns negative.
- **Regional defense is deadline dispatch.** Donor colonies are scored by reinforcement ETA, spawn opportunity cost, available combat/boost capacity and the target room's latest useful arrival tick.
- **Threat strength is body/boost/path aware.** Safe Mode is based on predicted protected-asset loss, not simple hostile presence.
- **Planner is staged and resumable.** Core/logistics geometry, harvest positions, hub/labs/extensions, routes, Min-Cut, towers and late-game structures are separate inspectable phases with failure reasons and CPU cost.
- **Planner anchors come from economic geometry.** Sources, controller, important path midpoints, open-space geometry and exit/defense geometry seed candidates; do not brute-force all tiles at full cost.
- **Defense Min-Cut follows economic topology.** First decide which efficient assets/routes must be protected, then optimize the perimeter.
- **Structure progression is capability-based.** Plans store an `earliestCapability`, not a server-specific assumption that RCL alone fully determines availability.
- **Transport demand, capacity deficit, body optimization and spawn scheduling are separate layers.** A route model outputs required CARRY-over-time; it does not directly decide a fixed hauler count.
- **Structures publish logistics demand.** Haulers consume reserved requests; target-selection policy must not live inside permanent hauler roles.
- **Expensive strategy/planner work obeys the CPU OS.** It is resumable BACKGROUND/OVERFLOW work unless a deadline makes it urgent; survival is never skipped because optimization used the budget.

These rules are mandatory when implementing U3-U11. The detailed algorithms and derived fixtures are in `docs/ULTIMATE_AUTONOMY_KNOWLEDGE_BASE.md`.

## 2.7 Recovery / memory / industry rules that are now architectural requirements

- **Recovery is a first-class colony mode.** A broken colony suppresses optional work, reserves spawn energy, restores minimum mining/logistics/controller capacity and can request external aid. Recovery exit requires hysteresis-confirmed stability.
- **Cross-colony aid is generic.** Emergency workers, energy convoy, defense reinforcement, bootstrap support and boost/material aid all use the same `SupportRequest` contract with deadline, provider cost and ETA.
- **Persistent state is lifecycle-managed.** Every durable schema has a version, migration path, freshness/permanence classification and garbage-collection rule. New code must not require manually clearing Memory.
- **Segments are optional.** Large plans/routes/history may use RawMemory segments when available, but survival must fall back to compact Memory or recomputation.
- **Market decisions use effective value.** Nominal credits are corrected for terminal transaction energy, internal energy shadow price, reserves and opportunity cost. Internal empire transfers compete against market trades.
- **Resource reserves are forecast-driven.** Strategic stock is computed from survival reserve, forecast demand, committed operations, production pipeline and desired buffer instead of fixed magic thresholds.
- **Labs are demand-driven.** Boost/compound need creates a reaction dependency DAG, reagent requests, logistics, lab assignment and eventual boost appointment.
- **Boosts belong to operations.** Compound stock is reserved at operation commitment; body optimization compares boosted vs unboosted plans including lab/logistics/scarcity cost.
- **Factory production is value-based.** Product output value is compared against ingredient shadow value, energy, transfer, cooldown and logistics cost.
- **Power is subordinate to economy health.** Power processing or harvesting may not consume the core survival/growth reserve.
- **Power-bank harvesting is an Operation.** Discovery, valuation, target reservation, damage/heal assembly, attack, JIT hauler dispatch, collection and ROI settlement are explicit phases.
- **Empire requests use cheap-filter then expensive-validation.** Reject impossible responders by status/distance/capability before doing costly pathfinding.
- **Remote transport tracks credit/debt.** Produced-but-unmoved, reserved pickup, expected production, transported and decayed/lost resource are separately represented.
- **Respawn and schema migration are normal lifecycle events.** Empty-memory boot, soft migration, hard migration fallback and ownership/operation invalidation are tested.

These rules apply especially to K0/K1, E3/E4, I2/I4 and M0-M4.

---

# 3. Universal runtime model

## 3.1 Runtime Capability Discovery

First VNext foundation.

Create normalized capability state:

```text
RuntimeCapabilities
├── environment fingerprint
├── shard support
├── CPU limit / bucket state
├── observed bucket max
├── RawMemory segments availability
├── market availability
├── inter-shard memory availability
├── power creep availability
├── structure capability table
├── GCL / ownership capacity
├── discovered claim restrictions
├── construction policies
└── measured wall-clock tick statistics (observability only)
```

Rules:

- never require server name to choose normal strategy;
- missing optional APIs disable only dependent features;
- feature probing must be safe and cached;
- server behavior learned from errors is persisted with confidence/freshness.

## 3.2 Claim-policy discovery

No permanent `MAX_OWNED_ROOMS` in VNext strategy.

Use:

1. `Game.gcl`;
2. owned room count;
3. active claim commitments;
4. server/account metadata if available;
5. results of actual claim intents;
6. normalized claim errors.

On `ERR_GCL_NOT_ENOUGH`, `ERR_FULL`, or adapter-normalized equivalent:

- cancel unsafe duplicate claim requests;
- persist the failure with target/context evidence;
- backoff;
- reevaluate expansion budget.

Do **not** infer a permanent global room cap from one claim error. Standard `ERR_GCL_NOT_ENOUGH` is dynamic GCL capacity; `ERR_FULL` may be area/server-context specific. Promote `discoveredClaimLimit` only from explicit server metadata/adapters or sufficiently strong multi-context evidence that establishes a global constraint.

## 3.3 Tick-rate independence

Gameplay calculations use:

- Game.time;
- TTL;
- spawn duration in ticks;
- route travel ticks;
- throughput/tick;
- progress/tick;
- event age in ticks.

Never assume “one tick = N seconds”.

Timestamp-based tick length is telemetry only.

---

# 4. Canonical data architecture

## 4.1 World Model

```text
WorldModel
├── ServerProfile
├── EmpireState
├── PlayerIntel
├── RoomIntel
├── RouteIntel
├── MarketIntel
└── CapabilityRegistry
```

Every intel record includes:

- lastSeenTick;
- confidence;
- expiry/freshness;
- source of evidence.

## 4.2 Colony State

Facts only:

- sources and production;
- available/stored resources;
- active and projected creep capacity;
- spawn state;
- routes;
- buffers;
- construction;
- controller;
- infrastructure;
- logistics queue;
- threats;
- local CPU cost.

No strategic “should” fields in raw state.

## 4.3 Request schema

All higher-level needs normalize toward:

```text
Request
- id
- domain
- target
- capability/resource
- requested amount
- satisfied amount
- priority
- deadlineTick
- utilityCurve
- maxUsefulCapacity
- location
- risk
- dependencies
- reservations
- blockedUntil
- failureReason
- createdTick
- lastProgressTick
```

Domains:

- economy;
- logistics;
- construction;
- controller;
- repair;
- defense;
- scouting;
- remote;
- expansion;
- industry;
- market;
- combat;
- recovery.

## 4.4 Capacity model

Primary quantities:

- WORK capacity;
- CARRY capacity;
- MOVE/travel capability;
- CLAIM capacity;
- ATTACK/RANGED/HEAL/TOUGH strength;
- structure throughput;
- spawn-time capacity;
- CPU budget.

Role names are implementation labels only.

---

# 5. Accelerated development strategy

The old roadmap was mostly sequential. VNext uses a **dependency graph plus vertical slices** so independent chats can make progress in parallel.

## 5.1 Core tracks

```text
K – Kernel / Capability / Contracts
E – Economy / Needs / Spawn / Logistics
P – Planner / Pathing / Construction
I – Intel / Remote / Expansion
D – Defense / Combat
M – Empire / Industry / Market
O – Observability / Verification / Adaptation
```

A slice should normally:

- touch one track;
- expose a stable interface;
- include fixtures/tests;
- include telemetry if behavior changes;
- avoid rewriting another active track.

## 5.2 Dependency graph

```text
K0 Capability Discovery
 ├─→ K1 Process Scheduler
 ├─→ O1 Universal State Snapshot
 └─→ I0 World Model

O1 + current economy telemetry
 └─→ E0 Unified Request Schema

E0
 ├─→ E1 Marginal Assignment Engine
 ├─→ E2 Capacity-Based Spawn Planner
 └─→ E3 Logistics Request Graph

I0
 ├─→ I1 Autonomous Scout Frontier
 ├─→ I2 Remote Scoring
 └─→ I3 Expansion Scoring

P0 Shared Cost Fields
 ├─→ P1 Route Cache
 └─→ P2 Base Planner vNext
      └─→ P3 Min-Cut Defense Plan

E3 + P1
 └─→ E4 Flow-Based Hauling

D0 Threat Model + P3
 └─→ D1 Defense Requests
      └─→ D2 Regional Reinforcement

I3 + E2 + D1
 └─→ I4 Autonomous Expansion Operation

M0 Empire Resource Ledger
 ├─→ M1 Terminal Allocation
 ├─→ M2 Labs/Boosts
 ├─→ M3 Factory/Commodities
 └─→ M4 Power

D2 + M2 + Operations
 └─→ D3 Strategic Offensive Operations

all measured systems
 └─→ O2 Shadow Policy Evaluation
      └─→ O3 Bounded Self-Tuning
```

---

# 6. Milestone U0 – Finish current release line safely

The running `v0.2.20` work is separate from this research branch.

Do not invalidate its live evidence by mixing VNext code into the release branch.

Completion:

- active consumer/logistics release either passes unchanged acceptance gates or is rejected with evidence;
- PR is merged only under normal strict gates;
- current production baseline is recorded.

After that, the research branch can be refreshed from the resulting `main`.

---

# 7. Milestone U1 – Universal Kernel

Goal: remove server assumptions before adding more strategic complexity.

## Slice K0 – Capability Discovery

Deliver:

- `runtime.capabilities`;
- `server.profile`;
- feature registry;
- safe capability probes;
- persisted observed claim policy;
- feature dependency helper.

Tests:

- official-like environment fixture;
- no-market fixture;
- no-segments fixture;
- no-power fixture;
- altered CPU/bucket fixture;
- claim error updates policy;
- restart persistence.

No gameplay behavior change yet.

## Slice K1 – CPU Process Scheduler

Replace scattered cadence checks over time with process descriptors.

Process fields:

```text
priority
deadlineTick
estimatedCpu
minimumInterval
freshness
canSleep
canDegrade
```

Classes:

- CRITICAL;
- DEADLINE;
- STANDARD;
- BACKGROUND;
- OVERFLOW.

Tests:

- survival process always runs;
- background yields under low bucket;
- overdue deadline executes;
- expensive planner spreads work;
- no starvation.

## Slice O1 – Universal State Snapshot

Create one normalized snapshot consumed by planners.

It includes:

- capability state;
- colony state;
- projected creep capacity;
- route state;
- requests;
- threat;
- CPU.

Acceptance:

The state required for a decision can be reconstructed without querying ad-hoc globals throughout multiple modules.

---

# 8. Milestone U2 – Need/Request Kernel

Goal: replace role-count heuristics with reusable demand contracts.

## Slice E0 – Unified Request Registry

Implement request lifecycle:

```text
OPEN
RESERVED
IN_PROGRESS
BLOCKED
SATISFIED
EXPIRED
CANCELLED
```

Required:

- dedupe keys;
- priorities;
- deadline;
- capacity amount;
- reservation;
- dependencies;
- blocked retry;
- progress measurement.

Initially mirror current behavior in shadow mode.

## Slice E1 – Marginal Assignment Engine

Implement independent version of the Code Addicts marginal-priority concept.

Score:

```text
marginal utility
+ deadline urgency
+ locality
- travel cost
- switching cost
- risk
```

After assignment, remaining need is reduced.

Must include:

- continuation bias;
- reservation;
- anti-dogpile;
- failure backoff;
- emergency preemption.

First targets:

- builder/worker/upgrader shared execution;
- simple repair;
- local energy tasks.

## Slice O2 – Assignment Evidence

Record in bounded 100-tick windows:

- request episodes opened/closed;
- average/max request latency from `createdTick` to terminal `updatedTick`;
- active and blocked request-ticks plus blocked reasons;
- assignments/tick and switches/tick;
- low-CPU deferred ratio;
- unfilled request count and remaining need;
- compatible-but-unassigned executors while assignable work remains open;
- controller + construction progress as observed useful-work throughput.

Persist each completed window as `ASSIGNMENT_EVIDENCE_WINDOW` in the durable telemetry journal.

Important semantics:

- reopened demand is a new request episode;
- capacity-deficit requests are excluded from executor evidence and remain E2 inputs;
- low-CPU deferral is explicit evidence, not zero demand;
- current `usefulWorkPerTick` follows existing productive-flow throughput semantics and does not infer repair output without direct action telemetry.

Gate: request engine must prove equal-or-better output than legacy policy before becoming authoritative. O2 itself is evidence-only and may not alter request priority, reservations, assignments, or creep behavior.

---

# 9. Milestone U3 – Predictive Capacity and Spawn OS

## Slice E2 – Capacity-Based Spawn Planner

Required capacity replaces raw population targets.

Examples:

```text
source requires 10 WORK
route requires 12 CARRY
defense requires X effective ranged DPS
controller needs minimum 2 WORK
```

Planner computes:

```text
required
- active
- queued
- spawning
- projected surviving
= deficit
```

## Slice E2A – Generalized Pre-spawn

Generalize current TTL-aware hauling logic.

```text
replacementLead =
expectedQueueDelay
+ spawnDuration
+ routeToDuty
+ safetyMargin
```

A creep with TTL below productive-start horizon does not count as future capacity.

Tests:

- synchronized deaths;
- spawn congestion;
- long remote routes;
- emergency miner precedence;
- no duplicate replacements.

## Slice E2B – Body Optimizer

Inputs:

- requested parts/capacity;
- room energy capacity;
- current available energy;
- route terrain;
- expected work lifetime;
- spawn time cost;
- boosts;
- max 50 parts.

Outputs:

- body;
- delivered capacity;
- cost;
- spawn ticks;
- expected ROI.

Avoid fixed body tables except emergency fallbacks.

---

# 10. Milestone U4 – Logistics Flow Engine

This milestone directly evolves lessons learned from v0.2.14–v0.2.20.

## Slice E3 – Logistics Requests

Producers/buffers/consumers publish requests:

```text
PICKUP
DELIVER
BALANCE
RESERVE
EMERGENCY_DELIVER
```

Request fields include:

- resource;
- amount;
- priority;
- source;
- target;
- deadline;
- min useful delivery;
- reservation.

## Slice E4 – Hauler Matching

Score candidate transport jobs by:

```text
priority
+ deadline
+ carried-resource bonus
+ route reuse
- travel cost
- detour
- conflict
```

Guarantees:

- no duplicate reservations;
- partial carried resource can satisfy urgent request;
- infrastructure reserve policy is explicit, not an accidental global guard;
- multiple haulers can serve multiple independent critical consumers;
- capacity is modeled over time.

## Slice E5 – Logistics Topology Transition

Automatically choose:

```text
self-haul
→ source lane
→ pooled haul
→ links/hub
→ terminal
```

Decision from measured cost and available infrastructure.

No hard RCL-only switch.

Acceptance metrics:

- consumer waiting;
- fallback;
- resource latency;
- hauler utilization;
- route energy/tick;
- transport CPU.

---

# 11. Milestone U5 – Shared Pathing and Planner

## Slice P0 – Shared Cost Field

One reusable cost service for:

- logistics;
- construction;
- scouts;
- combat;
- remotes.

Weights may include:

- terrain;
- roads;
- planned roads;
- stationary work tiles;
- congestion;
- hostile range;
- keeper range;
- walls/ramparts;
- planned structures.

## Slice P1 – Hierarchical Route Cache

Two levels:

1. world/room graph;
2. in-room path.

Features:

- cache key includes movement profile;
- versioned invalidation;
- stuck feedback;
- hostile route invalidation;
- route confidence;
- serialized compact path where beneficial.

## Slice P2 – Planner VNext

Inputs:

- terrain;
- exits;
- controller;
- sources;
- mineral;
- route graph;
- future structure limits.

Search:

- candidate anchors;
- stamp/core variants;
- source/controller/hub path cost;
- extension feasibility;
- tower coverage;
- traffic;
- upgrade logistics;
- future structures.

Score multiple objectives rather than use one fixed blueprint.

## Slice P3 – Min-Cut Defense Perimeter

Use cut-based defensive planning around protected assets.

Evaluate:

- rampart count;
- repair burden;
- tower coverage;
- breach routes;
- exit exposure;
- traffic crossings.

Planner output is versioned and migratable.

---

# 12. Milestone U6 – Intelligence and autonomous frontier

## Slice I0 – World Intel Store

Per-room:

- ownership;
- reservation;
- sources;
- mineral;
- exits;
- structures;
- threats;
- route cost;
- last seen;
- confidence;
- candidate scores.

Per-player:

- rooms;
- observed strength;
- hostility/reputation;
- recent aggression;
- expansion behavior.

## Slice I1 – Autonomous Scout Frontier

Automatically create scout requests from value of information.

Priority increases when:

- neighboring unknown room blocks remote evaluation;
- expansion candidate is stale;
- threat uncertainty affects safety;
- observer cannot cover it;
- important route is stale.

No flags.

## Slice I2 – Remote ROI

For each candidate source/room:

```text
net value =
expected harvested energy
- miner amortized spawn cost
- hauling amortized spawn cost
- reservation cost
- infrastructure cost
- repair cost
- travel loss
- expected hostile loss
- CPU opportunity cost
```

Activate only positive expected-value remotes under capacity budget.

Automatically deactivate poor remotes.

---

# 13. Milestone U7 – Threat and defense

## Slice D0 – Threat Strength Model

Normalize hostile capabilities:

- effective ATTACK;
- RANGED;
- HEAL;
- DISMANTLE;
- TOUGH mitigation;
- MOVE mobility;
- boosts;
- tower interaction;
- path to assets.

Threat state:

```text
NORMAL
WATCH
ALERT
DEFENSE
EMERGENCY
```

## Slice D1 – Defense Requests

Threat creates capacity requests:

```text
required damage
required heal
required tanking
required repair
tower energy reserve
rampart occupancy
```

Spawn planner satisfies deficits.

Safe Mode is based on predicted core-loss risk, not presence of a scout.

## Slice D2 – Regional reinforcement

Colonies publish:

- defense surplus;
- reinforcement ETA;
- spawn availability;
- energy/boost budget.

Empire chooses cheapest timely support.

---

# 14. Milestone U8 – Fully autonomous expansion

No user-selected target.

## Slice I3 – Expansion candidate scoring

Two scores:

```text
RoomQuality
EmpireFit
```

RoomQuality:

- sources;
- mineral;
- planner quality;
- defense perimeter;
- remotes;
- travel geometry;
- hazards.

EmpireFit:

- distance/support;
- mineral diversity;
- frontier value;
- regional defense;
- terminal topology;
- CPU load;
- existing expansion commitments.

## Slice I4 – Expansion Operation

State machine:

```text
DISCOVER
→ VERIFY
→ PREPARE
→ CLEAR_IF_REQUIRED
→ CLAIM
→ BOOTSTRAP
→ ESTABLISH_SPAWN
→ RECOVERABLE
→ STABLE
→ HANDOFF
```

The operation automatically selects:

- parent colony;
- claimer;
- pioneers/build capacity;
- support resources;
- spawn location from planner;
- abort/retry conditions.

Claim policy comes from Capability Discovery.

No fixed three-room architecture. If a server allows one room, it stops at one. If it allows many and CPU/economy supports more, strategic scoring decides.

---

# 15. Milestone U9 – Empire coordination

## Slice M0 – Empire ledger

Each colony publishes:

- energy reserve;
- mineral inventory;
- boost inventory;
- power;
- production capabilities;
- strategic needs;
- support capacity.

## Slice M1 – Resource allocator

Prioritize internal transfer vs market.

Cost includes:

- terminal transaction energy;
- opportunity cost;
- urgency;
- market price;
- strategic reserve.

## Slice M2 – Colony specialization

Specialization is dynamic:

- economy hub;
- industry;
- frontier;
- military;
- upgrade focus.

Never permanent if state changes.

---

# 16. Milestone U10 – Industry / market / power

Capability-driven. Missing server features simply skip the module.

## Labs

- forecast boost demand;
- reaction graph;
- reagent availability;
- terminal balancing;
- lab assignment;
- boost appointments.

## Factory

- commodity value;
- component availability;
- cooldown;
- terminal cost;
- production opportunity cost.

## Market

Use effective price:

```text
effectiveBuyCost =
credits
+ transactionEnergy × energyShadowPrice
```

```text
effectiveSellValue =
credits
- transactionEnergy × energyShadowPrice
```

Maintain dynamic strategic reserves, not fixed arbitrary stock constants.

## Power

Evaluate:

- power-bank operation ROI;
- spawn capacity;
- travel;
- combat cost;
- hauler arrival timing;
- processing energy cost.

Power creeps are capability-gated.

---

# 17. Milestone U11 – Strategic combat

Offense is an Operation with an explicit expected-value model.

## Combat model

Calculate:

- outgoing damage by range;
- incoming damage;
- healing;
- TOUGH reduction;
- tower falloff;
- boost multipliers;
- movement/fatigue;
- breach time;
- defender reinforcement estimate.

## Operation types

- remote denial;
- defense relief;
- harassment;
- dismantle/breach;
- siege;
- claim-clear;
- strategic counterattack.

Decision:

```text
ExpectedStrategicBenefit
>
spawn cost
+ boost cost
+ lost economy
+ travel
+ risk
+ opportunity cost
```

Automatic abort/retreat if the model turns negative.

---

# 18. Milestone U12 – Measured adaptation

## Shadow policies

Before a new policy controls behavior it can run in shadow mode:

```text
current decision
candidate decision
expected delta
actual subsequent outcome
```

## Prediction-error telemetry

Track:

- predicted vs actual haul throughput;
- predicted vs actual replacement coverage;
- predicted vs actual remote ROI;
- predicted vs actual CPU;
- predicted vs actual build rate;
- predicted vs actual combat outcome.

## Bounded self-tuning

Allow tuning only inside safe ranges:

- logistics margins;
- request hysteresis;
- remote confidence thresholds;
- upgrade allocation;
- builder allocation;
- market margins.

Never self-modify hard safety invariants.

---

# 19. Faster multi-chat development protocol

To accelerate development safely:

## 19.1 One stable contract per track

Before parallel work, define interfaces.

Example:

```text
runtime.capabilities API
request registry API
world intel API
path service API
telemetry API
```

Parallel chats work behind those interfaces.

## 19.2 Slice size

Preferred behavior slice:

- one hypothesis;
- one subsystem;
- one observable outcome;
- one regression fixture;
- one live gate.

Avoid month-sized PRs.

## 19.3 Shadow-first for structural migrations

For replacements of core systems:

1. new system computes result without acting;
2. compare legacy vs new;
3. establish equivalence/superiority;
4. switch one domain;
5. keep rollback path temporarily;
6. remove legacy only after stable live evidence.

This allows rapid architecture change without betting the live colony.

## 19.4 Shared fixture library

Every important production incident becomes a fixture:

- synchronized hauler expiry;
- consumer starvation despite CARRY surplus;
- spawn starvation;
- miner loss;
- controller emergency;
- remote invasion;
- path block;
- claim-limit error;
- low CPU;
- missing feature API.

This compounds development speed.

---

# 20. Verification hierarchy for VNext

## Level A – unit/contract

Pure algorithms:

- scoring;
- capacity;
- priority;
- route cost;
- body construction.

## Level B – scenario fixtures

Multi-module snapshots from real live states.

## Level C – shadow comparison

Candidate system computes but does not act.

## Level D – 25-tick smoke

Safety:

- version;
- runtime;
- collector;
- CPU;
- mining;
- hard stall;
- telemetry.

## Level E – 100+ tick behavior gate

Subsystem-specific KPIs.

## Level F – lifecycle gate

Must cover events such as:

- creep replacement;
- source regeneration;
- spawn cycle;
- threat arrival;
- remote transition;
- RCL transition.

A system is not considered robust if validation only covers steady state.

---

# 21. Immediate implementation order after current v0.2.20

The fastest safe order is:

```text
1. K0 Capability Discovery
2. O1 Universal State Snapshot
3. K1 CPU Process Scheduler
4. E0 Unified Request Registry in shadow mode
5. E1 Marginal Assignment for local productive work
6. E2 Capacity-Based Spawn Planner
7. E3/E4 Logistics Requests + Matching
8. P0/P1 shared cost/path layer
9. I0/I1 World Intel + autonomous scouting
10. P2/P3 planner + Min-Cut
11. I2 remotes
12. D0/D1 defense model
13. I3/I4 fully autonomous expansion
14. M0/M1 empire resource coordination
15. industry / market / power
16. strategic combat
17. bounded self-tuning
```

Why this order:

- capability discovery prevents future server lock-in;
- request/capacity systems remove the largest architectural bottleneck early;
- logistics becomes a generic service before remotes/empire multiply complexity;
- world intel and planner then feed both remotes and expansion;
- defense exists before aggressive expansion;
- late game builds on stable empire contracts.

---

# 22. Definition of “ultimate autonomous bot”

The project reaches its target only when all statements are true:

- a fresh deployment can bootstrap without gameplay instructions;
- it automatically learns relevant server capabilities;
- it does not assume real-time tick duration;
- it does not assume a hard-coded room limit;
- it automatically decides whether/where to scout;
- it automatically plans the base;
- it automatically decides what to build and when;
- it automatically sizes mining/logistics/work capacity;
- it predicts replacements;
- it recovers from creep loss;
- it defends automatically;
- it selects profitable remotes automatically;
- it decides expansion targets automatically;
- it places and bootstraps later colonies automatically;
- it coordinates resources between colonies;
- it uses available industry/market/power features automatically;
- it can plan and terminate military operations automatically;
- it degrades gracefully when optional APIs/features are absent;
- every major decision is explainable from state, request, score and evidence;
- every optimization can be measured against its predicted result.

---

# 23. Canonical VNext knowledge set

Deep study and algorithm notes:

`docs/ULTIMATE_AUTONOMY_KNOWLEDGE_BASE.md`

Stable implementation interfaces:

`docs/VNEXT_CORE_CONTRACTS.md`

Current-runtime to VNext strangler migration plan:

`docs/VNEXT_MIGRATION_MAP.md`

A new chat working on VNext should read:

1. this roadmap;
2. `docs/ULTIMATE_AUTONOMY_KNOWLEDGE_BASE.md` for the research and algorithms;
3. `docs/VNEXT_CORE_CONTRACTS.md` for the authoritative cross-track interfaces;
4. `docs/VNEXT_MIGRATION_MAP.md` before replacing any current runtime subsystem;
5. the current active PR/release evidence relevant to its assigned slice.

Do not repeat external-repo research unless a specific concept needs deeper verification or the source projects have materially changed. Do not redesign an existing core contract casually; version and migrate it if a change is necessary.

---

# 24. Current separation rule

At the time this roadmap was created, the live `v0.2.20` consumer/logistics release was still being verified.

Therefore:

- VNext research/documentation stays on its own branch;
- do not merge it merely for convenience while doing so would make the active release branch stale;
- after the active release is resolved, refresh this roadmap branch from current `main`;
- then merge documentation under the normal strict gate.

This preserves both development velocity and release integrity.
