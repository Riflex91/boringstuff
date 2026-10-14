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
console.log('I4 mission-bound pioneer first-spawn bootstrap tests PASS');
