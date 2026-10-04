# VNext Core Contracts

Stand: 2026-10-04
Status: implementation contract for the Ultimate Autonomous Roadmap

This file converts the research architecture into stable contracts so multiple implementation branches can work in parallel.

# 1. Contract rules

1. State producers expose facts; policy consumers decide what should happen.
2. Request producers never choose a specific creep unless the request is already in execution.
3. Capacity planners reason in body-part/effective-capability units, not role counts.
4. Spawn execution never invents strategic demand.
5. Executors never own empire strategy.
6. Every reservation has an owner, amount and expiry/revalidation rule.
7. Persistent records have schema versions.
8. Optional server features are capability-gated.
9. Every long-running operation has success, abort and recovery states.
10. Every prediction that controls behavior should have an observable outcome when practical.

# 2. RuntimeCapabilities

```text
RuntimeCapabilities {
  schemaVersion
  environment { shardName?, serverFingerprint? }
  cpu { limit, bucket, observedBucketMax?, heapStatsAvailable }
  persistence { segmentsAvailable, interShardMemoryAvailable }
  systems {
    marketAvailable, powerCreepsAvailable, factoriesAvailable,
    labsAvailable, observersAvailable, nukersAvailable
  }
  ownership {
    gclLevel, ownedRooms, activeClaimCommitments,
    discoveredClaimLimit?, claimPolicyConfidence, lastClaimFailure?
  }
  world { roomStatusAvailable, worldStatusAvailable }
  observed { tickDurationMsEMA?, lastUpdatedTick }
}
```

Invariant: no strategic module may check a server name when a normalized capability can answer the question.

Claim-policy rule:

- `ERR_GCL_NOT_ENOUGH` is dynamic GCL capacity evidence, not a persistent global room limit.
- `ERR_FULL` from a claim is contextual capacity evidence unless the server explicitly documents/provides a global limit.
- `discoveredClaimLimit` is populated only from explicit server metadata/adapters or later evidence strong enough to establish a global constraint.
- raw claim failures remain available through `lastClaimFailure` / server-profile observations for backoff and replanning.

# 3. WorldIntel

```text
RoomIntel {
  schemaVersion, roomName
  observation { lastSeenTick, confidence, source }
  classification { roomType, roomStatus?, highway?, sourceKeeper?, portal? }
  controller { exists, owner?, reservationOwner?, reservationTicks?, level?, safeMode? }
  resources { sourceCount, sources[], mineralType? }
  topology { exits[], terrainSummary, routeRisk }
  threat { lastHostileTick?, ownerStrengths[], staticDefense? }
  economics { remoteScore?, expansionRoomQuality?, dynamicScoreTick? }
}
```

Freshness is part of the data. Consumers must distinguish safe from unknown/stale.

# 4. ColonyState

```text
ColonyState {
  schemaVersion, tick, roomName
  mode
  controller, sources, stores, structures, construction
  spawn { spawns[], busyTicksProjected, energyAvailable, energyCapacity }
  capacity { active, projected, queued, spawning }
  logistics { supply, demand, routeMetrics }
  threat, cpu
  health { survivalFloorSatisfied, recoveryRisk, controllerRisk }
}
```

Initial modes: `BOOTSTRAP`, `RECOVERY`, `STABLE`, `GROWTH`, `DEFENSE`, `EXPANSION_SUPPORT`.

# 5. Request

```text
Request {
  schemaVersion, id, dedupeKey
  domain, kind
  createdTick, updatedTick, deadlineTick?
  target { roomName, id?, pos? }
  demand { resourceType?, capability?, amount, minimumUsefulAmount?, maximumUsefulAmount? }
  priority { base, urgency, strategicClass }
  utility { current, marginalModel }
  risk, dependencies[]
  status, progress
  reservations[]
  blocked { untilTick?, reason?, failureCount }
  evidence { source, hypothesis? }
}
```

Lifecycle: `OPEN → RESERVED → IN_PROGRESS → SATISFIED`, with `BLOCKED → OPEN` retry and terminal `EXPIRED | CANCELLED`.

Capacity-request semantics:

- `*_CAPACITY` requests publish total required capacity for the target scope.
- Producers may attach current-deficit evidence/urgency, but must not pre-subtract active capacity from `demand.amount`.
- E2 is the single owner of future deficit calculation so TTL, spawn congestion, spawning bodies, authoritative queue state and external commitments are subtracted exactly once.

