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
console.log('World supply evidence tests: PASS');
