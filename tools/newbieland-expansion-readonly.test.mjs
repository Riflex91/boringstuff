import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { inspectNewbielandExpansion, summarizeRoomDefenseObjects, summarizeRetainedTowerEngagements, compareRoomDefenseGetPairs, compareTowerEnergyGetPairs, compareRetainedJournalProgress } from './newbieland-expansion-readonly.mjs';

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


// O17 separate GET-only room-object snapshot. Never infer full Game hostility,
// never assume that a room-object API response shares a tick with bot Memory.
const roomDefense=summarizeRoomDefenseObjects({objects:[
  {type:'spawn',user:'our-id',name:'private-spawn'},
  {type:'tower',user:'our-id',id:'private-tower',energy:120},
  {type:'tower',user:'our-id',id:'private-tower-2',store:{energy:0}},
  {type:'creep',user:'our-id',name:'private-ours',body:[]},
  {type:'creep',user:'other-id',name:'private-armed',
    body:[{type:'attack',hits:100},{type:'move',hits:100}]},
  {type:'creep',user:'another-id',name:'private-unarmed',
    body:[{type:'move',hits:100}]}
]}, {_id:'our-id'});
assert.equal(roomDefense.status,'ROOM_OBJECTS_GET_OBSERVED');
assert.equal(roomDefense.currentGameTickVerified,false);
assert.equal(roomDefense.gameHostilityVerified,false);
assert.equal(roomDefense.crossSnapshotSameTickVerified,false);
assert.equal(roomDefense.ownTowerObjects,2);
assert.equal(roomDefense.ownTowersWithEnergyKnown,2);
assert.equal(roomDefense.towersReadyToAttack,1);
assert.equal(roomDefense.towerEnergySum,120);
assert.equal(roomDefense.ownSpawnObjects,1);
assert.equal(roomDefense.otherOwnerCreeps,2);
assert.equal(roomDefense.otherOwnerCombatOrSupportCreeps,1);
assert.equal(roomDefense.otherOwnerUnarmedCreeps,1);
assert.equal(roomDefense.roomLocalOwnedCreeps,1);
assert.ok(!JSON.stringify(roomDefense).includes('private-'));
const incompleteDefense=summarizeRoomDefenseObjects({objects:[
  {type:'tower',user:'our-id',energy:undefined},
  {type:'creep',user:'other-id',body:[{type:'attack',hits:'100'}]},
  {type:'creep',body:[]}
]}, {_id:'our-id'});
assert.equal(incompleteDefense.towersReadyToAttack,null);
assert.equal(incompleteDefense.towerEnergySum,null);
assert.equal(incompleteDefense.otherOwnerCombatOrSupportCreeps,null);
assert.equal(incompleteDefense.unknownOwnerCreeps,1);
assert.equal(summarizeRoomDefenseObjects({objects:[]},null).status,'UNVERIFIED');
assert.equal(summarizeRoomDefenseObjects({objects:Array(2501).fill({})},
  {_id:'our-id'}).status,'UNVERIFIED');


// The journal may have silently dropped earlier events. A retained WARN is a
// witnessed engagement path only, never proof of tower hits or room safety.
const towerWarnings={telemetryJournal:{events:[
  {c:'TOWER_ENGAGE',t:2080,x:{room:'E8N1',hostileId:'private-id'}},
  {c:'TOWER_ENGAGE',t:2110,x:{room:'E8N1'}},
  {c:'TOWER_ENGAGE',t:2115,x:{room:'W1N1'}},
  {c:'BOT_HEARTBEAT',t:2125}
]}};
const engagement=summarizeRetainedTowerEngagements(towerWarnings,2125);
assert.equal(engagement.status,'RETAINED_EVENTS_ONLY');
assert.equal(engagement.eventCount,2);
assert.equal(engagement.lastEventTick,2110);
assert.equal(engagement.attackSuccessVerified,false);
assert.equal(engagement.fullWindowCoverageVerified,false);
assert.ok(!JSON.stringify(engagement).includes('private-id'));
assert.equal(summarizeRetainedTowerEngagements({
  telemetryJournal:{events:[]}},2125).eventCount,0);
