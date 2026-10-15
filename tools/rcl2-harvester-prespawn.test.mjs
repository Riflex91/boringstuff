import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import Module from 'node:module';

const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);

global.WORK='work';global.CARRY='carry';global.MOVE='move';
global.BODYPART_COST={work:100,carry:50,move:50};
global.CREEP_SPAWN_TIME=3;global.OK=0;
global.ERR_NOT_ENOUGH_ENERGY=-6;global.ERR_BUSY=-4;
global.STRUCTURE_WALL='wall';global.STRUCTURE_RAMPART='rampart';
global.FIND_MY_CREEPS=1;global.FIND_MY_SPAWNS=2;
const manager=require('../game/spawn.manager.js');

function make({ttl=32,harvesters=2,workers=2,upgraders=1,haulers=2,
               ready=2,energy=800,capacity=800,emergency=false,
               spawning=false,enemy=false}={}) {
  global.Memory={creeps:{},bot:{logs:[],logDedupe:{}},rooms:{}};
  global.Game={time:78325000,creeps:{}};
  const creeps=[];
  for(let i=0;i<harvesters;i++)creeps.push({
    name:'miner-'+i,ticksToLive:i===0?ttl:900,memory:{role:'harvester'}
  });
  for(const [role,count] of [['worker',workers],['upgrader',upgraders],
                            ['hauler',haulers]]) {
    for(let i=0;i<count;i++)creeps.push({
      name:role+'-'+i,ticksToLive:900,memory:{role}
    });
  }
  let issued=null;
  const spawn={spawning:spawning?{name:'miner-spawning'}:null,
    spawnCreep(parts,name,opts){issued={parts,name,opts};return OK;}};
  if(spawning)Memory.creeps['miner-spawning']={role:'harvester'};
  const room={name:'W37S79',find(type,opts){
    const rows=type===FIND_MY_CREEPS?creeps:
      type===FIND_MY_SPAWNS?[spawn]:[];
    return opts?.filter?rows.filter(opts.filter):rows;
  }};
  const state={
    rcl:2,room,spawn,sites:[],structures:[],
    hostileCreeps:enemy?[{body:[]}]:[],
    sources:[{id:'s1'},{id:'s2'}],energyAvailable:energy,
    energyCapacityAvailable:capacity,energyStored:1000,
    economyMetrics:{energyCappedStreak:0,spawnIdleStreak:0},
    economyModel:{sourceContainersReady:ready,
      recommendedHarvesterCount:2,recommendedHarvesterWorkParts:8,
      harvesterWorkParts:8,recommendedHaulerCount:2},
    byRole:{harvester:harvesters,worker:workers,
      upgrader:upgraders,hauler:haulers,builder:0},emergency
  };
  return {state,issued:()=>issued,creeps};
}
{
  const x=make();
  assert.equal(manager._test.productivePrespawnHorizon('harvester',x.state),33);
  assert.equal(manager._test.countRoleAvailable(x.state,'harvester'),1);
  assert.equal(manager.spawnOne(x.state),true);
  assert.equal(x.issued()?.opts.memory.role,'harvester');
  assert.equal(x.issued()?.parts.length,10);
  assert.equal(x.issued()?.name,'har-W37S79-78325000');
}
{
  const x=make({ttl:34});
  assert.equal(manager._test.countRoleAvailable(x.state,'harvester'),2);
  assert.equal(manager.spawnOne(x.state),false,
    'healthy miners cannot spawn extra replacements');
}
{
  const x=make({ttl:33});
  assert.equal(manager.spawnOne(x.state),true,
    'exact spawn-time boundary triggers the replacement overlap');
}
{
  const x=make({ttl:32,harvesters:3});
  assert.equal(manager._test.countRoleAvailable(x.state,'harvester'),2);
  assert.equal(manager.spawnOne(x.state),false,
    'one expiring surplus miner does not create a fourth body');
}
for(const options of [
  {ready:1},{emergency:true},{spawning:true}
]) {
  const x=make(options);
  assert.equal(manager.spawnOne(x.state),false,
    'no speculative prespawn outside healthy steady mining');
}
{
  const x=make({energy:700});
  assert.equal(manager.spawnOne(x.state),false,
    'optional replacement never burns partial room energy on weak body');
}
{
  const x=make({workers:1});
  assert.equal(manager.spawnOne(x.state),true);
  assert.equal(x.issued()?.opts.memory.role,'worker',
    'missing core worker precedes optional miner overlap');
}
{
  const x=make({upgraders:0});
  assert.equal(manager.spawnOne(x.state),true);
  assert.equal(x.issued()?.opts.memory.role,'upgrader',
    'controller continuity precedes optional miner overlap');
}
{
  const x=make({haulers:1});
  assert.equal(manager.spawnOne(x.state),true);
  assert.equal(x.issued()?.opts.memory.role,'hauler',
    'missing hauling floor precedes optional miner overlap');
}
{
  const x=make({harvesters:1,energy:800});
  assert.equal(manager.spawnOne(x.state),true);
  assert.equal(x.issued()?.opts.memory.role,'harvester',
    'actually missing miner still uses baseline urgent spawn policy');
}
console.log('RCL2+ container-miner bounded prespawn continuity regressions PASS');
