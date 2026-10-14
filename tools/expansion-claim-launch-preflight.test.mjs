import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(
  new URL('../game/expansion.claim.launch.preflight.js',import.meta.url),
  'utf8');
let pathCalls=0,returnedPath=null;
const ctx={
  module:{exports:{}},
  require(name) {
    if(name==='expansion.parent.stability.shadow')
      return {qualifies:continuity=>continuity?.status==='OBSERVATIONS_AVAILABLE'};
    if(name==='expansion.parent.support.shadow')
      return {assess:state=>({status:state?.supportUnsafe?'HOLD':'ADVISORY_OK'})};
    throw Error('Unexpected import '+name);
  },
  FIND_HOSTILE_CREEPS:1,FIND_HOSTILE_STRUCTURES:2,
  CREEP_CLAIM_LIFE_TIME:600,
  RoomPosition:class {
    constructor(x,y,roomName){this.x=x;this.y=y;this.roomName=roomName;}
  },
  PathFinder:{search(origin,goal,options) {
    pathCalls++;
    assert.equal(options.maxOps,2000,'only bounded path ops allowed');
    assert.equal(options.maxRooms,2,'same planned room route only');
    assert.equal(options.roomCallback('E9N9'),false,
      'unauthorized room may never be crossed');
    assert.equal(options.roomCallback('E1N2'),undefined);
    return returnedPath || {incomplete:false,path:Array.from({length:70},(_,i)=>({
      roomName:i<30?'E1N1':'E1N2',getRangeTo(){return 1;}
    }))};
  }}
};
vm.runInNewContext(source,ctx);
const preflight=ctx.module.exports;
function fixture() {
  const parent={name:'E1N1',controller:{
    my:true,safeMode:0,safeModeCooldown:0},find(){return [];}};
  const destination={name:'E1N2',controller:{
    my:false,owner:null,reservation:null,level:0,
    pos:{x:20,y:20,roomName:'E1N2'}
  },find(){return [];}};
  const spawn={pos:{x:10,y:10,roomName:'E1N1'},spawning:null};
  const state={room:parent,spawn,emergency:false,
    health:{status:'HEALTHY'},energyCapacityAvailable:1000,
    energyAvailable:1000,energyStored:10000};
  const game={time:1000,cpu:{limit:40,bucket:10000,getUsed(){return 4;}},
    gcl:{level:2},rooms:{E1N1:parent,E1N2:destination},creeps:{},
    map:{describeExits(name){return name==='E1N1'?{3:'E1N2'}:{};}}};
  const readiness={authority:'SHADOW',claimActionEnabled:false,
    status:'PLANNING_CANDIDATE',availableClaimSlots:1};
  const operation={authority:'SHADOW',
    claimActionEnabled:false,spawnActionEnabled:false,
    readyForClaim:false,phase:'SITE_VERIFIED_ADVISORY',
    routeLevel:'ROOM_LEVEL_ONLY',tilePathVerified:true,
    spawnTileVerified:true,parentRoom:'E1N1',candidateRoom:'E1N2',
    routeHops:1,spawnSite:{x:25,y:25,roomName:'E1N2'}};
  const budget={authority:'SHADOW',actionAuthority:'NONE',
    claimActionEnabled:false,spawnActionEnabled:false,
    readyForClaim:false,status:'COST_ESTIMATE_ONLY',
    totalCrewEnergy:1200,parentReserveFloor:3150};
  const continuity={status:'OBSERVATIONS_AVAILABLE'};
  const memory={bot:{expansionOperationShadow:{
    schemaVersion:1,phase:'SITE_VERIFIED_ADVISORY',
    parentRoom:'E1N1',candidateRoom:'E1N2',
    routeRooms:['E1N2'],siteVerifiedTick:1000,
    verifiedSite:{x:25,y:25,roomName:'E1N2'}
  }}};
  return {readiness,operation,budget,continuity,
    states:[state],game,memory};
}
function run(f){return preflight.audit(f.readiness,f.operation,f.budget,
  f.continuity,f.states,f.game,f.memory);}
let f=fixture();
const snapshot=JSON.stringify(f);
const first=run(f);
assert.equal(first.status,'REVIEW_CANDIDATE');
assert.equal(first.readyForAutonomousLaunch,false,
  'even perfect proof cannot itself authorize an executable claim');
