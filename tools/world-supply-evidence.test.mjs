import assert from 'node:assert/strict';
import { summarizeSupplyJournal } from './world-supply-evidence.mjs';
const id='deploy-1';
assert.equal(summarizeSupplyJournal(null,id).state,'UNKNOWN');
assert.equal(summarizeSupplyJournal({deploymentId:'other',deploymentTick:100,telemetryJournal:{events:[]}},id).state,'UNKNOWN');
const sample=t=>({c:'CONSUMER_SUPPLY_DIAG',t,x:{room:'W37S79',
  phase:'AFTER_CREEP_INTENTS_BEFORE_RESOLUTION',acceptedIsIntentNotSettled:true,
  consumers:{critical:1},haulers:{live:2,readyByGuardRule:0},
  reservationCoverage:{acceptedDeliveryProof:false,criticalWithReadySticky:0,
    criticalWithoutReadySticky:1,criticalWithSticky:0,criticalWithoutSticky:1,
    criticalWithDuplicateSticky:0,stickyWithoutEnergy:0,
    readyHaulersWithoutSticky:0,stickyAssignments:0}}});
const bot={deploymentId:id,deploymentTick:100,telemetryJournal:{events:[sample(100),sample(125),sample(150)]}};
const result=summarizeSupplyJournal(bot,id);
assert.equal(result.state,'OBSERVATIONS_AVAILABLE');
assert.equal(result.sampleCount,3);
assert.equal(result.patterns.length,1);
assert.equal(result.patterns[0].sampleCount,3);
assert.equal(result.patterns[0].startTick,100);
assert.equal(result.patterns[0].endTick,150);
assert.equal(result.patterns[0].reasonCode,'NO_READY_HAULERS');
assert.equal(result.settledDeliveryProof,false);
assert.equal(summarizeSupplyJournal({...bot,telemetryJournal:{events:[sample(100),sample(100)]}},id).state,'REVIEW_REQUIRED');
const gap = summarizeSupplyJournal({...bot,telemetryJournal:{events:[sample(100),sample(150)]}},id);
assert.deepEqual(gap.missingSampleTicks,[125]);
assert.equal(gap.observedCadenceComplete,false);
assert.equal(gap.patterns.length,0);
assert.equal(result.observedCadenceComplete,true);
assert.deepEqual(result.missingSampleTicks,[]);
// New load-state telemetry is strictly optional for historical deployments.
// Missing values must not be interpreted as zero collecting haulers.
assert.equal(result.observedHaulerLoadStateSamples,0);
assert.deepEqual(result.haulerLoadStates,[]);
assert.deepEqual(result.criticalGapLoadStates,[],
  'Historical samples without load-state counters cannot be correlated');
assert.equal(result.observedHaulerLifetimeSamples,0);
assert.deepEqual(result.haulerLifetimeStates,[]);
assert.deepEqual(result.criticalGapLifetimeStates,[]);
assert.equal(result.observedHaulerActionSamples,0);
assert.deepEqual(result.haulerActionStates,[]);
assert.deepEqual(result.criticalGapActionStates,[],
  'Legacy samples without guarded transfer intent counters remain unknown');
