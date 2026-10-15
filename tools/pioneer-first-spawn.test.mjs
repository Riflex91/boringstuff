import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../game/role.pioneer.js',import.meta.url),'utf8');
const mission=()=>({schemaVersion:1,id:'claim-E1N1-E1N2-1000',
  phase:'CLAIMED',parent:'E1N1',target:'E1N2',createdTick:1000,
  confirmedTick:1010,route:['E1N1','E1N2'],
  verifiedSpawnSite:{roomName:'E1N2',x:25,y:25}});
const home={name:'E1N1',controller:{my:true,safeMode:0,safeModeCooldown:0},
  find(){return [];}};
let structures=[],sites=[],hostiles=[],blocking=[],queued=[],built=0,
  harvested=0,moved=[],attemptedSite=0,siteRc=0,buildRc=0,harvestRc=0;
const spawnSite={id:'first-spawn-site',structureType:'spawn',pos:{x:25,y:25}};
const room={name:'E1N2',controller:{my:true},getTerrain(){
  return {get(){return 0;}};},
  lookForAt(kind) {return kind===11?blocking:queued;},
  createConstructionSite(x,y,type) {
    attemptedSite++;
    assert.deepEqual([x,y,type],[25,25,'spawn']);
    return siteRc;
  },
  find(kind,opts) {
    if(kind===1)return hostiles;
    if(kind===2)return [];
    if(kind===3)return structures;
    if(kind===4)return sites;
    throw Error('Unexpected FIND '+kind);
  }
};
const game={time:1025,rooms:{E1N1:home,E1N2:room},
  map:{findExit(){return 9;}},
  cpu:{bucket:9000}
};
const memory={bot:{expansionClaim:mission()}};
const ctx={module:{exports:{}},
  require(name) {if(name==='config')return {PATH_MAX_OPS:200};
    throw Error('Unexpected '+name);},
  Game:game,Memory:memory,
  FIND_HOSTILE_CREEPS:1,FIND_HOSTILE_STRUCTURES:2,
  FIND_MY_SPAWNS:3,FIND_MY_CONSTRUCTION_SITES:4,
  FIND_SOURCES:5,LOOK_STRUCTURES:11,LOOK_CONSTRUCTION_SITES:12,
  TERRAIN_MASK_WALL:1,STRUCTURE_SPAWN:'spawn',RESOURCE_ENERGY:'energy',
  OK:0,ERR_NOT_IN_RANGE:-9
};
vm.runInNewContext(source,ctx);
const role=ctx.module.exports;
const creep={memory:{role:'pioneer',claimMissionId:mission().id},
  room,store:{energy:0,getFreeCapacity(){return 50-this.energy;}},
  pos:{findClosestByRange(){return {id:'exit'};},
    findClosestByPath(type,opts) {
      assert.equal(type,5);
      assert.equal(opts.maxOps,200);
      const energySource={id:'source',energy:300};
      return opts.filter(energySource)?energySource:null;
    }},
  moveTo(target,opts){moved.push({id:target.id||'exit',opts});return 0;},
  harvest(source){harvested++;return harvestRc;},
  build(site){built++;assert.equal(site.id,'first-spawn-site');return buildRc;}
};
function clear(){attemptedSite=0;harvested=0;built=0;moved=[];blocking=[];queued=[];
  structures=[];sites=[];hostiles=[];siteRc=0;buildRc=0;harvestRc=0;
  room.controller.my=true;home.controller.safeMode=0;
  home.controller.safeModeCooldown=0;game.time=1025;
  memory.bot.expansionClaim=mission();creep.room=room;creep.store.energy=0;
  creep.memory.claimMissionId=mission().id;creep.memory.role='pioneer';}
clear();
creep.memory.claimMissionId='wrong';role.run(creep);
assert.equal(attemptedSite,0);
assert.equal(moved.length,0);
clear();delete memory.bot.expansionClaim.id;
creep.memory.claimMissionId=undefined;role.run(creep);
assert.equal(attemptedSite,0,
  'missing both mission identifiers cannot authorize a construction');
