import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let siteRc=0,siteCalls=[],structures=[],construction=[],enemies=[],
  stored=[],bucket=10000,terrainWall=false;
const ownedRoom={name:'E1N1',
  controller:{my:true,level:4},
  find(which){
    if(which===1)return enemies;
    if(which===2)return [];
    if(which===3)return construction;
    throw Error('find '+which);
  },
  getTerrain(){return {get(){return terrainWall?1:0;}};},
  lookForAt(which){return which===11?structures:stored;},
  createConstructionSite(x,y,type) {
    siteCalls.push({x,y,type});return siteRc;
  }};
const live={name:'Spawn1',id:'owned-id-1',my:true,
  pos:{x:25,y:25,roomName:'E1N1'}};
const labor={my:true,spawning:false,room:ownedRoom,
  getActiveBodyparts(part){return ['work','carry','move'].includes(part)?1:0;}};
const state={room:ownedRoom,spawn:live,creeps:[labor],
  hostileCreeps:[]};
const game={time:1000,constructionSites:{},
  cpu:{get bucket(){return bucket;},
    limit:40,getUsed(){return 4;}}};
const memory={bot:{}};
const sandbox={module:{exports:{}},require(name){
  if(name==='config')return {};
  throw Error('unknown '+name);
},FIND_HOSTILE_CREEPS:1,FIND_HOSTILE_STRUCTURES:2,
FIND_MY_CONSTRUCTION_SITES:3,LOOK_STRUCTURES:11,
LOOK_CONSTRUCTION_SITES:12,
STRUCTURE_SPAWN:'spawn',TERRAIN_MASK_WALL:1,
WORK:'work',CARRY:'carry',MOVE:'move',OK:0,
CONTROLLER_STRUCTURES:{spawn:{1:1,2:1,3:1,4:1}}};
vm.runInNewContext(fs.readFileSync(new URL(
  '../game/recovery.owned.spawn.js',import.meta.url),'utf8'),sandbox);
const execute=()=>sandbox.module.exports.observeAndRebuild(
  [state],game,memory);
function reset(){
  state.spawn=null;state.creeps=[labor];state.hostileCreeps=[];
  game.time=1025;game.constructionSites={};
  ownedRoom.controller.my=true;ownedRoom.controller.level=4;
  siteRc=0;siteCalls=[];structures=[];construction=[];enemies=[];
  stored=[];bucket=10000;terrainWall=false;
}
const seen=execute();
assert.equal(seen.siteIntentAccepted,false,
  'an existing live Spawn never gets duplicated');
assert.equal(memory.bot.ownedSpawnRecovery.rooms.E1N1.lastSpawnId,'owned-id-1');
assert.equal(memory.bot.ownedSpawnRecovery.rooms.E1N1.observedTick,1000);
reset();
const success=execute();
assert.equal(success.status,'SITE_INTENT_ACCEPTED');
assert.equal(success.siteIntentAccepted,true);
assert.equal(success.room,'E1N1');
assert.deepEqual(siteCalls,[{x:25,y:25,type:'spawn'}]);
assert.equal(memory.bot.ownedSpawnRecovery.rooms.E1N1.lastRebuildIntentTick,1025);
const rebuilt={id:'owned-id-2',my:true,
  pos:{x:25,y:25,roomName:'E1N1'}};
state.spawn=rebuilt;game.time=1050;
const physicallyConfirmed=execute();
assert.equal(physicallyConfirmed.status,'REBUILD_CONFIRMED',
  'actual new own Spawn ID at exact original tile proves recovery');
assert.equal(physicallyConfirmed.confirmed,true);
assert.equal(physicallyConfirmed.oldSpawnId,'owned-id-1');
assert.equal(physicallyConfirmed.newSpawnId,'owned-id-2');
assert.equal(memory.bot.ownedSpawnRecovery.rooms.E1N1.lastSpawnId,'owned-id-2');
game.time=1051;
assert.notEqual(execute().status,'REBUILD_CONFIRMED',
  'do not duplicate a real completed rebuild event');