# 6. Reservation

```text
Reservation {
  id, requestId, ownerType, ownerId, amount,
  createdTick, validUntilTick?, revalidateOn
}
```

Reserved resources/capacity are subtracted globally so double counting is impossible.

# 7. CapacityVector

```text
CapacityVector {
  workHarvest, workBuild, workRepair, workUpgrade,
  carry, moveEffective, claim, reserve,
  attack, ranged, heal, dismantle, toughEffective
}
```

Boosted capability is represented as effective capacity while raw parts remain available for accounting.

# 8. CapacityDeficit

```text
CapacityDeficit {
  requestGroup, target, required, active, projectedSurviving,
  queued, spawning, externallyCommitted, deficit,
  deadlineTick, priority
}
```

`active` is present-time capacity for observability. `projectedSurviving` is the subset of currently active capacity expected to remain productive at the evaluated future horizon and is therefore **not additive with `active`**.

Future deficit is computed as:

```text
required
- projectedSurviving
- spawningAvailableByHorizon
- queuedCapacityAvailableByHorizon
- externallyCommitted
= deficit
```

Projected surviving capacity excludes creeps whose TTL is at or below their productive-start horizon.

For SHADOW E2, proposed SpawnRequests are not a real queue. They must be reported separately from `queued` until the spawn scheduler becomes authoritative.

# 9. SpawnRequest

```text
SpawnRequest {
  id, sourceDeficitId, priority, deadlineTick?, targetRoom, dutyTarget?,
  body, cost, spawnTicks, capacityDelivered, capacityApplied?,
  predicted { queueDelay, travelTicks, safetyMarginTicks, productiveStartTick, productiveLifetime, expectedUtility },
  fallbackBody?
}
```

The spawn scheduler may reorder for deadline/safety but may not silently change strategic demand.

Body-optimizer contract (E2B):

```text
BodyOptimizationInput {
  role, capability, requestedCapacity, energyBudget, currentEnergy?,
  routeDistance, terrainProfile?, expectedLifetime, boosts?, maxParts
}

BodyOptimizationResult {
  body, cost, parts, spawnTicks, capacityDelivered, capacityApplied,
  travelTicks, productiveLifetime, expectedValue, expectedRoi, lifecycleCost,
  terrainProfile, boostMultiplier
}
```

Rules:

- primary bodies are generated from capability demand rather than fixed role tables;
- candidate bodies must respect energy budget and the 50-part limit;
- travel estimate uses body composition plus normalized road/plain/swamp fatigue when available;
- missing route terrain degrades explicitly to a conservative/default profile and is surfaced in optimizer metadata;
- optimization first maximizes useful requested capacity, then minimizes lifecycle opportunity cost through ROI/tie-break rules;
- boost multipliers may be used only when the request carries corresponding boost assumptions/reservations; absent boost evidence means multiplier `1`;
- fixed legacy bodies are permitted only as explicit survival/recovery fallbacks and may not become normal planning policy.

# 10. TransportLane

```text
TransportLane {
  id, resourceType, sourceNode, destinationClass
  route { distanceTicks, terrainProfile?, risk, cacheKey }
  flow {
    expectedProductionPerTick, currentBacklog, pickupReserved,
    expectedUntilArrival, deliveredEMA, lostOrDecayedEMA
  }
  capacity { requiredCarry, activeCarry, projectedCarry }
}
```

This is the primary transport truth. Hauler count is derived later.

# 11. LogisticsRequest

```text
LogisticsRequest {
  requestId, type, resourceType, amount, minimumUsefulAmount,
  source?, target?, priority, deadlineTick?, routeCost?, reservation
}
```

Types: `PICKUP`, `DELIVER`, `BALANCE`, `EMERGENCY_DELIVER`, `EVACUATE`.

# 12. Assignment

```text
Assignment {
  id, requestId, executorId, assignedTick,
  reservedCapacity, expectedTravel, expectedUtility,
  status, lastProgressTick, failureReason?
}
```

Baseline score:

```text
marginalUtility + deadlineUrgency + localityBonus + carriedResourceBonus
- travelCost - switchCost - riskCost - opportunityCost
```

Assignment supports continuation bias and emergency preemption.

Assignment boundary rules:

- `*_CAPACITY` requests are total-capacity requirements, not executor jobs. E2 converts them into future `CapacityDeficit` records after subtracting projected surviving, spawning, queued and externally committed capacity; E1 never assigns creeps directly to them.
- E1 consumes executable requests such as BUILD, REPAIR, UPGRADE and ENERGY_DELIVERY.
- While authority is `SHADOW`, E1 uses an internal per-plan remaining-need ledger and does not mutate authoritative RequestRegistry reservations.
- Shadow assignment may be deferred under CPU pressure; telemetry must expose the last plan tick and the deferral reason.
- When E1 becomes authoritative, its reservations must move onto the canonical Reservation contract so all planners subtract the same commitments.

Assignment-evidence contract (O2):

```text
AssignmentEvidenceWindow {
  schemaVersion, authority, startTick, endTick, ticks,
  requestsOpened, requestsClosed, averageRequestLatency, maxRequestLatency,
  averageActiveRequests, averageBlockedRequests, blockedReasons,
  assignmentsPerTick, switchesPerTick, deferredRatio,
  averageUnfilledRequests, averageUnfilledNeed,
  averageCandidateExecutorsWhenUnfilled, idleCompatibleExecutorRatio,
  controllerProgress, constructionProgress, usefulWorkPerTick
}
```

Semantics:

- request latency is measured per request episode from `createdTick` to terminal `updatedTick`;
- reopened demand is a new episode and must not inherit prior latency;
- blocked reason counts are request-ticks, not unique requests;
- `idleCompatibleExecutorRatio` counts compatible, unassigned executors only while assignable demand remains unfilled;
- `usefulWorkPerTick` follows the existing productive-throughput evidence convention: observed controller + construction progress per tick; repair output is not inferred unless direct action telemetry is added later;
- low-CPU assignment deferral is measured explicitly and must not be mistaken for zero demand;
- O2 is evidence only and must not modify priorities, reservations, or assignments.

# 13. CPU ProcessDescriptor

```text
ProcessDescriptor {
  id, priorityClass, deadlineTick?, minimumInterval, freshnessRequirement?,
  estimatedCpu, measuredCpuEMA, canSleep, canDegrade, resumable, stateKey?
}
```

Classes: `CRITICAL`, `DEADLINE`, `STANDARD`, `BACKGROUND`, `OVERFLOW`.

The scheduler publishes skip/defer reason for observability.

# 14. PlannerArtifact

```text
PlannerArtifact {
  schemaVersion, plannerVersion, roomName, createdTick,
  capabilityFingerprint, sourceIntelVersion, phase, complete,
  score { total, logistics, defense, traffic, upgrade, expansion, cpu },
  structures[], roads[], ramparts[], harvestPositions[], reservedTiles[],
  phaseEvidence[]
}
```

Each planned structure:

```text
PlannedStructure { type, pos, earliestCapability, priorityClass, dependencies[] }
```

# 15. ArtifactStore

```text
ArtifactStore {
  capability
  get(key)
  put(key, value, schemaVersion)
  delete(key)
  invalidate(key, reason)
}
```

Backends: RawMemory segment, compact Memory, or recompute-only. Consumers are backend-agnostic.

# 16. Operation

```text
Operation {
  schemaVersion, id, type, objective, createdTick, phase,
  target, parentColonies[], expectedValue, budget,
  requirements[], reservations[], assignments[],
  successConditions[], abortConditions[],
  failureHistory[], blockedUntil?, telemetry
}
```

Used for expansion, combat, power bank, deposits, recovery support and evacuation.

Every phase transition records evidence. Operations have watchdog/deadline rules.

# 17. SupportRequest

```text
SupportRequest {
  id, targetColony, type, capability?, resourceType?, amount,
  latestUsefulArrivalTick, expectedRecoveryBenefit,
  candidateProviders[], selectedProvider?, transportOrSpawnPlan?, status
}
```

Types: `RECOVERY_WORK`, `ENERGY`, `DEFENSE`, `BOOTSTRAP`, `BOOST`, `RESOURCE`, `EVACUATION`.

# 18. ThreatModel

```text
ThreatModel {
  tick, roomName, hostileActors[],
  aggregate { meleeDps, rangedDps, healPerTick, dismantlePerTick, effectiveTough, mobility },
  access { breachPaths[], criticalAssetsAtRisk[], earliestImpactTick? },
  towers { friendlyCoverage, hostileCoverage },
  risk { state, coreLossProbability, recommendedSafeMode }
}
```

