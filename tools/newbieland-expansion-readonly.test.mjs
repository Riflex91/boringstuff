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


// Exact retained journal tick is an *age anchor*, never current server time.
// Enumerate only home-reachable, bounded 3-hop frontier rooms, not arbitrary
// Memory records. Missing/old records must remain named and unverifiable.
const frontierData=structuredClone(data);
frontierData.worldIntel={schemaVersion:1,rooms:{
  E8N1:{schemaVersion:1,roomName:'E8N1',
    observation:{lastSeenTick:2100,confidence:1,source:'visible-room'},
    classification:{roomStatus:'normal'},
    controller:{my:true},
    threat:{hostileCreeps:0},
    topology:{exits:[{roomName:'E7N1'},{roomName:'E8N2'},
      {roomName:'E9N1'}]},
    resources:{sources:[{id:'private-source-id'}]}},
  E8N2:{schemaVersion:1,roomName:'E8N2',
    observation:{lastSeenTick:1000,confidence:1,source:'scout'},
    classification:{roomStatus:'normal'}},
  E9N1:{schemaVersion:1,roomName:'E9N1',
    observation:{lastSeenTick:2110,confidence:1,source:'scout'},
    classification:{roomStatus:'normal'},
    controller:{my:false,owner:null,reservationOwner:null},
    threat:{hostileCreeps:0},
    topology:{exits:[{roomName:'E8N1'},{roomName:'E9N2'}]}}
}};
const frontierResult=inspectNewbielandExpansion(
  {data:JSON.stringify(frontierData)},branch);
const frontier=frontierResult.retainedIntelFrontier;
assert.equal(frontier.status,'OBSERVED_RETAINED');
assert.equal(frontier.journalTick,2125);
assert.equal(frontier.currentGameTickVerified,false);
assert.equal(frontier.routeVerified,false);
assert.deepEqual(frontier.missingOrUnverifiedRooms,
  ['E7N1','E8N2','E9N2']);
assert.equal(frontier.rooms.find(r=>r.room==='E7N1').status,
  'MISSING_RECORD');
assert.equal(frontier.rooms.find(r=>r.room==='E8N2').status,
  'STALE_OVER_500_TICKS');
assert.equal(frontier.rooms.find(r=>r.room==='E9N1')
  .routeFreshAtJournalTick,true);
assert.equal(JSON.stringify(frontier).includes('private-source-id'),false);
const badTopo=structuredClone(frontierData);
badTopo.worldIntel.rooms.E8N1.topology.exits=[{roomName:'invalid-name'}];
assert.equal(inspectNewbielandExpansion(
  {data:JSON.stringify(badTopo)},branch).retainedIntelFrontier.reason,
  'FRONTIER_TOPOLOGY_INVALID');
const unknownIntel=inspectNewbielandExpansion(reply,branch);
assert.equal(unknownIntel.retainedIntelFrontier.reason,
  'WORLD_INTEL_UNAVAILABLE');


const blockedParentData=structuredClone(frontierData);
blockedParentData.telemetryJournal.snapshots[1].x.expansionReadiness={
  status:'HOLD',availableClaimSlots:1,
  reasons:['NO_HEALTHY_SUPPORTING_PARENT']
};
Object.assign(blockedParentData.telemetryJournal.snapshots[1].x.rooms.E8N1,{
  health:{status:'DEGRADED',overallScore:62,
    reasons:['HAULING_DEFICIT','CONSUMER_FALLBACK_ACTIVE']},
  hostiles:0,energyAvailable:450,energyCapacity:1050,
  energyStored:7000,safeModeRemainingTicks:0,
  safeModeCooldownRemainingTicks:0
});
blockedParentData.telemetryJournal.snapshots[1].x.rooms.E8N1
  .economyModel.haulerCarryDeficit=2;
const blockerResult=inspectNewbielandExpansion(
  {data:JSON.stringify(blockedParentData)},branch);
assert.deepEqual(blockerResult.parentBlockerEvidence.readinessReasons,
  ['NO_HEALTHY_SUPPORTING_PARENT']);
assert.deepEqual(blockerResult.parentBlockerEvidence.parentHealthReasons,
  ['HAULING_DEFICIT','CONSUMER_FALLBACK_ACTIVE']);
assert.equal(blockerResult.parentBlockerEvidence.parentHealthScore,62);
assert.equal(blockerResult.parentBlockerEvidence.modeledHaulerCarryDeficit,2);

const surplusParent=structuredClone(blockedParentData);
surplusParent.telemetryJournal.snapshots[1].x.rooms.E8N1.economyModel
  .haulerCarryDeficit=-4;
assert.equal(inspectNewbielandExpansion({
  data:JSON.stringify(surplusParent)},branch)
  .parentBlockerEvidence.modeledHaulerCarryDeficit,-4,
  'negative modeled deficit is actual surplus, not missing evidence');

assert.equal(blockerResult.parentBlockerEvidence.currentGameTickVerified,false);
assert.equal(blockerResult.parentBlockerEvidence.infrastructureEnergyAvailable,450);
const hostileFrontier=structuredClone(blockedParentData);
hostileFrontier.worldIntel.rooms.E8N1.threat.hostileCreeps=1;
const hostileResult=inspectNewbielandExpansion(
  {data:JSON.stringify(hostileFrontier)},branch).retainedIntelFrontier;
assert.deepEqual(hostileResult.traversalBlockers,[
  {room:'E8N1',reason:'HOSTILES_AT_RETAINED_OBSERVATION'}
]);
assert.equal(hostileResult.frontierCoverageVerified,false);
assert.equal(hostileResult.visitedFrontierRooms,1);
const noExits=structuredClone(blockedParentData);
noExits.worldIntel.rooms.E8N1.topology.exits=[];
const noExitsResult=inspectNewbielandExpansion(
  {data:JSON.stringify(noExits)},branch).retainedIntelFrontier;
assert.deepEqual(noExitsResult.traversalBlockers,[
  {room:'E8N1',reason:'NO_RECORDED_EXITS'}
]);
assert.equal(noExitsResult.frontierCoverageVerified,false);
assert.equal(frontierResult.retainedIntelFrontier.frontierCoverageVerified,true);
const corruptReasons=structuredClone(blockedParentData);
corruptReasons.telemetryJournal.snapshots[1].x.rooms.E8N1.health
  .reasons=['[depth-limit]'];
const corruptResult=inspectNewbielandExpansion(
  {data:JSON.stringify(corruptReasons)},branch);
assert.equal(corruptResult.parentBlockerEvidence.parentHealthReasons,null);

console.log('Newbieland GET-only expansion evidence tests passed');