assert.equal(first.claimActionEnabled,false);
assert.equal(first.spawnActionEnabled,false);
assert.equal(first.actionAuthority,'NONE');
assert.deepEqual(Array.from(first.route),['E1N1','E1N2']);
assert.equal(first.measuredPathSteps,70);
assert.equal(first.remainingClaimerTicks,524);
assert.equal(pathCalls,1);
assert.equal(JSON.stringify(f),snapshot,'audit must never alter gameplay state');
function blocked(expected,change) {
  returnedPath=null;
  const x=fixture();change(x);
  const out=run(x);
  assert.equal(out.status,'HOLD',expected);
  assert.equal(out.reason,expected);
  assert.equal(out.spawnActionEnabled,false);
  assert.equal(out.claimActionEnabled,false);
}
blocked('SHADOW_OR_BUDGET_GATES_NOT_READY',f=>{
  f.budget.status='HOLD';});
blocked('SHADOW_OR_BUDGET_GATES_NOT_READY',f=>{
  f.operation.claimActionEnabled=true;});
blocked('ROUTE_OR_SITE_WITNESS_STALE',f=>{
  f.memory.bot.expansionOperationShadow.siteVerifiedTick=974;});
blocked('ROUTE_OR_CREW_BUDGET_INCONSISTENT',f=>{
  f.operation.spawnSite.x=24;});
blocked('PARENT_DEFENSE_OR_CONTINUITY_UNSAFE',f=>{
  f.states[0].room.controller.safeMode=70;});
blocked('PARENT_DEFENSE_OR_CONTINUITY_UNSAFE',f=>{
  f.states[0].room.controller.safeModeCooldown=400;});
blocked('PARENT_DEFENSE_OR_CONTINUITY_UNSAFE',f=>{
  f.states[0].emergency=true;});
blocked('PARENT_DEFENSE_OR_CONTINUITY_UNSAFE',f=>{
  f.continuity.status='STALE';});
blocked('CLAIM_PREFLIGHT_CPU_DEFERRED',f=>{
  f.game.cpu.bucket=2000;});
blocked('CLAIM_PREFLIGHT_CPU_DEFERRED',f=>{
  f.game.time=1001;});
blocked('GCL_OR_EXISTING_CLAIMER_COMMITMENT',f=>{
  f.game.gcl.level=1;});
blocked('GCL_OR_EXISTING_CLAIMER_COMMITMENT',f=>{
  f.game.creeps.other={memory:{role:'claimer'}};});
blocked('CLAIM_MISSION_OR_ABORT_BACKOFF',f=>{
  f.memory.bot.expansionClaim={phase:'CLAIMING'};});
blocked('CLAIM_MISSION_OR_ABORT_BACKOFF',f=>{
  f.memory.bot.expansionClaim={phase:'ABORTED',abortTick:700};});
blocked('HOME_RESERVE_OR_SPAWN_ENERGY_LOW',f=>{
  f.states[0].energyStored=3500;});
blocked('HOME_RESERVE_OR_SPAWN_ENERGY_LOW',f=>{
  f.states[0].energyAvailable=400;});
blocked('NEUTRAL_TARGET_VISION_UNVERIFIED',f=>{
  f.game.rooms.E1N2.controller.owner={username:'rival'};});
blocked('NEUTRAL_TARGET_VISION_UNVERIFIED',f=>{
  f.game.rooms.E1N2.controller.reservation={username:'rival'};});
blocked('ROUTE_VISION_OR_DEFENSE_UNSAFE',f=>{
  f.game.rooms.E1N2.find=()=>[{id:'hostile'}];});
blocked('NEUTRAL_TARGET_VISION_UNVERIFIED',f=>{
  delete f.game.rooms.E1N2;});
blocked('ROOM_ROUTE_NOT_ADJACENT',f=>{
  f.game.map.describeExits=()=>({1:'E3N3'});});
blocked('CLAIMER_ROUTE_NOT_WALKABLE',f=>{
  returnedPath={incomplete:true,path:[{
    roomName:'E1N2',getRangeTo(){return 1;}
  }]};
});
blocked('CLAIMER_TTL_OR_PATH_TOO_LONG',f=>{
  returnedPath={incomplete:false,path:Array.from({length:301},()=>({
    roomName:'E1N2',getRangeTo(){return 1;}
  }))};
});
returnedPath=null;
const srcText=source;
for(const intent of ['.spawnCreep(','.claimController(','.moveTo(',
  '.attack(','.createConstructionSite('])
  assert.equal(srcText.includes(intent),false,
    'read-only preflight may never issue actual game intents '+intent);
console.log('I4 claimer route, TTL, parent defense and launch audit PASS');