clear();memory.bot.expansionClaim.id='bad';
creep.memory.claimMissionId='bad';role.run(creep);
assert.equal(attemptedSite,0,'malformed matching IDs are not authority');
clear();memory.bot.expansionClaim.phase='CLAIMING';
role.run(creep);assert.equal(attemptedSite,0,
  'claim-intent accepted is not confirmed settlement');
clear();room.controller.my=false;role.run(creep);
assert.equal(attemptedSite,0);
assert.equal(built,0);
clear();creep.room=home;role.run(creep);
assert.equal(moved.length,1,'pioneer must follow authorised route');
assert.equal(moved[0].opts.maxRooms,1);
assert.equal(moved[0].opts.maxOps,200);
clear();role.run(creep);
assert.equal(attemptedSite,1,'only confirmed owned colony first spawn site');
assert.equal(built,0,'construction intent not settled this tick');
clear();game.time=1026;role.run(creep);
assert.equal(attemptedSite,0,'site request throttled to each 25 ticks');
clear();blocking=[{id:'wall'}];role.run(creep);
assert.equal(attemptedSite,0,'obstructed site must be refused');
clear();queued=[{id:'other-site'}];role.run(creep);
assert.equal(attemptedSite,0,'competing construction must not be overwritten');
clear();sites=[spawnSite];harvestRc=-9;role.run(creep);
assert.equal(harvested,1);
assert.deepEqual(moved.map(x=>x.id),['source']);
assert.equal(moved[0].opts.maxRooms,1);
clear();sites=[spawnSite];creep.store.energy=50;buildRc=-9;
role.run(creep);assert.equal(built,1);
assert.deepEqual(moved.map(x=>x.id),['first-spawn-site']);
clear();sites=[spawnSite];creep.store.energy=50;
role.run(creep);assert.equal(built,1);
assert.equal(moved.length,0);
clear();structures=[{id:'our-spawn'}];creep.store.energy=50;
role.run(creep);assert.equal(built,0);
assert.equal(attemptedSite,0,'no duplicate spawn when one is confirmed');
clear();hostiles=[{id:'intruder'}];role.run(creep);
assert.equal(attemptedSite,0);
assert.equal(harvested,0);
assert.equal(moved.length,1,'intruder triggers retreat to previous route room');
clear();home.controller.safeMode=100;role.run(creep);
assert.equal(attemptedSite,0);
assert.equal(moved.length,1);
clear();home.controller.safeModeCooldown=50;role.run(creep);
assert.equal(attemptedSite,0);
assert.equal(moved.length,1);
clear();delete game.rooms.E1N1;role.run(creep);
assert.equal(attemptedSite,0,'missing parent vision aborts bootstrap construction');
game.rooms.E1N1=home;
clear();memory.bot.expansionClaim.confirmedTick=game.time-2001;
role.run(creep);assert.equal(attemptedSite,0,
  'expired mission cannot cause permanent uncontrolled build attempts');
// Supervisor changes the mission phase before creep handlers run; survivors
// must retreat instead of silently freezing in a lost or timed-out colony.
clear();memory.bot.expansionClaim.phase='LOST';creep.memory.home='E1N1';
role.run(creep);
assert.equal(moved.length,1,'lost colony must issue real safe return movement');
assert.equal(moved[0].opts.maxRooms,1);
assert.equal(attemptedSite,0);
clear();memory.bot.expansionClaim.phase='BOOTSTRAP_BLOCKED';
creep.memory.home='E1N1';game.time=3200;
role.run(creep);
assert.equal(moved.length,1,
  'expired bootstrap still permits bound survivor return');
