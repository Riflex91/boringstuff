import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import Module from 'node:module';
const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);
global.FIND_SOURCES=1;
global.FIND_MY_CREEPS=2;
global.CREEP_SPAWN_TIME=3;
const role=require('../game/role.harvester.js');
const ids=new Map();
global.Game={getObjectById:id=>ids.get(id)||null};
function fixture({oldA=900,oldB=900,bodyParts=10,sourceOrder=['A','B']}={}) {
  ids.clear();
  const sources=sourceOrder.map(id=>({id}));
  for(const src of sources)ids.set(src.id,src);
  const creeps=[
    {name:'old-A',memory:{role:'harvester',sourceId:'A'},ticksToLive:oldA},
    {name:'old-B',memory:{role:'harvester',sourceId:'B'},ticksToLive:oldB}
  ];
  const room={find(type){
    if(type===FIND_SOURCES)return sources.slice();
    if(type===FIND_MY_CREEPS)return creeps;
    throw Error('unexpected query');
  }};
  const newcomer={name:'new',memory:{role:'harvester'},room,
    body:bodyParts===null?null:Array.from({length:bodyParts},()=>({type:'work'}))};
  creeps.push(newcomer);
  return {sources,creeps,newcomer};
}
{
  const f=fixture({oldA:900,oldB:24});
  assert.equal(role._test.replacementHorizon(f.newcomer),33);
  assert.equal(role._test.chooseSource(f.newcomer).id,'B',
    'replacement miner must cover source whose existing miner expires first');
  assert.equal(f.newcomer.memory.sourceId,'B');
  assert.equal(f.creeps[0].memory.sourceId,'A');
  assert.equal(f.creeps[1].memory.sourceId,'B');
}
{
  const f=fixture({oldA:20,oldB:900});
  assert.equal(role._test.chooseSource(f.newcomer).id,'A',
    'opposite retiring source must also win');
}
{
  const f=fixture({oldA:34,oldB:900,sourceOrder:['B','A']});
  assert.equal(role._test.chooseSource(f.newcomer).id,'B',
    'outside measured TTL horizon, ordinary stable ordering is unchanged');
}
{
  const f=fixture({oldA:20,oldB:900,bodyParts:null,sourceOrder:['B','A']});
  assert.equal(role._test.replacementHorizon(f.newcomer),0);
  assert.equal(role._test.chooseSource(f.newcomer).id,'B',
    'missing body evidence must use previous balancing, not inferred TTL');
}
{
  const f=fixture({oldA:20,oldB:21});
  assert.equal(role._test.chooseSource(f.newcomer).id,'A',
    'two retiring miners tie and retain deterministic original policy');
}
{
  const f=fixture({oldA:23,oldB:900});
  f.newcomer.memory.sourceId='B';
  assert.equal(role._test.chooseSource(f.newcomer).id,'B',
    'existing source assignment is never changed by dynamic future counts');
}
{
  const f=fixture({oldA:15,oldB:900});
  f.creeps[0].ticksToLive='15';
  assert.equal(role._test.chooseSource(f.newcomer).id,'A',
    'invalid TTL cannot be treated as evidence of imminent expiration');
  // This ties at one each and selects room.find original A.
}
{
  const f=fixture({oldA:900,oldB:900,sourceOrder:['A','B']});
  f.creeps[0].memory.sourceId='B';
  assert.equal(role._test.chooseSource(f.newcomer).id,'A',
    'sources with no currently assigned miners still outrank both occupied');
}
console.log('E13 bounded expiry-aware harvester source selection PASS');
