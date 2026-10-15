import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
let enabled=true,bucket=10000,homeHostiles=[],targetHostiles=[],
  hostileBuildings=[],realSpawns=[],moved=[],reverseBroken=false;
const home={name:'E1N1',controller:{my:true,safeMode:0,
  safeModeCooldown:0},
  find(which){return which===1?homeHostiles:[];}};
const target={name:'E1N2',controller:{my:true,safeMode:0},
  find(which){
    if(which===1)return targetHostiles;
    if(which===2)return hostileBuildings;
    if(which===3)return realSpawns;
    return [];
  }};
const worker=(name,ttl)=>({
  name,my:true,spawning:false,room:home,ticksToLive:ttl,
  memory:{role:'worker',home:'E1N1'},
  getActiveBodyparts(type){return ['work','carry','move'].includes(type)?1:0;},
  pos:{findClosestByRange(which){assert.equal(which,3);return {id:'own-border'};}},
  moveTo(pos,opts){moved.push({name,pos,opts});return 0;}
});
const a=worker('A',1400),b=worker('B',1200);
const donor={room:home,spawn:{spawning:false},health:{status:'HEALTHY'},
  emergency:false,energyStored:20000,hostileCreeps:[],
  byRole:{defender:1,harvester:2,hauler:2,worker:2},
  creeps:[a,b]};
const victim={room:target,spawn:null,creeps:[],hostileCreeps:[]};
const memory={bot:{ownedSpawnRecovery:{schemaVersion:1,rooms:{
  E1N2:{observedTick:900,lastSpawnId:'verified-id',
    pos:{roomName:'E1N2',x:25,y:25}}
}}}};
const game={time:1000,creeps:{A:a,B:b},
  rooms:{E1N1:home,E1N2:target},
  cpu:{limit:40,get bucket(){return bucket;},getUsed(){return 5;}},
  map:{
    describeExits(room){
      if(reverseBroken)return {3:'E1N3'};
      return room==='E1N1'?{3:'E1N2'}:{7:'E1N1'};
    },
    findExit(from,to){return 3;}
  }};
const sandbox={module:{exports:{}},
  FIND_MY_SPAWNS:3,FIND_HOSTILE_CREEPS:1,
  FIND_HOSTILE_STRUCTURES:2,
  WORK:'work',CARRY:'carry',MOVE:'move',
  require(name){if(name==='config')return {
    get AUTO_SPAWNLESS_WORKER_RESCUE(){return enabled;},
    PATH_MAX_OPS:500
  };throw Error(name);}
};
vm.runInNewContext(fs.readFileSync(new URL(
  '../game/recovery.spawnless.worker.js',import.meta.url),'utf8'),sandbox);
const {dispatch,run}=sandbox.module.exports;
function reset(){
  a.room=home;b.room=home;a.ticksToLive=1400;b.ticksToLive=1200;
  a.memory={role:'worker',home:'E1N1'};
  b.memory={role:'worker',home:'E1N1'};
  game.creeps={A:a,B:b};game.time=1000;bucket=10000;
  home.controller.my=true;home.controller.safeMode=0;
  home.controller.safeModeCooldown=0;
  target.controller.my=true;target.controller.safeMode=0;
  donor.energyStored=20000;donor.health.status='HEALTHY';
  donor.creeps=[a,b];donor.byRole={
    defender:1,harvester:2,hauler:2,worker:2};
  victim.creeps=[];victim.spawn=null;victim.hostileCreeps=[];
  homeHostiles=[];targetHostiles=[];hostileBuildings=[];
  realSpawns=[];moved=[];enabled=true;reverseBroken=false;
  memory.bot.ownedSpawnRecovery.rooms.E1N2={
    observedTick:900,lastSpawnId:'verified-id',
    pos:{roomName:'E1N2',x:25,y:25}
  };
  delete memory.bot.expansionClaim;
  delete memory.bot.counterattackMission;
}
reset();
const first=dispatch([donor,victim],game,memory);
assert.equal(first.status,'ASSIGNED');
assert.equal(first.worker,'A','donate freshest eligible worker');
assert.equal(a.memory.spawnRescueTarget,'E1N2');
assert.equal(a.memory.spawnRescueHome,'E1N1');
assert.equal(b.memory.spawnRescueTarget,undefined,
  'keep a real productive worker in parent colony');
assert.equal(dispatch([donor,victim],game,memory).reason,
  'RESCUER_ALREADY_ASSIGNED','only one live worker assistance');