assert.equal(built,0);
clear();memory.bot.expansionClaim.phase='LOST';creep.memory.home='WRONG';
role.run(creep);
assert.equal(moved.length,0,'wrong origin may not authorize evacuation');
clear();memory.bot.expansionClaim.phase='LOST';creep.memory.home='E1N1';
memory.bot.expansionClaim.id='claim-E1N1-E2N2-1000';
creep.memory.claimMissionId='claim-E1N1-E2N2-1000';
role.run(creep);
assert.equal(moved.length,0,'forged mismatching mission ID must never move');

// Handoff MUST be proven by a real own Spawn on the originally verified
// tile. The objective is usable workers, not a mission ledger alone.
function established() {
  clear();
  memory.bot.expansionClaim.phase='ESTABLISHED';
  memory.bot.expansionClaim.establishedTick=1040;
  game.time=1050;
  creep.memory.home='E1N1';
  creep.memory.targetRoom='E1N2';
}
established();structures=[{
  id:'first-built-spawn',my:true,
  pos:{x:25,y:25,roomName:'E1N2'}
}];
role.run(creep);
assert.equal(creep.memory.role,'worker',
  'after exact built spawn, surviving pioneer becomes local worker');
assert.equal(creep.memory.home,'E1N2');
assert.equal(creep.memory.claimMissionId,undefined);
assert.equal(creep.memory.targetRoom,undefined);
assert.equal(moved.length,0);
assert.equal(attemptedSite,0);
assert.equal(built,0);
established();structures=[{
  id:'other-spawn',my:true,pos:{x:20,y:20,roomName:'E1N2'}
}];
role.run(creep);
assert.equal(creep.memory.role,'pioneer',
  'some other owned Spawn cannot authorize first-spawn handoff');
established();structures=[{
  id:'foreign-spawn',my:false,pos:{x:25,y:25,roomName:'E1N2'}
}];
role.run(creep);
assert.equal(creep.memory.role,'pioneer',
  'an enemy building cannot authorize role migration');
established();role.run(creep);
assert.equal(attemptedSite,0,
  'a committed established mission never creates a second spawn');
assert.equal(creep.memory.role,'pioneer',
  'lost real spawn visibility must not mint a worker transfer');
established();structures=[{
  id:'first-built-spawn',my:true,
  pos:{x:25,y:25,roomName:'E1N2'}
}];
creep.memory.home='E9N9';role.run(creep);
assert.equal(creep.memory.role,'pioneer',
  'mismatched home may not authorize ownership role mutation');
established();structures=[{
  id:'first-built-spawn',my:true,
  pos:{x:25,y:25,roomName:'E1N2'}
}];delete memory.bot.expansionClaim.establishedTick;
role.run(creep);
assert.equal(creep.memory.role,'pioneer',
  'an unverified establishedTick cannot trigger handoff');
established();structures=[{
  id:'first-built-spawn',my:true,
  pos:{x:25,y:25,roomName:'E1N2'}
}];game.time=1541;
role.run(creep);
assert.equal(creep.memory.role,'pioneer',
  'ancient settlement ledger may not indefinitely reassign creeps');
established();structures=[{
  id:'first-built-spawn',my:true,
  pos:{x:25,y:25,roomName:'E1N2'}
}];creep.room=home;
role.run(creep);
assert.equal(moved.length,1,
  'late-arriving pioneer must still move through its verified corridor');
assert.equal(creep.memory.role,'pioneer',
  'do not change role while outside actual target room');
established();structures=[{
  id:'first-built-spawn',my:true,
  pos:{x:25,y:25,roomName:'E1N2'}
}];memory.bot.expansionClaim.id='claim-E1N1-E9N9-1000';
creep.memory.claimMissionId='claim-E1N1-E9N9-1000';
role.run(creep);
assert.equal(creep.memory.role,'pioneer',
  'forged settlement mission binding cannot transfer a creep');

console.log('I4 mission-bound pioneer first-spawn bootstrap tests PASS');