state.spawn=null;
memory.bot.ownedSpawnRecovery.rooms.E1N1={
  observedTick:1000,lastSpawnId:'owned-id-1',
  pos:{roomName:'E1N1',x:25,y:25}
};
state.spawn=rebuilt;game.time=1050;
assert.notEqual(execute().status,'REBUILD_CONFIRMED',
  'a new Spawn without accepted R1 construction intent is not an automated rebuild');
state.spawn=null;
memory.bot.ownedSpawnRecovery.rooms.E1N1={
  observedTick:1000,lastSpawnId:'owned-id-1',
  lastRebuildIntentTick:1025,
  pos:{roomName:'E1N1',x:25,y:25}
};
state.spawn={id:'wrong-spot-new',my:true,
  pos:{x:26,y:25,roomName:'E1N1'}};
assert.notEqual(execute().status,'REBUILD_CONFIRMED',
  'a different tile is not proof the witnessed Spawn was rebuilt');
state.spawn=null;
memory.bot.ownedSpawnRecovery.rooms.E1N1={
  observedTick:1000,lastSpawnId:'owned-id-1',
  pos:{roomName:'E1N1',x:25,y:25}
};

reset();game.time=1026;
assert.equal(execute().reason,'RECOVERY_CADENCE_OR_CPU_DEFERRED');
assert.equal(siteCalls.length,0);
reset();bucket=100;
assert.equal(execute().reason,'RECOVERY_CADENCE_OR_CPU_DEFERRED');
reset();state.creeps=[];
assert.equal(execute().reason,'LOCAL_WORKER_OR_ROOM_DEFENSE_UNSAFE');
reset();state.hostileCreeps=[{id:'armed'}];
assert.equal(execute().reason,'LOCAL_WORKER_OR_ROOM_DEFENSE_UNSAFE');
reset();enemies=[{id:'hostile'}];
assert.equal(execute().reason,'RECOVERY_SITE_OR_THREAT_BLOCKED');
reset();structures=[{id:'tower'}];
assert.equal(execute().reason,'RECOVERY_SITE_OR_THREAT_BLOCKED');
reset();stored=[{id:'occupied'}];
assert.equal(execute().reason,'FORMER_SPAWN_TILE_OCCUPIED');
reset();terrainWall=true;
assert.equal(execute().reason,'RECOVERY_SITE_OR_THREAT_BLOCKED');
reset();construction=[{structureType:'spawn',pos:{
  x:25,y:25,roomName:'E1N1'}}];
assert.equal(execute().reason,'SPAWN_REBUILD_SITE_ALREADY_EXISTS');
reset();game.constructionSites=Object.fromEntries(
  Array.from({length:95},(_,i)=>['s'+i,{}]));
assert.equal(execute().reason,'SITE_LIMIT_RESERVE_EXHAUSTED');
reset();siteRc=-8;
assert.equal(execute().status,'SITE_REJECTED');
assert.equal(siteCalls.length,1);
reset();ownedRoom.controller.my=false;
assert.equal(execute().reason,'NO_VERIFIED_SPAWNLESS_OWNED_COLONY',
  'an enemy or lost room may never receive construction intents');
reset();game.time=25025;
assert.equal(execute().reason,'NO_VERIFIED_SPAWNLESS_OWNED_COLONY',
  'ancient Spawn witness must not be trusted for new construction');
reset();memory.bot.ownedSpawnRecovery.rooms.E1N1.pos.x=99;
assert.equal(execute().reason,'NO_VERIFIED_SPAWNLESS_OWNED_COLONY');
reset();memory.bot.ownedSpawnRecovery.rooms.E1N1.pos.x=25;
memory.bot.ownedSpawnRecovery.rooms.E1N1.lastSpawnId='';
assert.equal(execute().reason,'NO_VERIFIED_SPAWNLESS_OWNED_COLONY');
reset();delete memory.bot.ownedSpawnRecovery;
assert.equal(execute().reason,'NO_VERIFIED_SPAWNLESS_OWNED_COLONY',
  'missing history cannot be replaced by invented Spawn coordinates');
assert.equal(siteCalls.length,0);
const main=fs.readFileSync(new URL('../game/main.js',import.meta.url),'utf8');
assert.ok(main.includes('ownedSpawnRecovery.observeAndRebuild('),
  'R1 must be wired into actual critical runtime');
console.log('R1 actual witnessed destroyed Spawn rebuild site / no phantom anchor PASS');
