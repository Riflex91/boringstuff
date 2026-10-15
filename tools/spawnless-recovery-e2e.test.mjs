import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const clock={time:975},moved=[],sites=[];
const oldSpawn={my:true,id:'old-verified-spawn',pos:{
  roomName:'E1N2',x:25,y:25}};
const newSpawn={my:true,id:'rebuilt-spawn',pos:{
  roomName:'E1N2',x:25,y:25}};
let rebuilt=false;
let victimSpawns=[oldSpawn];
const donorRoom={name:'E1N1',
  controller:{my:true,level:6,safeMode:0,safeModeCooldown:0},
  find(which){return [];},
  lookForAt(){return [];},
  getTerrain(){return {get(){return 0;}};},
  createConstructionSite(){throw Error('donor may not create rescue site');}};
const victimRoom={name:'E1N2',
  controller:{my:true,level:4,safeMode:0},
  find(which){
    if(which===4)return victimSpawns;
    if(which===3)return sites;
    return [];
  },
  lookForAt(which){return which===7?sites:[];},
  getTerrain(){return {get(){return 0;}};},
  createConstructionSite(x,y,type){
    assert.deepEqual([x,y,type],[25,25,'spawn']);
    sites.push({structureType:'spawn',
      pos:{roomName:'E1N2',x,y}});
    return 0;
  }};
const worker=name=>({
  my:true,name,spawning:false,
  memory:{role:'worker',home:'E1N1'},
  room:donorRoom,ticksToLive:1400,
  getActiveBodyparts(type){return ['work','carry','move'].includes(type)?1:0;},
  pos:{findClosestByRange(){return {id:'border'};}},
  moveTo(pos,opts){moved.push({pos,opts});return 0;}
});
const rescuer=worker('rescuer'),reserve=worker('reserve');
const victim={room:victimRoom,spawn:oldSpawn,
  creeps:[],hostileCreeps:[]};
const donor={room:donorRoom,spawn:{my:true,spawning:false,
  id:'donor-spawn',pos:{roomName:'E1N1',x:25,y:25}},
  creeps:[rescuer,reserve],hostileCreeps:[],energyStored:20000,
  emergency:false,health:{status:'HEALTHY'},
  byRole:{worker:2,defender:1,harvester:2,hauler:2}};
const memory={bot:{}};
const game={get time(){return clock.time;},rooms:{
  E1N1:donorRoom,E1N2:victimRoom},
  creeps:{rescuer,reserve},constructionSites:{},
  cpu:{bucket:10000,limit:50,getUsed(){return 5;}},
  map:{
    describeExits(name){return name==='E1N1'?
      {3:'E1N2'}:{7:'E1N1'};},
    findExit(){return 3;}
  }};
const constants={
  WORK:'work',CARRY:'carry',MOVE:'move',OK:0,
  FIND_MY_SPAWNS:4,FIND_MY_CONSTRUCTION_SITES:3,
  FIND_HOSTILE_CREEPS:1,FIND_HOSTILE_STRUCTURES:2,
  LOOK_STRUCTURES:6,LOOK_CONSTRUCTION_SITES:7,
  STRUCTURE_SPAWN:'spawn',TERRAIN_MASK_WALL:1,
  CONTROLLER_STRUCTURES:{spawn:{1:1,2:1,3:1,4:1,5:1,6:1}}
};
function load(name){
  const context={
    ...constants,module:{exports:{}},
    require(spec){
      if(spec==='config')return {
        AUTO_SPAWNLESS_WORKER_RESCUE:true,PATH_MAX_OPS:300
      };
      throw Error('Unexpected module '+spec);
    }
  };
  vm.runInNewContext(fs.readFileSync(new URL(name,import.meta.url),'utf8'),context);
  return context.module.exports;
}
const r1=load('../game/recovery.owned.spawn.js');
const r2=load('../game/recovery.spawnless.worker.js');
const states=[donor,victim];

// Phase 1: store the actually observed OWN Spawn, no intention or invented
// tile, before any colony damage. This is required for later R2 authority.
assert.equal(r1.observeAndRebuild(states,game,memory).siteIntentAccepted,false);
assert.equal(memory.bot.ownedSpawnRecovery.rooms.E1N2.lastSpawnId,
  'old-verified-spawn');

// Phase 2: simulate exact physical loss of that Spawn and all workers.
clock.time=1000;victimSpawns=[];victim.spawn=null;
assert.equal(r1.observeAndRebuild(states,game,memory).reason,
  'LOCAL_WORKER_OR_ROOM_DEFENSE_UNSAFE',
  'R1 alone cannot construct with zero surviving labor');
const deployed=r2.dispatch(states,game,memory);
assert.equal(deployed.status,'ASSIGNED');
assert.equal(deployed.worker,'rescuer');
assert.equal(reserve.memory.spawnRescueTarget,undefined,
  'healthy donor keeps a spare normal worker');
assert.equal(r2.run(rescuer,game,memory),true);
assert.equal(moved.length,1,'real border move issued');

// Phase 3: actual room transit is observed by Game, NOT assumed from the
// earlier move intent. R1 can now create its one exact old Spawn site.
clock.time=1025;rescuer.room=victimRoom;victim.creeps=[rescuer];
assert.equal(r2.run(rescuer,game,memory),false,
  'normal worker handler becomes executable in the target');
const intent=r1.observeAndRebuild(states,game,memory);
assert.equal(intent.status,'SITE_INTENT_ACCEPTED');
assert.equal(sites.length,1);
assert.equal(sites[0].pos.x,25);
assert.equal(memory.bot.ownedSpawnRecovery.rooms.E1N2.lastRebuildIntentTick,1025);
assert.equal(rescuer.memory.home,'E1N1',
  'mere site acceptance cannot permanently transfer worker');

// Phase 4: only AFTER physical own rebuilt Spawn object appears can R1
// confirm completed reconstruction and R2 rehome labor permanently.
clock.time=1100;victimSpawns=[newSpawn];victim.spawn=newSpawn;
const proof=r1.observeAndRebuild(states,game,memory);
assert.equal(proof.status,'REBUILD_CONFIRMED');
assert.equal(proof.oldSpawnId,'old-verified-spawn');
assert.equal(proof.newSpawnId,'rebuilt-spawn');
assert.equal(r2.run(rescuer,game,memory),false);
assert.equal(rescuer.memory.home,'E1N2');
assert.equal(rescuer.memory.spawnRescueTarget,undefined);
assert.equal(r1.observeAndRebuild(states,game,memory).confirmed,undefined,
  'same rebuild must never be counted twice');
console.log('R1/R2 actual witnessed destroyed Spawn → worker movement → site → new Spawn → local worker PASS');
