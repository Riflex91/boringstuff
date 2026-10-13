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
assert.equal(result.patterns[0].reasonCode,'NO_READY_HAULERS');
assert.equal(result.settledDeliveryProof,false);
assert.equal(summarizeSupplyJournal({...bot,telemetryJournal:{events:[sample(100),sample(100)]}},id).state,'REVIEW_REQUIRED');
console.log('World supply evidence tests: PASS');