assert.equal(run(a,game,memory),true,'real donor moves across direct exit');
assert.equal(moved.length,1);
assert.equal(moved[0].pos.id,'own-border');
assert.equal(moved[0].opts.maxRooms,1);
assert.equal(moved[0].opts.maxOps,300);
a.room=target;moved=[];
assert.equal(run(a,game,memory),false,
  'in spawnless target worker runs normal harvest/build role');
assert.equal(a.memory.home,'E1N1');
realSpawns=[{my:true,
  pos:{roomName:'E1N2',x:25,y:25}}];
assert.equal(run(a,game,memory),false);
assert.equal(a.memory.home,'E1N2',
  'actually rebuilt own Spawn permanently rehomes rescue worker');
assert.equal(a.memory.spawnRescueTarget,undefined);
assert.equal(a.memory.spawnRescueAssignedTick,undefined);
reset();dispatch([donor,victim],game,memory);a.room=target;
realSpawns=[{my:true,pos:{roomName:'E1N2',x:24,y:25}}];
assert.equal(run(a,game,memory),true,
  'wrong-position Spawn recalls worker instead of minting colony handoff');
assert.equal(a.memory.home,'E1N1');
assert.equal(moved.length,1);
reset();dispatch([donor,victim],game,memory);a.room=target;
targetHostiles=[{id:'enemy'}];
assert.equal(run(a,game,memory),true);
assert.equal(moved.length,1,'target enemies issue an actual return move');
reset();dispatch([donor,victim],game,memory);a.room=target;
homeHostiles=[{id:'attacker'}];
assert.equal(run(a,game,memory),true,
  'home attack recalls the borrowed worker');
reset();dispatch([donor,victim],game,memory);a.room=target;
enabled=false;
assert.equal(run(a,game,memory),true,
  'disabling feature recalls existing borrowed worker');
a.room=home;moved=[];
assert.equal(run(a,game,memory),false);
assert.equal(a.memory.spawnRescueTarget,undefined);
reset();dispatch([donor,victim],game,memory);a.room=target;
game.time=1901;
assert.equal(run(a,game,memory),true,
  'bounded mission timeout causes real return');
reset();donor.creeps=[a];
assert.equal(dispatch([donor,victim],game,memory).status,'HOLD',
  'never export the last productive worker');
reset();donor.energyStored=5000;
assert.equal(dispatch([donor,victim],game,memory).status,'HOLD');
reset();donor.byRole.defender=0;
assert.equal(dispatch([donor,victim],game,memory).status,'HOLD');
reset();targetHostiles=[{id:'attacker'}];
assert.equal(dispatch([donor,victim],game,memory).status,'HOLD');
reset();memory.bot.ownedSpawnRecovery.rooms.E1N2.observedTick=-1;
assert.equal(dispatch([donor,victim],game,memory).status,'HOLD');
reset();reverseBroken=true;
assert.equal(dispatch([donor,victim],game,memory).status,'HOLD');
reset();memory.bot.expansionClaim={phase:'CLAIMED'};
assert.equal(dispatch([donor,victim],game,memory).reason,
  'ACTIVE_CAMPAIGN_PRIORITY');
reset();game.time=1001;
assert.equal(dispatch([donor,victim],game,memory).reason,
  'RESCUE_CADENCE_OR_CPU');
reset();enabled=false;
assert.equal(dispatch([donor,victim],game,memory).status,'HOLD');
reset();victim.creeps=[{my:true,spawning:false,room:target,
  getActiveBodyparts(which){return ['work','carry'].includes(which)?1:0;}}];
assert.equal(dispatch([donor,victim],game,memory).status,'HOLD',
  'target already has own labor so no extra donor is needed');
const main=fs.readFileSync(new URL('../game/main.js',import.meta.url),'utf8');
const creepManager=fs.readFileSync(new URL(
  '../game/creep.manager.js',import.meta.url),'utf8');
assert.ok(main.includes('spawnlessWorkerRescue.dispatch('));
assert.ok(creepManager.includes('spawnlessWorkerRescue.run(creep,Game,Memory)'));
assert.ok(main.indexOf('ownedSpawnRecovery.observeAndRebuild(')<
  main.indexOf('spawnlessWorkerRescue.dispatch('),
  'R1 first witness must execute before R2 rescue dispatch');
console.log('R2 real adjacent owned-room donor worker transit, rebuild and rollback PASS');
