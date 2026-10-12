import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);
Object.assign(globalThis,{
  OK:0,ERR_NOT_IN_RANGE:-9,
  STRUCTURE_ROAD:'road',STRUCTURE_SPAWN:'spawn',
  STRUCTURE_EXTENSION:'extension',STRUCTURE_CONTAINER:'container',
  STRUCTURE_TOWER:'tower',STRUCTURE_STORAGE:'storage',STRUCTURE_LINK:'link',
  STRUCTURE_TERMINAL:'terminal',STRUCTURE_RAMPART:'rampart',
  STRUCTURE_WALL:'constructedWall',
  FIND_MY_CREEPS:101,FIND_MY_CONSTRUCTION_SITES:102,FIND_STRUCTURES:103,
  RESOURCE_ENERGY:'energy',
  Game:{time:1000},
  Memory:{bot:{logs:[],logDedupe:{}}}
});
const worker=require('../game/role.worker.js');
const economic=worker._test.economicConstructionSite;
const preferred=worker._test.preferredConstructionSite;
const tunnel={
  id:'wallroad',structureType:STRUCTURE_ROAD,
  progress:32000,progressTotal:45000,
  pos:{x:14,y:13,roomName:'W37N11'}
};
const plain={id:'plain',structureType:STRUCTURE_ROAD,
  progress:0,progressTotal:300};
const swamp={id:'swamp',structureType:STRUCTURE_ROAD,
  progress:0,progressTotal:1500};
const extension={id:'extension',structureType:STRUCTURE_EXTENSION,
  progress:0,progressTotal:3000};
assert.equal(economic(tunnel),false,'Do not continue 45k wall tunnels');
assert.equal(economic(plain),true);
assert.equal(economic(swamp),true,'Existing normal swamp roads are permitted');
assert.equal(economic(extension),true,
  'Critical RCL2 infrastructure always overrides road affordability');
assert.equal(economic({...tunnel,progressTotal:null}),false,
  'Missing cost evidence must fail closed');
assert.equal(economic({...tunnel,progressTotal:NaN}),false);
assert.equal(economic({...tunnel,progressTotal:-1}),false);
assert.equal(economic({...tunnel,progressTotal:1.5}),false);

function makeCreep(sites) {
  const events=[];
  const creep={
    memory:{role:'builder',working:true},
    store:{energy:50,getFreeCapacity:()=>0},
    room:{
      name:'W37N11',controller:{level:2,pos:{x:20,y:20}},
      find(kind,opts) {
        if(kind===FIND_MY_CREEPS){
          return [{memory:{role:'hauler'},spawning:false},
                  {memory:{role:'hauler'},spawning:false}]
            .filter(x=>!opts?.filter||opts.filter(x));
        }
        if(kind===FIND_MY_CONSTRUCTION_SITES)return sites;
        if(kind===FIND_STRUCTURES)return [];
        throw new Error('Unexpected room.find '+kind);
      }
    },
    pos:{findClosestByPath(items) {
      return Array.isArray(items) ? items[0]||null : null;
    }},
    build(site){events.push('build:'+site.id);return OK;},
    upgradeController(){events.push('upgrade');return OK;},
    moveTo(){events.push('move');return OK;}
  };
  return {creep,events};
}
{
  const {creep,events}=makeCreep([tunnel]);
  assert.equal(preferred(creep),null);
  const original=JSON.stringify(tunnel);
  worker.run(creep);
  assert.deepEqual(events,['upgrade'],
    'Builder with ONLY wall tunnels must work on controller instead');
  assert.equal(JSON.stringify(tunnel),original,
    'Never delete or modify already-invested 32k tunnel progress');
}
{
  const {creep,events}=makeCreep([tunnel,swamp,plain]);
  assert.equal(preferred(creep).id,'swamp');
  worker.run(creep);
  assert.deepEqual(events,['build:swamp']);
}
{
  const {creep,events}=makeCreep([tunnel,plain,extension]);
  assert.equal(preferred(creep).id,'extension');
  worker.run(creep);
  assert.deepEqual(events,['build:extension'],
    'Critical structures still outrank affordable road work');
}
console.log('RCL2 early wall-road economics: defer high-cost tunnels; useful work preserved PASS');