assert.equal(summarizeRetainedTowerEngagements({
  telemetryJournal:{events:[{c:'TOWER_ENGAGE',t:2126,x:{room:'E8N1'}}]}},2125)
  .status,'UNVERIFIED');
const towerThreat=summarizeRoomDefenseObjects({objects:[
  {type:'tower',user:'our-id',energy:1000,x:5,y:5},
  {type:'tower',user:'our-id',energy:1000,x:10,y:10},
  {type:'creep',user:'other-id',x:6,y:6,body:[
    {type:'attack',hits:100},{type:'heal',hits:100},
    {type:'tough',hits:100},{type:'move',hits:100}
  ]}
]}, {_id:'our-id'});
assert.equal(towerThreat.towerEnergySum,2000);
assert.equal(towerThreat.closestTowerToForeignCreepRange,1);
assert.equal(towerThreat.furthestTowerToForeignCreepRange,4);
assert.deepEqual(towerThreat.otherOwnerActiveParts,{
  attack:1,ranged_attack:0,heal:1,work:0,tough:1
});


// A single non-owner threat may survive due to boosted TOUGH or be wounded.
// Observe only present body/HP fields; omit names, IDs and boost mineral names.
const boostedThreat=summarizeRoomDefenseObjects({objects:[
  {type:'tower',user:'ours',x:1,y:1,energy:1000},
  {type:'creep',user:'other',x:20,y:20,hits:1630,hitsMax:2100,
    name:'private-dangerous-creep',id:'private-creep-id',body:[
      {type:'tough',hits:100,boost:'XGHO2'},
      {type:'tough',hits:0,boost:'GHO2'},
      {type:'attack',hits:100,boost:'XUH2O'},
      {type:'move',hits:100}
    ]}
]}, {_id:'ours'});
assert.equal(boostedThreat.soleForeignCreepHits,1630);
assert.equal(boostedThreat.soleForeignCreepHitsMax,2100);
assert.equal(boostedThreat.soleForeignCreepActiveBoostedToughParts,1);
assert.equal(boostedThreat.soleForeignCreepActiveBoostedNonToughParts,1);
assert.ok(!JSON.stringify(boostedThreat).includes('private-'));
assert.ok(!JSON.stringify(boostedThreat).includes('XGHO2'),
  'do not expose unique opponent details or mineral boost names');
const unknownHits=summarizeRoomDefenseObjects({objects:[
  {type:'creep',user:'other',hits:'100',hitsMax:300,
    body:[{type:'tough',hits:100,boost:77}]}
]}, {_id:'ours'});
assert.equal(unknownHits.soleForeignCreepHits,null);
assert.equal(unknownHits.soleForeignCreepActiveBoostedToughParts,null);
assert.equal(summarizeRoomDefenseObjects({objects:[]},{_id:'ours'})
  .soleForeignCreepHits,null);


const firstCombatGet={objects:[
  {type:'creep',id:'private-hostile-id',user:'other-id',hits:5000,hitsMax:5000}
]};
const sameCombatGet={objects:[
  {type:'creep',id:'private-hostile-id',user:'other-id',hits:4980,hitsMax:5000}
]};
const compared=compareRoomDefenseGetPairs(firstCombatGet,sameCombatGet,
  {_id:'our-id'});
assert.equal(compared.status,'SAME_FOREIGN_CREEP_OBSERVED_TWICE');
assert.equal(compared.hpChange,-20);
assert.equal(compared.healthLossObserved,true);
assert.equal(compared.gameTickProgressVerified,false);
assert.equal(compared.attackIntentOrDamageVerified,false);
assert.ok(!JSON.stringify(compared).includes('private-'));
const fullAgain=compareRoomDefenseGetPairs(
  firstCombatGet,firstCombatGet,{_id:'our-id'});
