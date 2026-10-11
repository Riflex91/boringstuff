import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import Module from 'node:module';

const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);

global.WORK='work';
global.CARRY='carry';
global.MOVE='move';
global.TOUGH='tough';
global.ATTACK='attack';
global.BODYPART_COST={work:100,carry:50,move:50,tough:10,attack:80};
global.CREEP_SPAWN_TIME=3;
global.OK=0;
global.ERR_NOT_ENOUGH_ENERGY=-6;
global.ERR_BUSY=-4;
global.STRUCTURE_WALL='wall';
global.STRUCTURE_RAMPART='rampart';
global.FIND_MY_CREEPS=1;
global.FIND_MY_SPAWNS=2;

const spawnManager=require('../game/spawn.manager.js');
function makeColony({harvesterTtl=14,harvesters=2,
  workers=2,upgraders=1,energyAvailable=300,rcl=1,spawning=false,
  emergency=false}={}) {
 global.Memory={creeps:{},bot:{logs:[],logDedupe:{}},rooms:{}};
 global.Game={time:78229000,creeps:{}};
 const population=[];
 for(let i=0;i<harvesters;i++)
   population.push({name:'har-'+i,ticksToLive:i===0?harvesterTtl:1100,
     memory:{role:'harvester'}});
 for(let i=0;i<workers;i++)
   population.push({name:'worker-'+i,ticksToLive:1100,
     memory:{role:'worker'}});
 for(let i=0;i<upgraders;i++)population.push({
   name:'upgrader-'+i,ticksToLive:1100,
   memory:{role:'upgrader'}
 });
 let issued=null;
 const spawn={
   spawning:spawning?{name:'old-harvester'}:null,
   spawnCreep(parts,name,opts){
     issued={parts,name,opts};
     return OK;
   }
 };
 const room={
   name:'W37N11',
   find(type,opts){
     const options=type===FIND_MY_CREEPS?population:
       type===FIND_MY_SPAWNS?[spawn]:[];
     return opts?.filter?options.filter(opts.filter):options;
   }
 };
 const state={
   rcl,room,spawn,sites:[],structures:[],hostileCreeps:[],
   sources:[{id:'source-a'},{id:'source-b'}],
   energyAvailable,energyCapacityAvailable:300,energyStored:0,
   emergency,economyMetrics:{energyCappedStreak:0,spawnIdleStreak:0},
   economyModel:null,byRole:{harvester:harvesters,worker:workers,
     upgrader:upgraders,hauler:0,builder:0,repairer:0}
 };
 return {state,spawned:()=>issued};
}
{
 const {state,spawned}=makeColony();
 assert.equal(spawnManager._test.productivePrespawnHorizon('harvester',state),
   15,'4-body-part RCL1 miner should pre-spawn at 4*3+3 ticks');
 assert.equal(spawnManager._test.countRoleAvailable(state,'harvester'),1);
 assert.equal(spawnManager._test.productivePrespawnShortfall(state,'harvester',2),
   false,'Harvester must not enable low-energy emergency bypass');
 assert.equal(spawnManager.spawnOne(state),true);
 assert.equal(spawned().opts.memory.role,'harvester');
 assert.deepEqual(spawned().parts,['work','work','carry','move']);
 assert.equal(spawned().name,'har-W37N11-78229000');
}
{
 const {state}=makeColony({harvesterTtl:16});
 assert.equal(spawnManager._test.countRoleAvailable(state,'harvester'),2);
 assert.equal(spawnManager.spawnOne(state),false,
   'Healthy, not-about-to-expire harvesters must not trigger overspawn');
}
{
 const {state,spawned}=makeColony({harvesterTtl:14,energyAvailable:299});
 assert.equal(spawnManager.spawnOne(state),false,
   'Optional early miner must not spend a partially filled 300-energy room');
 assert.equal(spawned(),null);
}
{
 const {state,spawned}=makeColony({harvesterTtl:14,upgraders:0});
 assert.equal(spawnManager.spawnOne(state),true);
 assert.equal(spawned().opts.memory.role,'upgrader',
   'Missing base upgrader must outrank optional harvester TTL pre-spawn');
}
{
 const {state,spawned}=makeColony({harvesterTtl:14,workers:1});
 assert.equal(spawnManager.spawnOne(state),true);
 assert.equal(spawned().opts.memory.role,'worker',
   'Missing core worker takes precedence over optional early miner');
}
{
 const {state}=makeColony({harvesterTtl:14,spawning:true});
 assert.equal(spawnManager.spawnOne(state),false,
   'Busy spawn must never receive a second start intent');
}
{
 const {state,spawned}=makeColony({harvesters:1,energyAvailable:300});
 assert.equal(spawnManager.spawnOne(state),true);
 assert.equal(spawned().opts.memory.role,'harvester',
   'An actually missing miner remains critical and must spawn');
}
{
 const {state,spawned}=makeColony({harvesterTtl:1,rcl:2});
 assert.equal(spawnManager._test.productivePrespawnHorizon('harvester',state),0);
 assert.equal(spawnManager.spawnOne(state),false,
   'RCL2+ mining throughput and legacy replacement behavior are unchanged');
 assert.equal(spawned(),null);
}
{
 const {state}=makeColony({harvesterTtl:1,emergency:true});
 assert.equal(spawnManager.spawnOne(state),false,
   'Existing emergency population policy must not pre-spawn optional harvesters');
}
console.log('World RCL1 conservative harvester pre-spawn continuity: PASS');
