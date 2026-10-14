import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL(
  '../game/expansion.claim.launch.executor.js',import.meta.url),'utf8');
let enabled=false,approved=true,issued=[],spawnRc=0,throwSpawn=false;
const ctx={
  module:{exports:{}}, MOVE:'move',CLAIM:'claim',OK:0,
  BODYPART_COST:{move:50,claim:600},
  FIND_HOSTILE_CREEPS:1,
  require(name){
    if(name==='config')return {get AUTO_EXPANSION_CLAIM(){return enabled;}};
    if(name==='expansion.claim.launch.preflight')return {
      audit:()=>approved?{
        status:'REVIEW_CANDIDATE',actionAuthority:'NONE',
        readyForAutonomousLaunch:false,claimActionEnabled:false,
        spawnActionEnabled:false,
        parentRoom:'E1N1',candidateRoom:'E1N2',
        measuredPathSteps:110,route:['E1N1','E1N2']
      }:{status:'HOLD',reason:'PRECHECK_UNVERIFIED'}
    };
    throw Error('Unexpected '+name);
  }
};
vm.runInNewContext(source,ctx);
const start=ctx.module.exports.start;
function params(){
  const spawn={spawning:null,spawnCreep(...args) {
    issued.push(args);if(throwSpawn)throw Error('offline spawn');
    return spawnRc;
  }};
  return {
    readiness:{},operation:{spawnSite:{x:25,y:25,roomName:'E1N2'}},
    budget:{totalCrewEnergy:1200,parentReserveFloor:3150},
    continuity:{},
    states:[{room:{name:'E1N1'},spawn,energyCapacityAvailable:1000,
      energyAvailable:1000,energyStored:8000}],
    game:{time:1000},memory:{bot:{}}
  };
}
function execute(p) {return start(p.readiness,p.operation,p.budget,
  p.continuity,p.states,p.game,p.memory);}
let p=params(),original=JSON.stringify(p.memory);
let out=execute(p);
assert.equal(out.reason,'AUTO_EXPANSION_CLAIM_DISABLED');
assert.equal(issued.length,0);
assert.equal(JSON.stringify(p.memory),original,'flag-off must not write missions');
enabled=true;approved=false;
out=execute(p);
assert.equal(out.reason,'PRECHECK_UNVERIFIED');
assert.equal(issued.length,0);
approved=true;spawnRc=-6;
out=execute(p);
assert.equal(out.status,'SPAWN_REJECTED');
assert.equal(out.spawnIntentAccepted,false);
assert.equal(issued.length,1);
assert.equal(JSON.stringify(p.memory),original,
  'rejected spawn cannot create phantom claim mission');
issued=[];
throwSpawn=true;
out=execute(p);
assert.equal(out.reason,'CLAIMER_SPAWN_EXCEPTION');
assert.equal(issued.length,1);
assert.equal(JSON.stringify(p.memory),original);
throwSpawn=false;spawnRc=0;issued=[];
out=execute(p);
assert.equal(out.status,'SPAWN_INTENT_ACCEPTED');
assert.equal(out.spawnIntentAccepted,true);
assert.equal(issued.length,1);
assert.deepEqual(Array.from(issued[0][0]),['move','claim']);
assert.equal(issued[0][1],'clm-E1N1-1000');
assert.equal(issued[0][2].memory.role,'claimer');
assert.equal(issued[0][2].memory.home,'E1N1');
assert.equal(issued[0][2].memory.claimMissionId,out.missionId);
const m=p.memory.bot.expansionClaim;
assert.equal(m.id,out.missionId);
assert.equal(m.phase,'CLAIMING');
assert.equal(m.parent,'E1N1');
assert.equal(m.target,'E1N2');
assert.deepEqual(Array.from(m.route),['E1N1','E1N2']);
assert.equal(m.createdTick,1000);
assert.equal(m.verifiedSpawnSite.roomName,'E1N2');
assert.equal(m.estimatedClaimTravelTicks,110);
issued=[];out=execute(p);
assert.equal(out.reason,'ACTIVE_EXPANSION_COMMITMENT');
assert.equal(issued.length,0,'repeated same-tick launch cannot spawn a second claimer');
p=params();p.memory.bot.expansionClaim={phase:'CLAIMED'};
out=execute(p);
assert.equal(out.reason,'ACTIVE_EXPANSION_COMMITMENT');
p=params();p.states[0].energyStored=4300;
out=execute(p);
assert.equal(out.reason,'CLAIMER_WOULD_EXHAUST_PARENT_RESERVE');
p=params();p.states[0].spawn.spawning={name:'other'};
out=execute(p);
assert.equal(out.reason,'SPAWN_OR_MISSION_UNVERIFIED');
p=params();p.budget.totalCrewEnergy=20000;
out=execute(p);
assert.equal(out.reason,'CLAIMER_WOULD_EXHAUST_PARENT_RESERVE');
p=params();p.operation.spawnSite=null;
spawnRc=0;issued=[];
out=execute(p);
assert.equal(out.reason,'SPAWN_OR_MISSION_UNVERIFIED',
  'forged preflight cannot authorize missing site geometry');
