import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Module,{createRequire} from 'node:module';

const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);

Object.assign(globalThis,{
  OK:0, ERR_FULL:-8, ERR_INVALID_TARGET:-7, ERR_RCL_NOT_ENOUGH:-14,
  STRUCTURE_ROAD:'road', STRUCTURE_RAMPART:'rampart',
  STRUCTURE_EXTENSION:'extension', STRUCTURE_CONTAINER:'container',
  STRUCTURE_TOWER:'tower', TERRAIN_MASK_WALL:1,
  LOOK_STRUCTURES:'structures',LOOK_CONSTRUCTION_SITES:'constructionSites',
  FIND_MY_CONSTRUCTION_SITES:'mySites',
  FIND_CONSTRUCTION_SITES:'constructionSites',
  FIND_STRUCTURES:'structures',
  CONTROLLER_STRUCTURES:{extension:{1:0,2:5},tower:{1:0,2:0}},
  Game:{time:1000},Memory:{bot:{logs:[],logDedupe:{}}}
});
const planner=require('../game/room.planner.js');

function roomFixture({rcl=2,roads=8,existingExtensions=0,
  builtExtensions=0,sourceContainers=0,controllerContainer=false,
  extraRoadProgress=0,roadPathSteps=[],wallTiles=[]}={}) {
  globalThis.Memory={bot:{logs:[],logDedupe:{}}};
  let sites=[],created=[],removed=[];
  let next=0;
  function addSite(type,x,y,progress=0){
    const item={structureType:type,x,y,progress,
      remove(){const idx=sites.indexOf(item);
        if(idx<0)return ERR_INVALID_TARGET;
        sites.splice(idx,1);removed.push(item);return OK;}};
    sites.push(item);
    return item;
  }
  for(let i=0;i<roads;i++)
    addSite(STRUCTURE_ROAD,28+i,10,i===0?extraRoadProgress:i+5);
  for(let i=0;i<existingExtensions;i++)
    addSite(STRUCTURE_EXTENSION,8+2*i,11);
  const structures=[];
  for(let i=0;i<builtExtensions;i++)
    structures.push({structureType:STRUCTURE_EXTENSION,x:8+2*i,y:9});
  const sources=[{x:20,y:20},{x:37,y:37}];
  for(let i=0;i<sourceContainers;i++)
    structures.push({structureType:STRUCTURE_CONTAINER,
      x:sources[i].x+1,y:sources[i].y});
  if(controllerContainer)
    structures.push({structureType:STRUCTURE_CONTAINER,x:26,y:27});
  const within=(list,pos,range,opts)=>list.filter(o=>
    Math.max(Math.abs(o.x-pos.x),Math.abs(o.y-pos.y))<=range)
    .filter(o=>!opts?.filter||opts.filter(o));
  function makePos(x,y){
    const p={x,y,roomName:'W37N11',
      findInRange(kind,range,opts){
        return within(kind===FIND_STRUCTURES?structures:sites,p,range,opts);
      }};
    return p;
  }
  const room={
    name:'W37N11',
    controller:{my:true,pos:makePos(27,27)},
    getTerrain(){return {get:(x,y)=>wallTiles.some(p=>p.x===x&&p.y===y)
      ?TERRAIN_MASK_WALL:0};},
    findPath(){return roadPathSteps;},
    lookForAt(kind,x,y){
      return (kind===LOOK_STRUCTURES?structures:sites).filter(o=>
        o.x===x&&o.y===y);
    },
    find(kind,opts){
      assert.equal(kind,FIND_MY_CONSTRUCTION_SITES);
      return sites.filter(o=>!opts?.filter||opts.filter(o));
    },
    createConstructionSite(x,y,type){
      if(sites.length>=8)return ERR_FULL;
      if(sites.some(o=>o.x===x&&o.y===y)||
        structures.some(o=>o.x===x&&o.y===y))return ERR_INVALID_TARGET;
      created.push({x,y,type});
      addSite(type,x,y);
      return OK;
    }
  };
  const state={
    room,rcl,spawn:{pos:makePos(12,13)},
    sources:sources.map(o=>({pos:makePos(o.x,o.y)})),
    structures
  };
  return {state,sites:()=>sites,created,removed};
}
function count(f,type){return f.sites().filter(x=>x.structureType===type).length;}
{
 const f=roomFixture();
 assert.equal(f.sites().length,8);
 planner.plan(f.state);
 assert.equal(f.removed.length,8,
  'Exactly-full all-road backlog must be cleared for 8 critical RCL2 sites');
 assert.equal(count(f,STRUCTURE_ROAD),0);
 assert.equal(count(f,STRUCTURE_CONTAINER),3);
 assert.equal(count(f,STRUCTURE_EXTENSION),5);
 assert.equal(f.sites().length,8,'Never exceed early RCL2 eight-site cap');
 assert.ok(f.removed.every(x=>x.structureType===STRUCTURE_ROAD));
 planner.plan(f.state);
 assert.equal(f.sites().length,8,'No repeat or duplicate on next tick');
}
{
 const f=roomFixture({roads:6,existingExtensions:2});
 planner.plan(f.state);
 assert.equal(f.removed.length,6,
  'Roads are pruned, existing useful extensions preserved');
 assert.equal(count(f,STRUCTURE_EXTENSION),5);
 assert.equal(count(f,STRUCTURE_CONTAINER),3);
 assert.equal(f.sites().length,8);
 assert.equal(f.removed.some(x=>x.structureType!==STRUCTURE_ROAD),false);
}
{
 const f=roomFixture({roads:8,rcl:1});
 planner.plan(f.state);
 assert.equal(f.removed.length,0,'RCL1 road sites are not pruned unless over cap');
 assert.equal(f.sites().length,8);
 assert.equal(f.created.length,0);
}
{
 const f=roomFixture({roads:8,builtExtensions:5,
   sourceContainers:2,controllerContainer:true});
 planner.plan(f.state);
 assert.equal(f.removed.length,0,
  'Completed core infrastructure must not remove valid queued road sites');
 assert.equal(f.sites().length,8);
}
{
 const f=roomFixture({roads:8,existingExtensions:1});
 planner.plan(f.state);
 assert.ok(f.removed.length>0);
 assert.equal(count(f,STRUCTURE_EXTENSION),5);
 assert.equal(count(f,STRUCTURE_CONTAINER),3);
 assert.equal(f.sites().length,8);
}
{
 const f=roomFixture({roads:8,extraRoadProgress:100});
 planner.plan(f.state);
 assert.equal(f.removed.length,8);
 assert.equal(f.removed.at(-1).progress,100,
  'Prune least-progressed road sites first, preserving advanced sites longest');
}
// Once all required RCL2 economy structures are constructed, roadPath()
 // must not bypass wall terrain checks and accidentally create 45k tunnels.
{
  const steps=[{x:14,y:13},{x:15,y:13},{x:16,y:13},{x:17,y:13}];
  const f=roomFixture({roads:0,builtExtensions:5,sourceContainers:2,
    controllerContainer:true,roadPathSteps:steps,
    wallTiles:[{x:14,y:13},{x:16,y:13}]});
  planner.plan(f.state);
  assert.deepEqual(f.created.map(x=>[x.x,x.y,x.type]),
    [[15,13,STRUCTURE_ROAD],[17,13,STRUCTURE_ROAD]],
    'Never create a natural wall tunnel, but preserve normal road placement');
  assert.equal(f.sites().length,2);
  assert.equal(f.removed.length,0,'No existing useful site can be dropped');
  planner.plan(f.state);
  assert.equal(f.sites().length,2,'Road paths are idempotent when revisited');
}
// Never prune 45k partially built roads merely for being expensive.
// A separate critical construction-site cap policy retains its own controls.
{
  const f=roomFixture({roads:3,builtExtensions:5,sourceContainers:2,
    controllerContainer:true,extraRoadProgress:20000});
  planner.plan(f.state);
  assert.equal(f.removed.length,0);
  assert.equal(count(f,STRUCTURE_ROAD),3);
}
console.log('RCL2 critical-site cap and no new wall-road tunnel construction: PASS');