States: `NORMAL`, `WATCH`, `ALERT`, `DEFENSE`, `EMERGENCY`.

# 19. RemoteAsset

```text
RemoteAsset {
  roomName, parentColony, state, sources[],
  income { grossPerTick, netPerTick, confidence },
  costs { miner, hauler, reserve, repair, infrastructure, riskLoss, cpu },
  route, threat, roi, lastEvaluationTick, blockedUntil?
}
```

States: `DISCOVERED`, `CANDIDATE`, `ACTIVE`, `THREATENED`, `SUSPENDED`, `RETIRED`.

# 20. ExpansionCandidate

```text
ExpansionCandidate {
  roomName,
  roomQuality { economy, planner, defense, remotes, terrain },
  empireFit { supportDistance, resourceDiversity, frontierValue, regionalRisk, terminalTopology, cpuBurden },
  totalScore, confidence, plannerViable, claimCompatible,
  failureHistory[], blockedUntil?
}
```

No manual target is required.

# 21. ResourceReserve

```text
ResourceReserve {
  resourceType, survivalReserve, forecastDemand, operationReservations,
  productionPipelineDemand, desiredBuffer, currentStock, inbound,
  outboundCommitted, excess, deficit
}
```

Used by terminal, market, labs, factory and power.

# 22. ProductionRequest

```text
ProductionRequest {
  id, product, amount, reason, deadlineTick?,
  dependencyGraph, ingredients, reservedIngredients,
  expectedStrategicValue, estimatedCost,
  producerCandidates[], selectedProducer?, status
}
```

Production consumes the empire resource ledger; it is not an independent fixed-threshold script.

# 23. MarketDecision

```text
MarketDecision {
  resourceType, action, amount, roomName, nominalPrice,
  transactionEnergy, energyShadowPrice, reserveOpportunityCost,
  terminalOpportunityCost, effectiveValue,
  alternativeInternalTransferValue, evidence
}
```

Actions: `BUY`, `SELL`, `CREATE_ORDER`, `UPDATE_ORDER`, `CANCEL_ORDER`, `NO_ACTION`.

# 24. PredictionRecord

```text
PredictionRecord {
  id, subsystem, createdTick, prediction, evaluationTick,
  observedOutcome?, error?, accepted?
}
```

Used for projected transport coverage, remote ROI, expansion time, planner CPU, combat outcome and productive throughput.

# 25. Migration contract

```text
SchemaDescriptor {
  name, currentVersion, migrate(fromVersion, value), canHardReset
}
```

Boot sequence:

```text
detect respawn/reset
→ activate persistence capabilities
→ load schema versions
→ migrate
→ validate
→ invalidate incompatible derived artifacts
→ rebuild normalized state
→ run gameplay
```

Migration failure fails closed for an optional subsystem rather than corrupting survival state.

# 26. Parallel-development ownership

```text
K: RuntimeCapabilities, ProcessDescriptor, ArtifactStore, Migration
E: Request, Reservation, CapacityVector, CapacityDeficit, SpawnRequest, TransportLane, LogisticsRequest, Assignment
P: PlannerArtifact, path/cost-field contracts
I: WorldIntel, RemoteAsset, ExpansionCandidate
D: ThreatModel and defense/combat request specializations
M: SupportRequest, ResourceReserve, ProductionRequest, MarketDecision
O: PredictionRecord, telemetry schemas, verification gates
```

A branch may consume another track's contract but should not rewrite its schema without coordination.

# 27. First implementation seam

After the current v0.2.20 release is resolved:

```text
K0.1 RuntimeCapabilities data object
K0.2 safe feature probes
K0.3 claim-policy observation
K0.4 capability telemetry
K0.5 restart persistence
```

These are behavior-neutral.

Then parallel-safe:

```text
O1 normalized ColonyState snapshot
K1 ProcessDescriptor scheduler skeleton
I0 RoomIntel schema + freshness
```

Only after these contracts stabilize should E0 Request Registry begin controlling gameplay.

# 28. Contract acceptance

A contract is stable when:

1. producer has deterministic fixtures;
2. missing/unknown fields are explicitly defined;
3. persistence version is defined where needed;
4. consumer can operate without reaching into producer internals;
5. telemetry can explain the important decision;
6. restart preserves semantics;
7. optional server features are explicit;
8. no manual gameplay input is required to populate required fields.