assert.equal(result.observedRoomEnergySamples,0);
assert.deepEqual(result.roomEnergyStates,[]);
assert.deepEqual(result.criticalGapRoomEnergyStates,[],
  'Historical missing room energy must not imply that spawn is full');
{
  const load = (tick, overrides={}) => {
    const e=sample(tick);
    e.x.haulers={live:3,readyByGuardRule:1,zeroEnergy:1,
      energyPositive:2,collectingEmpty:1,collectingPartialBelowThreshold:1,
      ...overrides};
    return e;
  };
  const report=summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[load(100),sample(125),load(150)]
  }},id);
  assert.equal(report.state,'OBSERVATIONS_AVAILABLE');
  assert.equal(report.sampleCount,3);
  assert.equal(report.observedHaulerLoadStateSamples,2);
  assert.deepEqual(report.haulerLoadStates,[
    {tick:100,live:3,readyByGuardRule:1,
      collectingEmpty:1,collectingPartialBelowThreshold:1},
    {tick:150,live:3,readyByGuardRule:1,
      collectingEmpty:1,collectingPartialBelowThreshold:1}
  ]);
  assert.deepEqual(report.criticalGapLoadStates,[
    {tick:100,live:3,readyByGuardRule:1,
      collectingEmpty:1,collectingPartialBelowThreshold:1,
      uncoveredCriticalCount:1,reasonCodes:['CRITICAL_READY_COVERAGE_GAP']},
    {tick:150,live:3,readyByGuardRule:1,
      collectingEmpty:1,collectingPartialBelowThreshold:1,
      uncoveredCriticalCount:1,reasonCodes:['CRITICAL_READY_COVERAGE_GAP']}
  ]);
  const healthy=load(125);
  healthy.x.consumers={critical:0};
  healthy.x.reservationCoverage=null;
  const mixed=summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[load(100),healthy,load(150)]
  }},id);
  assert.equal(mixed.observedHaulerLoadStateSamples,3);
  assert.deepEqual(mixed.criticalGapLoadStates,report.criticalGapLoadStates,
    'Ready load-state samples without critical gaps must not be called gaps');
  for (const bad of [
    {collectingPartialBelowThreshold:-1},
    {collectingEmpty:2},
    {collectingPartialBelowThreshold:3},
    {live:2},
    {collectingPartialBelowThreshold:undefined},
    {readyByGuardRule:NaN}
  ]) {
    const invalid=summarizeSupplyJournal({...bot,telemetryJournal:{
      events:[load(100,bad)]
    }},id);
    assert.equal(invalid.state,'REVIEW_REQUIRED');
    assert.equal(invalid.invalidSamples,1);
    assert.equal(invalid.observedHaulerLoadStateSamples,0);
    assert.deepEqual(invalid.criticalGapLoadStates,[],
      'Invalid load-state counters must never appear in gap correlations');
  }
}
// Life-cycle evidence must be tick-matched, complete and bounded. It is
// strictly observational: a soon-expiring TTL is not a proven death reason.
{
  const lifetime = (tick, overrides={}) => {
    const e=sample(tick);
    e.x.haulers={live:2,readyByGuardRule:1,energyPositive:1,zeroEnergy:1,
      knownTtl:2,unknownTtl:0,withinSpawnHorizon:1,
      minimumKnownTtl:29,spawnHorizonTicks:30,...overrides};
    return e;
  };
  const report=summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[lifetime(100),sample(125),lifetime(150)]
  }},id);
  assert.equal(report.state,'OBSERVATIONS_AVAILABLE');
  assert.equal(report.observedHaulerLifetimeSamples,2);
  assert.deepEqual(report.haulerLifetimeStates,[
    {tick:100,live:2,knownTtl:2,unknownTtl:0,withinSpawnHorizon:1,
      minimumKnownTtl:29,spawnHorizonTicks:30},
    {tick:150,live:2,knownTtl:2,unknownTtl:0,withinSpawnHorizon:1,
      minimumKnownTtl:29,spawnHorizonTicks:30}
  ]);
  assert.deepEqual(report.criticalGapLifetimeStates,[
    {...report.haulerLifetimeStates[0],uncoveredCriticalCount:1,
      reasonCodes:['CRITICAL_READY_COVERAGE_GAP']},
    {...report.haulerLifetimeStates[1],uncoveredCriticalCount:1,
      reasonCodes:['CRITICAL_READY_COVERAGE_GAP']}
  ]);
  const healthy=lifetime(125);
  healthy.x.consumers={critical:0};
  healthy.x.reservationCoverage=null;
  const mixed=summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[lifetime(100),healthy,lifetime(150)]
  }},id);
  assert.equal(mixed.observedHaulerLifetimeSamples,3);
  assert.deepEqual(mixed.criticalGapLifetimeStates,report.criticalGapLifetimeStates,
    'healthy tick must not enter the critical-gap correlation');
  for (const bad of [
    {knownTtl:3},
    {unknownTtl:-1},
    {withinSpawnHorizon:3},
    {minimumKnownTtl:null},
    {spawnHorizonTicks:0},
    {spawnHorizonTicks:null},
    {minimumKnownTtl:40}
  ]) {
    const invalid=summarizeSupplyJournal({...bot,telemetryJournal:{
      events:[lifetime(100,bad)]
    }},id);
    assert.equal(invalid.state,'REVIEW_REQUIRED');
    assert.equal(invalid.invalidSamples,1);
    assert.equal(invalid.observedHaulerLifetimeSamples,0);
    assert.deepEqual(invalid.criticalGapLifetimeStates,[]);
  }
}
// Optional policy eligibility is separate from geometric TTL proximity.
// Historical entries without these fields keep their earlier schema.
{
  const policySample = (tick, policy = {}, state = {}) => {
    const e=sample(tick);
    e.x.haulers={
      live:2,readyByGuardRule:1,energyPositive:1,zeroEnergy:1,
      knownTtl:2,unknownTtl:0,withinSpawnHorizon:1,
      minimumKnownTtl:29,spawnHorizonTicks:30,
      prespawnPolicyEligible:true,eligibleExpiringHaulers:1,
      ...policy,...state
    };
    return e;
  };
  const report=summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[
      policySample(100),
      policySample(125,{prespawnPolicyEligible:false,eligibleExpiringHaulers:0}),
      policySample(150,{prespawnPolicyEligible:null,eligibleExpiringHaulers:null})
    ]
  }},id);
  assert.equal(report.state,'OBSERVATIONS_AVAILABLE');
  assert.equal(report.observedHaulerLifetimeSamples,3);
  assert.deepEqual(report.haulerLifetimeStates.map(x=>[
    x.prespawnPolicyEligible,x.eligibleExpiringHaulers
  ]),[[true,1],[false,0],[null,null]]);
  assert.equal(report.criticalGapLifetimeStates.length,3);
  assert.equal(report.criticalGapLifetimeStates[0].eligibleExpiringHaulers,1);
  const absentHorizon=summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[policySample(100,{eligibleExpiringHaulers:null},{
      withinSpawnHorizon:0,spawnHorizonTicks:null})]
  }},id);
  assert.equal(absentHorizon.state,'OBSERVATIONS_AVAILABLE');
  assert.equal(absentHorizon.haulerLifetimeStates[0].eligibleExpiringHaulers,null);
  for(const overrides of [
    {prespawnPolicyEligible:false,eligibleExpiringHaulers:1},
    {prespawnPolicyEligible:true,eligibleExpiringHaulers:0},
    {prespawnPolicyEligible:null,eligibleExpiringHaulers:0},
    {prespawnPolicyEligible:true,eligibleExpiringHaulers:3},
    {eligibleExpiringHaulers:undefined},
    {prespawnPolicyEligible:'true'}
  ]) {
    const invalid=summarizeSupplyJournal({...bot,telemetryJournal:{
      events:[policySample(100,overrides)]
    }},id);
    assert.equal(invalid.state,'REVIEW_REQUIRED');
    assert.equal(invalid.invalidSamples,1);
    assert.equal(invalid.observedHaulerLifetimeSamples,0);
  }
}
// A sample is one integrity unit: valid load numbers must not be retained
// when its TTL, policy, or coverage data is malformed, or vice versa.
{
  const combined = (tick, hauler = {}, coverage = {}) => {
    const e = sample(tick);
    e.x.haulers = {
      live: 2, readyByGuardRule: 1, energyPositive: 1, zeroEnergy: 1,
      collectingEmpty: 1, collectingPartialBelowThreshold: 0,
      knownTtl: 2, unknownTtl: 0, withinSpawnHorizon: 1,
      minimumKnownTtl: 29, spawnHorizonTicks: 30,
      prespawnPolicyEligible: true, eligibleExpiringHaulers: 1,
      ...hauler
    };
    e.x.reservationCoverage = { ...e.x.reservationCoverage, ...coverage };
    return e;
  };
  const good = summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[combined(100),combined(125),combined(150)]
  }}, id);
  assert.equal(good.state,'OBSERVATIONS_AVAILABLE');
  assert.equal(good.observedHaulerLoadStateSamples,3);
  assert.equal(good.observedHaulerLifetimeSamples,3);
  assert.equal(good.criticalGapLoadStates.length,3);
  assert.equal(good.criticalGapLifetimeStates.length,3);
  const malformedCases = [
    combined(100,{knownTtl:3}),
    combined(100,{collectingEmpty:2}),
    combined(100,{eligibleExpiringHaulers:2}),
    combined(100,{}, {acceptedDeliveryProof:true})
  ];
  for (const event of malformedCases) {
    const invalid = summarizeSupplyJournal({...bot,telemetryJournal:{
      events:[event]
    }}, id);
    assert.equal(invalid.state,'REVIEW_REQUIRED');
    assert.equal(invalid.invalidSamples,1);
    assert.equal(invalid.observedHaulerLoadStateSamples,0);
    assert.equal(invalid.observedHaulerLifetimeSamples,0);
    assert.deepEqual(invalid.criticalGapLoadStates,[]);
    assert.deepEqual(invalid.criticalGapLifetimeStates,[]);
  }
  const interrupted=summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[combined(100),combined(125,{knownTtl:3}),combined(150)]
  }},id);
  assert.equal(interrupted.state,'REVIEW_REQUIRED');
  assert.equal(interrupted.observedHaulerLoadStateSamples,2);
  assert.equal(interrupted.observedHaulerLifetimeSamples,2);
  assert.deepEqual(interrupted.haulerLoadStates.map(s=>s.tick),[100,150]);
  assert.deepEqual(interrupted.haulerLifetimeStates.map(s=>s.tick),[100,150]);
  assert.deepEqual(interrupted.patterns,[],
    'Malformed middle tick breaks a repeated-association pattern');
}
// Explain why a modeled prespawn gate is closed without treating a short
// TTL or an unknown economy field as proof of a missed spawn.
{
  const withBlockers = (tick, overrides = {}) => {
    const e=sample(tick);
    e.x.haulers={
      live:2,readyByGuardRule:1,zeroEnergy:1,energyPositive:1,
      knownTtl:2,unknownTtl:0,withinSpawnHorizon:0,
      minimumKnownTtl:746,spawnHorizonTicks:30,
      prespawnPolicyEligible:false,eligibleExpiringHaulers:0,
      prespawnPolicyBlockers:['SOURCE_CONTAINER_COVERAGE_MISMATCH'],
      ...overrides
    };
    return e;
  };
  const report=summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[
      withBlockers(100),
      withBlockers(125,{prespawnPolicyEligible:true,
        prespawnPolicyBlockers:[]}),
      withBlockers(150,{prespawnPolicyEligible:null,
        eligibleExpiringHaulers:null,prespawnPolicyBlockers:null})
    ]
  }},id);
  assert.equal(report.state,'OBSERVATIONS_AVAILABLE');
  assert.equal(report.observedHaulerLifetimeSamples,3);
  assert.deepEqual(report.haulerLifetimeStates.map(x =>
    x.prespawnPolicyBlockers),[
      ['SOURCE_CONTAINER_COVERAGE_MISMATCH'],[],null
    ]);
  assert.deepEqual(report.criticalGapLifetimeStates[0].prespawnPolicyBlockers,
    ['SOURCE_CONTAINER_COVERAGE_MISMATCH']);
  const multiple=summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[withBlockers(100,{prespawnPolicyBlockers:[
      'SOURCE_CONTAINER_COVERAGE_MISMATCH',
      'MODELED_HAULER_DEMAND_BELOW_TWO'
    ]})]
  }},id);
  assert.equal(multiple.state,'OBSERVATIONS_AVAILABLE');
  assert.equal(multiple.haulerLifetimeStates[0].prespawnPolicyBlockers.length,2);
  for(const overrides of [
    {prespawnPolicyEligible:true,prespawnPolicyBlockers:['COLONY_EMERGENCY']},
    {prespawnPolicyBlockers:[]},
    {prespawnPolicyBlockers:['INVENTED_REASON']},
    {prespawnPolicyBlockers:['NO_SOURCES','NO_SOURCES']},
    {prespawnPolicyBlockers:'SOURCE_CONTAINER_COVERAGE_MISMATCH'},
    {prespawnPolicyEligible:null,eligibleExpiringHaulers:null,
      prespawnPolicyBlockers:[]},
    {prespawnPolicyBlockers:undefined}
  ]) {
    const invalid=summarizeSupplyJournal({...bot,telemetryJournal:{
      events:[withBlockers(100,overrides)]
    }},id);
    assert.equal(invalid.state,'REVIEW_REQUIRED');
    assert.equal(invalid.invalidSamples,1);
    assert.equal(invalid.observedHaulerLifetimeSamples,0);
  }
}
// Join actual decisions and returned intent codes, never a settled energy
// receipt. Only complete and internally coherent groups are admissible.
{
  const action=(tick,changes={})=>{
    const e=sample(tick);
    e.x.haulers={live:3,readyByGuardRule:2,zeroEnergy:1,energyPositive:2,
      collectingEmpty:1,collectingPartialBelowThreshold:0,
      knownTtl:3,unknownTtl:0,withinSpawnHorizon:0,
      minimumKnownTtl:450,spawnHorizonTicks:30};
    e.x.decisions={guardChecks:3,guardSelected:1,uniqueGuardHaulers:1};
    e.x.consumerTransfers={attempted:1,accepted:0,notInRange:1,other:0};
    e.x.infrastructureTransfers={attempted:1,accepted:1,notInRange:0,other:0};
    e.x.haulerAcquisitions={attempted:1,accepted:0,notInRange:1,other:0};
    Object.assign(e.x,changes);
    return e;
  };
  const green=action(100);
  const healthy=action(125);
  healthy.x.consumers={critical:0};
  healthy.x.reservationCoverage=null;
  const report=summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[green,healthy,action(150)]
  }},id);
  assert.equal(report.state,'OBSERVATIONS_AVAILABLE');
  assert.equal(report.observedHaulerActionSamples,3);
  assert.deepEqual(report.haulerActionStates.map(s=>s.tick),[100,125,150]);
  assert.equal(report.haulerActionStates[0].guardChecks,3);
  assert.equal(report.haulerActionStates[0].guardSelected,1);
  assert.equal(report.haulerActionStates[0].uniqueGuardHaulers,1);
  assert.deepEqual(report.haulerActionStates[0].consumerTransferIntents,
    {attempted:1,accepted:0,notInRange:1,other:0});
  assert.deepEqual(report.haulerActionStates[0].infrastructureTransferIntents,
    {attempted:1,accepted:1,notInRange:0,other:0});
  assert.deepEqual(report.haulerActionStates[0].haulerAcquisitionIntents,
    {attempted:1,accepted:0,notInRange:1,other:0});
  assert.equal(report.haulerActionStates[0].settledDeliveryProof,false);
  assert.deepEqual(report.criticalGapActionStates.map(s=>s.tick),[100,150],
    'Healthy middle tick must not be associated with a critical gap');
  assert.equal(report.criticalGapActionStates[0].uncoveredCriticalCount,1);
  assert.deepEqual(report.criticalGapActionStates[0].reasonCodes,
    ['CRITICAL_READY_COVERAGE_GAP']);
  assert.equal(report.criticalGapActionStates[0].settledDeliveryProof,false,
    'Accepted return code is an intent, never actual energy delivery');
  const old=sample(100);
  const mixed=summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[old,action(125)]
  }},id);
  assert.equal(mixed.state,'OBSERVATIONS_AVAILABLE');
  assert.equal(mixed.observedHaulerActionSamples,1,
    'Historical missing action counters cannot be interpreted as zeros');
  assert.deepEqual(mixed.haulerActionStates.map(s=>s.tick),[125]);
  const bad=[
    {decisions:{guardChecks:1,guardSelected:2,uniqueGuardHaulers:1}},
    {decisions:{guardChecks:3,guardSelected:1,uniqueGuardHaulers:2}},
    {decisions:{guardChecks:3,guardSelected:3,uniqueGuardHaulers:4}},
    {decisions:{guardChecks:3,guardSelected:1,uniqueGuardHaulers:-1}},
    {decisions:{guardChecks:3,guardSelected:1,uniqueGuardHaulers:1.5}},
    {consumerTransfers:{attempted:1,accepted:1,notInRange:1,other:0}},
    {infrastructureTransfers:{attempted:1,accepted:-1,notInRange:1,other:1}},
    {haulerAcquisitions:{attempted:2,accepted:0,notInRange:1,other:0}},
    {consumerTransfers:undefined}
  ];
  for (const patch of bad) {
    const invalid=summarizeSupplyJournal({...bot,telemetryJournal:{
      events:[action(100,patch)]
    }},id);
    assert.equal(invalid.state,'REVIEW_REQUIRED');
    assert.equal(invalid.invalidSamples,1);
    assert.equal(invalid.observedHaulerActionSamples,0);
    assert.equal(invalid.observedHaulerLoadStateSamples,0);
    assert.equal(invalid.observedHaulerLifetimeSamples,0);
    assert.deepEqual(invalid.criticalGapActionStates,[]);
    assert.deepEqual(invalid.criticalGapLoadStates,[]);
  }
  const broken=summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[action(100),action(125,bad[0]),action(150)]
  }},id);
  assert.equal(broken.invalidSamples,1);
  assert.deepEqual(broken.haulerActionStates.map(s=>s.tick),[100,150]);
  assert.deepEqual(broken.patterns,[],
    'Malformed intent snapshot must break an otherwise consecutive pattern');
}
// A selected underfilled rescue hauler is not a regular ready guard.
// Its selection must be visible as distinct, post-intent, non-settled
// evidence; historical action samples have no implicit rescue zeroes.
{
  const rescue = (tick, decisionsOverride = {}) => {
    const e=sample(tick);
    e.x.haulers={live:3,readyByGuardRule:1,
      energyPositive:3,zeroEnergy:0,
      collectingEmpty:0,collectingPartialBelowThreshold:2};
    e.x.decisions={
      guardChecks:1,guardSelected:0,uniqueGuardHaulers:0,
      rescueChecks:2,rescueSelected:1,uniqueRescueHaulers:1,
      ...decisionsOverride
    };
    e.x.consumerTransfers={attempted:1,accepted:0,notInRange:1,other:0};
    e.x.infrastructureTransfers={attempted:1,accepted:0,notInRange:1,other:0};
    e.x.haulerAcquisitions={attempted:1,accepted:0,notInRange:1,other:0};
    return e;
  };
  const report=summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[rescue(100),rescue(125)]
  }},id);
  assert.equal(report.state,'OBSERVATIONS_AVAILABLE');
  assert.equal(report.observedHaulerActionSamples,2);
  assert.deepEqual(report.haulerActionStates.map(x=>[
    x.rescueChecks,x.rescueSelected,x.uniqueRescueHaulers
  ]),[[2,1,1],[2,1,1]]);
  assert.deepEqual(report.criticalGapActionStates.map(x=>x.tick),[100,125]);
  assert.equal(report.criticalGapActionStates[0].consumerTransferIntents.notInRange,1);
  assert.equal(report.criticalGapActionStates[0].settledDeliveryProof,false);
  const mixed=rescue(125);
  delete mixed.x.decisions.rescueChecks;
  delete mixed.x.decisions.rescueSelected;
  delete mixed.x.decisions.uniqueRescueHaulers;
  const legacy=summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[rescue(100),mixed]
  }},id);
  assert.equal(legacy.state,'OBSERVATIONS_AVAILABLE');
  assert.equal(legacy.observedHaulerActionSamples,2);
  assert.equal(Object.hasOwn(legacy.haulerActionStates[1],'rescueSelected'),false,
    'older action samples without rescue evidence must not report rescueSelected=0');
  for (const patch of [
    {rescueChecks:0,rescueSelected:1},
    {rescueSelected:3},
    {rescueChecks:3,rescueSelected:2,uniqueRescueHaulers:3},
    {rescueChecks:4,rescueSelected:4,uniqueRescueHaulers:4},
    {rescueSelected:-1},
    {uniqueRescueHaulers:NaN},
    {rescueChecks:undefined}
  ]) {
    const invalid=summarizeSupplyJournal({...bot,telemetryJournal:{
      events:[rescue(100,patch)]
    }},id);
    assert.equal(invalid.state,'REVIEW_REQUIRED',JSON.stringify(patch));
    assert.equal(invalid.invalidSamples,1);
    assert.equal(invalid.observedHaulerActionSamples,0);
    assert.equal(invalid.observedHaulerLoadStateSamples,0);
    assert.deepEqual(invalid.criticalGapActionStates,[]);
  }
}
// RoomManager's infrastructure energy evidence explains why a partial-load
// rescue cannot automatically be inferred from an underfilled hauler.
// It is a point-in-time observation, not permission to divert infrastructure.
{
  const make=(tick,roomEnergy)=>{
    const e=sample(tick);
    if(roomEnergy!==undefined)e.x.roomEnergy=roomEnergy;
    return e;
  };
  const full={observed:true,available:550,capacity:550,full:true};
  const partial={observed:true,available:451,capacity:550,full:false};
  const unknown={observed:false,available:null,capacity:null,full:null};
  const healthy=make(125,partial);
  healthy.x.consumers={critical:0};
  healthy.x.reservationCoverage=null;
  const report=summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[make(100,full),healthy,make(150,unknown)]
  }},id);
  assert.equal(report.state,'OBSERVATIONS_AVAILABLE');
  assert.equal(report.observedRoomEnergySamples,3);
  assert.deepEqual(report.roomEnergyStates,[
    {tick:100,...full},{tick:125,...partial},{tick:150,...unknown}
  ]);
  assert.deepEqual(report.criticalGapRoomEnergyStates,[
    {tick:100,...full,uncoveredCriticalCount:1,
      reasonCodes:['NO_READY_HAULERS','CRITICAL_READY_COVERAGE_GAP']},
    {tick:150,...unknown,uncoveredCriticalCount:1,
      reasonCodes:['NO_READY_HAULERS','CRITICAL_READY_COVERAGE_GAP']}
  ]);
  const legacy=summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[make(100,full),make(125)]
  }},id);
  assert.equal(legacy.observedRoomEnergySamples,1);
  assert.deepEqual(legacy.roomEnergyStates.map(s=>s.tick),[100]);
  for(const invalidEnergy of [
    null,{observed:true,available:-1,capacity:550,full:false},
    {observed:true,available:551,capacity:550,full:false},
    {observed:true,available:500,capacity:550,full:true},
    {observed:true,available:500,capacity:550,full:false,extra:1},
    {observed:true,available:1.5,capacity:550,full:false},
    {observed:true,available:0,capacity:0,full:true},
    {observed:false,available:0,capacity:null,full:null},
    {observed:false,available:null,capacity:null,full:false},
    {observed:null,available:null,capacity:null,full:null}
  ]) {
    const invalid=summarizeSupplyJournal({...bot,telemetryJournal:{
      events:[make(100,invalidEnergy)]
    }},id);
    assert.equal(invalid.state,'REVIEW_REQUIRED');
    assert.equal(invalid.invalidSamples,1);
    assert.equal(invalid.observedRoomEnergySamples,0);
    assert.deepEqual(invalid.criticalGapRoomEnergyStates,[]);
  }
  const interrupted=summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[make(100,full),make(125,{...partial,full:true}),make(150,full)]
  }},id);
  assert.equal(interrupted.invalidSamples,1);
  assert.deepEqual(interrupted.roomEnergyStates.map(s=>s.tick),[100,150]);
  assert.deepEqual(interrupted.patterns,[],
    'invalid intermediate room-energy snapshot breaks repeated evidence');
}
// A NOT_IN_RANGE transfer attempt can mean a normal walk, a terminal
// path failure, or temporarily blocked movement. Preserve the distance
// histogram and the move return codes separately, never as delivery proof.
{
  const make=(tick,changes={})=>{
    const event=sample(tick);
    event.x.haulers={live:3,readyByGuardRule:2,zeroEnergy:1,
      energyPositive:2,collectingEmpty:1,collectingPartialBelowThreshold:0};
    event.x.decisions={guardChecks:2,guardSelected:1,uniqueGuardHaulers:1};
    event.x.consumerTransfers={attempted:2,accepted:0,notInRange:2,other:0};
    event.x.infrastructureTransfers={attempted:1,accepted:0,notInRange:1,other:0};
    event.x.haulerAcquisitions={attempted:1,accepted:1,notInRange:0,other:0};
    event.x.consumerTravel={
      moveAttempts:2,rangeAtMost5:0,range6to10:1,rangeOver10:1,
      rangeUnknown:0,moveAccepted:1,moveNoPath:1,
      moveInvalidTarget:0,moveTemporarilyBlocked:0,moveOther:0
    };
    Object.assign(event.x,changes);
    return event;
  };
  const healthy=make(125);
  healthy.x.consumers={critical:0};
  healthy.x.reservationCoverage=null;
  const report=summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[make(100),healthy,make(150)]
  }},id);
  assert.equal(report.state,'OBSERVATIONS_AVAILABLE');
  assert.equal(report.observedHaulerActionSamples,3);
  assert.deepEqual(report.haulerActionStates.map(x=>x.consumerTravel.moveAttempts),
    [2,2,2]);
  assert.deepEqual(report.criticalGapActionStates.map(x=>x.tick),[100,150]);
  assert.deepEqual(report.criticalGapActionStates[0].consumerTravel,{
    moveAttempts:2,rangeAtMost5:0,range6to10:1,rangeOver10:1,
    rangeUnknown:0,moveAccepted:1,moveNoPath:1,
    moveInvalidTarget:0,moveTemporarilyBlocked:0,moveOther:0
  });
  assert.equal(report.criticalGapActionStates[0].settledDeliveryProof,false);
  const historical=make(100);
  delete historical.x.consumerTravel;
  const older=summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[historical,make(125)]
  }},id);
  assert.equal(older.state,'OBSERVATIONS_AVAILABLE');
  assert.equal(Object.hasOwn(older.haulerActionStates[0],'consumerTravel'),false,
    'older action schemas must not imply distance zero or movement success');
  const invalid=[
    {moveAttempts:1},
    {moveAttempts:3},
    {rangeOver10:0},
    {rangeUnknown:1},
    {moveAccepted:2},
    {moveNoPath:2},
    {moveOther:-1},
    {range6to10:1.5},
    {moveInvalidTarget:undefined},
    {unexpected:1}
  ];
  for(const changes of invalid) {
    const e=make(100);
    e.x.consumerTravel={...e.x.consumerTravel,...changes};
    const bad=summarizeSupplyJournal({...bot,telemetryJournal:{
      events:[e]
    }},id);
    assert.equal(bad.state,'REVIEW_REQUIRED',JSON.stringify(changes));
    assert.equal(bad.invalidSamples,1);
    assert.equal(bad.observedHaulerActionSamples,0);
    assert.equal(bad.observedHaulerLoadStateSamples,0);
    assert.deepEqual(bad.criticalGapActionStates,[]);
  }
  const mismatch=make(100,{
    consumerTransfers:{attempted:2,accepted:1,notInRange:1,other:0}
  });
  const invalidLink=summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[mismatch]
  }},id);
  assert.equal(invalidLink.state,'REVIEW_REQUIRED');
  assert.equal(invalidLink.observedHaulerActionSamples,0);
  const interrupted=summarizeSupplyJournal({...bot,telemetryJournal:{
    events:[make(100),make(125,{consumerTravel:{...make(125).x.consumerTravel,
      moveAttempts:0}}),make(150)]
  }},id);
  assert.equal(interrupted.invalidSamples,1);
  assert.deepEqual(interrupted.haulerActionStates.map(x=>x.tick),[100,150]);
  assert.deepEqual(interrupted.patterns,[],
    'invalid movement evidence cannot complete an observed three-sample pattern');
}
console.log('World supply evidence tests: PASS');
