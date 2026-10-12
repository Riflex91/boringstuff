import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);
const evidence=require('../game/logistics.matching.evidence.js');

function validState(time) {
  return {
    room:{name:'W37N11'},
    economyModel:{consumerCriticalCount:1,consumerWaitingCount:1,
      consumerFallbackCount:0},
    logisticsMatchingShadow:{
      schemaVersion:1,authority:'SHADOW',
      jobs:[{id:'job',schemaVersion:1,authority:'SHADOW',
        haulerId:'h1',amount:50,mode:'DIRECT_CARRIED',
        supplyRequestId:null,demandRequestId:'req-critical',
        reservationIds:['r1'],predicted:{transportTicks:5},
        requestKind:'EMERGENCY_DELIVER',critical:true}],
      summary:{
        schemaVersion:1,authority:'SHADOW',planTick:time,
        deferred:false,deferReason:null,
        haulerCount:1,matchedHaulerCount:1,candidateCount:1,
        jobCount:1,pairedJobCount:0,directCarriedJobCount:1,
        criticalRequestCount:1,criticalMatchedCount:1,
        unmatchedCriticalCount:0,criticalCandidateRequestCount:1,
        criticalNoCandidateCount:0,criticalCandidateUnmatchedCount:0,
        criticalSlotCapacity:1,reservedAmount:50,
        averageTransportTicks:5
      }
    }
  };
}
const check=evidence._test.validatedMatching;
const sample=validState(1000);
assert.equal(check(sample,1000),true);
assert.equal(check(sample,1001),false,'Stale plan tick cannot be counted');
const failureVariants=[
  x=>{delete x.logisticsMatchingShadow;},
  x=>{x.logisticsMatchingShadow.authority='ACTIVE';},
  x=>{x.logisticsMatchingShadow.schemaVersion=5;},
  x=>{x.logisticsMatchingShadow.summary.authority='ACTIVE';},
  x=>{x.logisticsMatchingShadow.summary.schemaVersion=5;},
  x=>{x.logisticsMatchingShadow.jobs=[];},
  x=>{x.logisticsMatchingShadow.summary.matchedHaulerCount=2;},
  x=>{x.logisticsMatchingShadow.summary.jobCount=2;},
  x=>{x.logisticsMatchingShadow.summary.criticalRequestCount=0;},
  x=>{x.logisticsMatchingShadow.summary.criticalMatchedCount=2;},
  x=>{x.logisticsMatchingShadow.summary.criticalCandidateRequestCount=0;},
  x=>{x.logisticsMatchingShadow.summary.criticalSlotCapacity=2;},
  x=>{x.logisticsMatchingShadow.summary.reservedAmount=Infinity;},
  x=>{x.logisticsMatchingShadow.summary.averageTransportTicks=-1;},
  x=>{x.logisticsMatchingShadow.summary.deferred=1;},
];
for (const [i,breakFixture] of failureVariants.entries()){
  const invalid=structuredClone(sample);
  breakFixture(invalid);
  assert.equal(check(invalid,1000),false,'Malformed matching input case '+i);
}
const deferred=validState(1000);
deferred.logisticsMatchingShadow.jobs=[];
deferred.logisticsMatchingShadow.summary={
  schemaVersion:1,authority:'SHADOW',
  planTick:null,deferred:true,deferReason:'LOW_CPU',
  jobCount:0,haulerCount:0,matchedHaulerCount:0,
  criticalRequestCount:0,criticalMatchedCount:0
};
assert.equal(check(deferred,1000),true);
assert.equal(check({...deferred,logisticsMatchingShadow:{
  ...deferred.logisticsMatchingShadow,jobs:[{id:'ghost'}]
}},1000),false);

{
  const mem={};
  let result;
  for(let t=2000;t<=2039;t++){
    result=evidence.observe(validState(t),mem,{time:t});
  }
  assert.equal(result.current.ticks,40);
  const invalid=evidence.observe({room:{name:'W37N11'}},mem,{time:2040});
  assert.equal(invalid.current,null);
  assert.equal(invalid.completed,null);
  assert.equal(invalid.invalidReason,
    'MISSING_STALE_OR_INCONSISTENT_SHADOW_PLAN');
  for(let t=2041;t<=2139;t++){
    result=evidence.observe(validState(t),mem,{time:t});
    assert.equal(result.completed,null);
  }
  result=evidence.observe(validState(2140),mem,{time:2140});
  assert.equal(result.completed.ticks,100);
  assert.equal(result.completed.startTick,2041);
  assert.equal(result.completed.endTick,2140);
  assert.equal(result.completed.criticalMatchedTicks,100);
}
{
  const mem={};
  let last;
  for(let t=3000;t<=3099;t++){
    const d=structuredClone(deferred);
    last=evidence.observe({...d,room:{name:'W37N11'},
      economyModel:{consumerCriticalCount:0,consumerWaitingCount:0,
        consumerFallbackCount:0}},mem,{time:t});
  }
  assert.equal(last.completed.ticks,100);
  assert.equal(last.completed.deferredRatio,1);
  assert.equal(last.completed.criticalCoverageRatio,null);
  assert.equal(last.completed.criticalCandidateRatio,null);
  assert.equal(last.completed.criticalCandidateCoverageRatio,null);
  assert.equal(last.completed.criticalSlotCoverageRatio,null);
}
console.log('E4 validated matching evidence: missing/stale/contradictory snapshots break 100-tick proof PASS');