assert.equal(fullAgain.hpChange,0);
assert.equal(fullAgain.healthLossObserved,false);
const changedForeign={objects:[{type:'creep',
  id:'another-id',user:'other-id',hits:5000,hitsMax:5000}]};
assert.equal(compareRoomDefenseGetPairs(
  firstCombatGet,changedForeign,{_id:'our-id'}).reason,
  'FOREIGN_CREEP_ID_CHANGED');
assert.equal(compareRoomDefenseGetPairs(firstCombatGet,
  {objects:[]},{_id:'our-id'}).status,'UNVERIFIED');
assert.equal(compareRoomDefenseGetPairs(firstCombatGet,
  {objects:[{type:'creep',id:'private-hostile-id',user:'other-id',
    hits:'4980',hitsMax:5000}]},{_id:'our-id'}).reason,
  'FOREIGN_CREEP_HEALTH_UNVERIFIED');
assert.equal(compareRoomDefenseGetPairs(firstCombatGet,sameCombatGet,
  null).status,'UNVERIFIED');
const underscoreId={objects:[{
  type:'creep',_id:'private-hidden-creep',user:'other-id',
  hits:5000,hitsMax:5000
}]};
assert.equal(compareRoomDefenseGetPairs(underscoreId,
  structuredClone(underscoreId),{_id:'our-id'}).status,
  'SAME_FOREIGN_CREEP_OBSERVED_TWICE',
  'Screeps room-objects payload may expose _id instead of id');
assert.ok(!JSON.stringify(compareRoomDefenseGetPairs(underscoreId,
  underscoreId,{_id:'our-id'})).includes('private-'));



const towerFirst={objects:[
  {type:'tower',user:'our-id',_id:'secret-tower-1',energy:1000},
  {type:'tower',user:'our-id',id:'secret-tower-2',store:{energy:700}},
  {type:'tower',user:'another-user',id:'enemy-tower',energy:20}
]};
const towerSecond={objects:[
  {type:'tower',user:'our-id',_id:'secret-tower-1',energy:980},
  {type:'tower',user:'our-id',id:'secret-tower-2',store:{energy:750}}
]};
const energyDelta=compareTowerEnergyGetPairs(
  towerFirst,towerSecond,{_id:'our-id'});
assert.equal(energyDelta.status,'SAME_TOWERS_OBSERVED_TWICE');
assert.equal(energyDelta.towerCount,2);
assert.equal(energyDelta.firstEnergySum,1700);
assert.equal(energyDelta.secondEnergySum,1730);
assert.equal(energyDelta.netTowerEnergyChange,30);
assert.equal(energyDelta.consumptionVerified,false);
assert.equal(energyDelta.refillsExcluded,false);
assert.ok(!JSON.stringify(energyDelta).includes('secret-tower-'));
assert.equal(compareTowerEnergyGetPairs(towerFirst,
  {objects:[{type:'tower',user:'our-id',id:'different',energy:900}]},
  {_id:'our-id'}).status,'UNVERIFIED');
assert.equal(compareTowerEnergyGetPairs(towerFirst,towerSecond,
  null).status,'UNVERIFIED');
assert.equal(compareTowerEnergyGetPairs(
  {objects:[{type:'tower',user:'our-id',id:'unique',energy:'1000'}]},
  towerSecond,{_id:'our-id'}).status,'UNVERIFIED');
const progressData=structuredClone(data);
progressData.telemetryJournal.events.push(
  {c:'TOWER_ENGAGE',t:2133,x:{room:'E8N1'}});
const progress=compareRetainedJournalProgress(reply,
  {data:JSON.stringify(progressData)},branch);
assert.equal(progress.status,'RETAINED_JOURNAL_PROGRESS_OBSERVED');
assert.equal(progress.journalTickDelta,8);
assert.equal(progress.gameTickProgressIndependentlyVerified,false);
assert.equal(compareRetainedJournalProgress(
  {data:JSON.stringify(progressData)},reply,branch).status,'UNVERIFIED');

console.log('Newbieland GET-only expansion evidence tests passed');