assert.equal(issued.length,0);
// Long-running autonomous missions must self-recover, rather than holding
// the only GCL/claimer slot indefinitely after a death, cancelled spawn,
// defensive emergency or true confirmed ownership.
const supervise=ctx.module.exports.supervise;
function supervisorFixture() {
  const mission={schemaVersion:1,id:'claim-E1N1-E1N2-1000',
    phase:'CLAIMING',parent:'E1N1',target:'E1N2',
    route:['E1N1','E1N2'],createdTick:1000};
  const home={controller:{my:true,safeMode:0,safeModeCooldown:0},
    find(){return [];}};
  const target={controller:{my:false}};
  const game={time:1001,
    rooms:{E1N1:home,E1N2:target},
    creeps:{cla:{memory:{role:'claimer',claimMissionId:mission.id}}}};
  const memory={bot:{expansionClaim:mission}};
  return {mission,home,target,game,memory};
}
let sup=supervisorFixture();
assert.equal(supervise(sup.game,sup.memory).status,'CLAIMING');
assert.equal(sup.mission.phase,'CLAIMING');
sup.target.controller.my=true;
assert.equal(supervise(sup.game,sup.memory).status,'CLAIMED');
assert.equal(sup.mission.confirmedTick,1001);
assert.equal(sup.mission.phase,'CLAIMED');
sup=supervisorFixture();
sup.game.creeps={};sup.game.time=1020;
assert.equal(supervise(sup.game,sup.memory).status,'CLAIMING',
  'spawn grace protects transient missing creep');
sup.game.time=1021;
let verdict=supervise(sup.game,sup.memory);
assert.equal(verdict.status,'ABORTED');
assert.equal(verdict.reason,'CLAIMER_MISSING_AFTER_SPAWN_GRACE');
assert.equal(sup.mission.abortTick,1021);
sup=supervisorFixture();
sup.home.controller.safeMode=50;
assert.equal(supervise(sup.game,sup.memory).reason,
  'PARENT_DEFENSE_OR_VISION_UNSAFE');
sup=supervisorFixture();
sup.home.controller.safeModeCooldown=100;
assert.equal(supervise(sup.game,sup.memory).reason,
  'PARENT_DEFENSE_OR_VISION_UNSAFE');
sup=supervisorFixture();
sup.home.find=()=>[{id:'armed'}];
assert.equal(supervise(sup.game,sup.memory).reason,'PARENT_UNDER_ATTACK');
sup=supervisorFixture();
sup.game.time=1901;
assert.equal(supervise(sup.game,sup.memory).reason,
  'CLAIMER_MISSION_EXPIRED');
sup=supervisorFixture();
sup.game.time=999;
assert.equal(supervise(sup.game,sup.memory).status,'RUNTIME_UNVERIFIED');
assert.equal(sup.mission.phase,'CLAIMING',
  'invalid time cannot rewrite mission ledger');

console.log('I4 gated single-claimer spawning and mission-commit transaction PASS');
