import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { inspectNewbielandExpansion } from './newbieland-expansion-readonly.mjs';

const branch={list:[{branch:'chatgpt',activeWorld:true}]};
const snapshot={c:'STATUS_SNAPSHOT',t:2100,x:{
  rooms:{E8N1:{rcl:6,economyModel:{sourceCount:2,sourceRoutes:[
    {sourceId:'source-A',containerReady:true,assignedHarvesterWorkParts:5,
      dedicatedIncomePerTick:10},
    {sourceId:'source-B',containerReady:true,assignedHarvesterWorkParts:0,
      dedicatedIncomePerTick:0}
  ]}}},
  expansionReadiness:{status:'PLANNING_CANDIDATE',availableClaimSlots:1},
  expansionCandidates:{status:'NEEDS_MORE_INTEL',
    reason:'NO_VERIFIED_LOCAL_CANDIDATES',candidateCount:0,
    visitedRooms:7,unknownOrStaleRooms:5},
  expansionOperation:{phase:'HOLD',reason:'NO_VERIFIED_CANDIDATE'},
  expansionClaimLaunch:{status:'HOLD',
    reason:'SHADOW_OR_BUDGET_GATES_NOT_READY'},
  expansionParentStability:{lastTick:2100,rooms:[{room:'E8N1',
    lastTick:2100,status:'HOLD',
    reason:'PARENT_INFRASTRUCTURE_REFILL_PRESSURE',
    consecutiveSupportTicks:0,requiredTicks:100}]}
}};
const data={deploymentId:'d',telemetryJournal:{
  snapshots:[{c:'STATUS_SNAPSHOT',t:2000,x:{rooms:{E8N1:{rcl:6}}}},snapshot],
  events:[{c:'BOT_HEARTBEAT',t:2125}]
}};
const reply={data:JSON.stringify(data)};
const observed=inspectNewbielandExpansion(reply,branch);
assert.equal(observed.status,'OBSERVED_RETAINED');
assert.equal(observed.readOnly,true);
assert.equal(observed.snapshotTick,2100);
assert.equal(observed.journalLatestTick,2125);
assert.equal(observed.snapshotLagWithinJournalTicks,25);
assert.equal(observed.currentGameTickVerified,false);
assert.equal(observed.expansionEvidence.verifiedCandidates,0);
assert.equal(observed.expansionEvidence.unknownOrStaleRooms,5);
assert.equal(observed.expansionEvidence.parentContinuity.consecutiveSupportTicks,0);
assert.equal(observed.expansionEvidence.sourceModel.zeroAssignedWorkSources,1);
assert.equal(JSON.stringify(observed).includes('source-A'),false,
  'Do not emit source IDs in logs');

const compressed={data:'gz:'+gzipSync(Buffer.from(JSON.stringify(data)))
  .toString('base64')};
assert.deepEqual(inspectNewbielandExpansion(compressed,branch),observed);

for(const branches of [null,{list:[]},{list:[
  {branch:'chatgpt',activeWorld:true},{branch:'other',activeWorld:true}
]},{list:[{branch:'other',activeWorld:true}]}]) {
  const result=inspectNewbielandExpansion(reply,branches);
  assert.equal(result.status,'UNVERIFIED');
  assert.equal(result.reason,'ACTIVE_BRANCH_NOT_VERIFIED');
}
assert.equal(inspectNewbielandExpansion(null,branch).reason,
  'BOT_MEMORY_NOT_VERIFIABLE');
assert.equal(inspectNewbielandExpansion({data:JSON.stringify({
  deploymentId:'d',telemetryJournal:{snapshots:[]}
})},branch).reason,'NO_RETAINED_STATUS_SNAPSHOT');

const missing=structuredClone(data);
missing.telemetryJournal.snapshots.push({
  c:'STATUS_SNAPSHOT',t:2200,x:{rooms:{W1N1:{rcl:4}}}
});
const noFallback=inspectNewbielandExpansion({data:JSON.stringify(missing)},branch);
assert.equal(noFallback.reason,'LATEST_ROOM_STATUS_UNAVAILABLE');
assert.equal(noFallback.snapshotTick,2200);

const malformed=structuredClone(data);
malformed.telemetryJournal.snapshots[1].x.rooms.E8N1.economyModel
  .sourceRoutes[1].assignedHarvesterWorkParts='[depth-limit]';
const unknownSource=inspectNewbielandExpansion({data:JSON.stringify(malformed)},branch);
assert.equal(unknownSource.status,'OBSERVED_RETAINED');
assert.equal(unknownSource.expansionEvidence.sourceModel,null);

console.log('Newbieland GET-only expansion evidence tests passed');
