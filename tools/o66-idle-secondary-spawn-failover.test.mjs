import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import Module from 'node:module';
import fs from 'node:fs';

const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);

Object.assign(global,{
 WORK:'work',CARRY:'carry',MOVE:'move',TOUGH:'tough',ATTACK:'attack',
 RANGED_ATTACK:'ranged_attack',RESOURCE_ENERGY:'energy',
 BODYPART_COST:{work:100,carry:50,move:50,tough:10,attack:80,
   ranged_attack:150},CREEP_SPAWN_TIME:3,
 OK:0,ERR_NOT_ENOUGH_ENERGY:-6,ERR_BUSY:-4,
 STRUCTURE_WALL:'wall',STRUCTURE_RAMPART:'rampart',
 STRUCTURE_TOWER:'tower',
 FIND_MY_CREEPS:1,FIND_MY_SPAWNS:2,FIND_HOSTILE_CREEPS:3,
 FIND_MY_CONSTRUCTION_SITES:4,FIND_STRUCTURES:5,FIND_SOURCES:6,
 FIND_MY_STRUCTURES:7
});
global.Memory={creeps:{'busy-repairer':{role:'repairer',home:'E8N1'}}};
global.Game={time:9001,creeps:{}};
const stateBuilder=require('../game/room.state.js');
const spawnManager=require('../game/spawn.manager.js');
const attack={body:[{type:'attack',hits:100}]};

function fixture({extraSpawns=1,primaryBusy=true,withHostile=true,
                    energy=800}={}){
 const attempts=[];
 const room={
  name:'E8N1',controller:{my:true,level:3},
  energyAvailable:energy,energyCapacityAvailable:800,
  find(type,options){
   let found=[];
   if(type===FIND_MY_CREEPS)found=[worker];
   if(type===FIND_MY_SPAWNS)found=spawns;
   if(type===FIND_HOSTILE_CREEPS)found=withHostile?[attack]:[];
   if(type===FIND_SOURCES)found=[{id:'source-a'},{id:'source-b'}];
   return options&&options.filter?found.filter(options.filter):found;
  }
 };
 const worker={name:'active-worker',memory:{role:'worker'},
  getActiveBodyparts(part){return part===WORK||part===CARRY?1:0;},
  ticksToLive:900};
 function spawn(name,busy){
  return {
   id:'id-'+name,name,my:true,room,
   spawning:busy?{name:'busy-repairer',remainingTime:45}:null,
   isActive(){return true;},
   spawnCreep(body,creepName,opts){
    attempts.push({spawn:name,body,creepName,opts});
    return OK;
   }
  };
 }
 const first=spawn('Spawn1',primaryBusy);
 const spawns=[first,...Array.from({length:extraSpawns},(_,i)=>
   spawn('Spawn'+(i+2),false))];
 const state=stateBuilder.get(room);
 state.economyMetrics={energyCappedStreak:0,spawnIdleStreak:0};
 state.economyModel={recommendedHarvesterCount:2,
   recommendedHaulerCount:0,sourceContainersReady:2,
   recommendedHarvesterWorkParts:4,harvesterWorkParts:4};
 assert.strictEqual(state.spawn,first,
  'legacy primary spawn identity must remain unchanged');
 assert.equal(state.spawns.length,spawns.length,
  'room.state.get must expose all own spawns');
 return {state,spawns,attempts,room,first};
}

{
 const f=fixture();
 assert.strictEqual(spawnManager._test.selectIdleSpawn(f.state),f.spawns[1]);
 assert.equal(spawnManager.desired(f.state).defender,1);
 assert.equal(spawnManager.spawnOne(f.state),true);
 assert.equal(f.attempts.length,1);
 assert.equal(f.attempts[0].spawn,'Spawn2');
 assert.equal(f.attempts[0].opts.memory.role,'defender',
  'same live defender priority, despite primary busy with repairer');
 assert.equal(f.attempts[0].opts.memory.home,'E8N1');
 assert.equal(f.attempts[0].creepName,'def-E8N1-9001');
 assert.equal(f.first.spawning.name,'busy-repairer',
  'secondary failover may not cancel or edit primary job');
 assert.equal(global.Memory.creeps['busy-repairer'].role,'repairer');
}
{
 const f=fixture({extraSpawns:2});
 f.spawns[1].spawning={name:'ongoing',remainingTime:24};
 assert.equal(spawnManager.spawnOne(f.state),true);
 assert.deepEqual(f.attempts.map(x=>x.spawn),['Spawn3'],
  'third owned spawn must remain available when first two are busy');
}
{
 const f=fixture({extraSpawns:2,primaryBusy:false});
 assert.equal(spawnManager.spawnOne(f.state),true);
 assert.deepEqual(f.attempts.map(x=>x.spawn),['Spawn1'],
  'existing primary-first priority must remain when primary is free');
}
{
 const f=fixture({extraSpawns:0});
 assert.equal(spawnManager.spawnOne(f.state),false);
 assert.equal(f.attempts.length,0,
  'single busy spawn must NOT be force-cancelled or double-spawned');
}
{
 const f=fixture({extraSpawns:1});
 f.spawns[1].spawning={name:'other-job',remainingTime:15};
 assert.equal(spawnManager.spawnOne(f.state),false);
 assert.equal(f.attempts.length,0);
}
{
 const f=fixture();
 f.spawns[1].my=false;
 assert.equal(spawnManager._test.selectIdleSpawn(f.state),null);
 assert.equal(spawnManager.spawnOne(f.state),false,
  'do not use a foreign spawn');
}
{
 const f=fixture();
 f.spawns[1].room={name:'W99N99'};
 assert.equal(spawnManager.spawnOne(f.state),false,
  'do not send spawn action to another room');
}
{
 const f=fixture();
 f.spawns[1].isActive=()=>false;
 assert.equal(spawnManager.spawnOne(f.state),false,
  'inactive secondary spawn must be ignored');
}
{
 const f=fixture();
 f.spawns[1].spawnCreep=null;
 assert.equal(spawnManager.spawnOne(f.state),false,
  'malformed idle candidate must be ignored');
}
{
 const f=fixture({energy:100});
 assert.equal(spawnManager.spawnOne(f.state),false,
  'secondary spawn cannot bypass body cost or energy floor');
 assert.equal(f.attempts.length,0);
}
{
 // During upgrading of direct spawn-manager callers, a standalone
 // legacy state without 'spawns' continues to use its primary spawn.
 const f=fixture({primaryBusy:false});
 delete f.state.spawns;
 assert.equal(spawnManager.spawnOne(f.state),true);
 assert.deepEqual(f.attempts.map(x=>x.spawn),['Spawn1']);
}
{
 const f=fixture();
 f.state.spawns=[];
 assert.equal(spawnManager.spawnOne(f.state),false,
  'an explicitly empty authoritative list must not use stale primary');
}
{
 // No hostile should leave the original normal role prioritization intact.
 const f=fixture({withHostile:false});
 assert.equal(spawnManager.desired(f.state).defender,0);
 assert.equal(spawnManager.spawnOne(f.state),true);
 assert.notEqual(f.attempts[0].opts.memory.role,'defender');
}

const roomManager=fs.readFileSync(new URL('../game/room.manager.js',import.meta.url),'utf8');
assert.match(roomManager,/spawnManager\.spawnOne\(state\)/);
assert.equal((roomManager.match(/spawnManager\.spawnOne\(state\)/g)||[]).length,1,
 'one spawn decision per room per tick; never speculative parallel spending');
const spawnSource=fs.readFileSync(new URL('../game/spawn.manager.js',import.meta.url),'utf8');
assert.doesNotMatch(spawnSource,/\.cancel\s*\(|\.renewCreep\s*\(/,
 'secondary failover is not stalled job mutation or cancellation');
console.log('O66 idle-secondary-owned-spawn failover, preserved defender priority, no forced primary reset, one attempt per room: PASS');
