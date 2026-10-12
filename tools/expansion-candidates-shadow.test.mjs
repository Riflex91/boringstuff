import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import Module from 'node:module';

// Runtime requires game modules by Screeps module name; resolve the same
// names in Node24 now that the candidate scorer has a module dependency.
process.env.NODE_PATH=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../game');
Module._initPaths();
const require=createRequire(import.meta.url);
const inspect=require('../game/expansion.candidates.shadow.js');
const readiness={authority:'SHADOW',status:'PLANNING_CANDIDATE',
  claimActionEnabled:false,availableClaimSlots:1};
const parent=()=>({room:{name:'E2N2',controller:{my:true}},rcl:5,
  spawn:{name:'Spawn1'},emergency:false,health:{status:'HEALTHY'},
  hostileCreeps:[],economyModel:{haulerCarryDeficit:0}});
function record(name,exits,options={}) {
  const mine=options.my===true;
  const sources=options.sources??2;
  return {schemaVersion:1,roomName:name,
    observation:{lastSeenTick:options.tick??1000,
      confidence:options.confidence??1,source:options.origin??'visible-room'},
    classification:{roomStatus:options.status??'normal'},
    controller:{exists:options.controllerExists??true,my:mine,
      owner:options.owner??(mine?'Me':null),
      reservationOwner:options.reservation??null,level:mine?5:0},
    resources:{sourceCount:sources,
      sources:Array.from({length:sources},(_,i)=>({
        id:'source-'+name+'-'+i,pos:{x:10+i,y:11,roomName:name}
      })),mineral:options.mineral?{type:'H'}:null},
    topology:{exits:exits.map(roomName=>({roomName}))},
    structures:{count:0,ownedByType:{}},
    threat:{hostileCreeps:options.hostiles??0,
      lastHostileTick:options.lastHostileTick??null}
  };
}
const memoryWith=(items)=>({bot:{worldIntel:{schemaVersion:1,
  rooms:Object.fromEntries(items.map(r=>[r.roomName,r]))}}});
const game={time:1050};
const base=[
  record('E2N2',['E2N3','E3N2','E1N2'],{my:true}),
  record('E2N3',['E2N2'],{sources:2}),
  record('E3N2',['E2N2'],{sources:2,mineral:true})
];
{
  const x=inspect.evaluate(readiness,[parent()],game,memoryWith(base));
  assert.equal(x.status,'ADVISORY_ONLY');
  assert.equal(x.authority,'SHADOW');
  assert.equal(x.claimActionEnabled,false);
  assert.equal(x.placementEnabled,false);
  assert.equal(x.routeVerified,false);
  assert.equal(x.selectedRoom,null);
  assert.equal(x.candidateCount,2);
  assert.equal(x.visitedRooms,4);
  assert.equal(x.unknownOrStaleRooms,1);
  assert.equal(x.topCandidates[0].roomName,'E3N2');
  assert.equal(x.topCandidates[0].hops,1);
  assert.equal(x.topCandidates[1].roomName,'E2N3');
  assert.deepEqual(inspect.evaluate(readiness,[parent()],game,memoryWith(base)),
    x,'Deterministic cached-I0-only ranking');
}
{
  const unknown=inspect.evaluate(readiness,[parent()],game,{});
  assert.equal(unknown.status,'UNVERIFIED');
  assert.equal(unknown.topCandidates.length,0);
}
{
  const cap=inspect.evaluate({...readiness,availableClaimSlots:0},
    [parent()],game,memoryWith(base));
  assert.equal(cap.status,'HOLD');
  assert.equal(cap.candidateCount,0);
  assert.equal(inspect.evaluate({...readiness,status:'HOLD'},
    [parent()],game,memoryWith(base)).status,'HOLD');
  assert.equal(inspect.evaluate({...readiness,claimActionEnabled:true},
    [parent()],game,memoryWith(base)).status,'HOLD');
}
{
  const unhealthy=inspect.evaluate(readiness,[{...parent(),
    health:{status:'WATCH'}}],game,memoryWith(base));
  assert.equal(unhealthy.status,'HOLD');
  assert.equal(unhealthy.reason,'NO_HEALTHY_PARENT');
}
for (const bad of [
  {tick:100}, {tick:1200},{confidence:0.4},{origin:'legacy-memory-intel'},
  {status:'novice'},{owner:'Rival'},{reservation:'Rival'},
  {hostiles:1},{lastHostileTick:999},{sources:1},{controllerExists:false}
]) {
  const candidate=record('E2N3',['E2N2'],bad);
  const x=inspect.evaluate(readiness,[parent()],game,memoryWith([
    record('E2N2',['E2N3'],{my:true}),candidate
  ]));
  assert.equal(x.candidateCount,0,
    'Stale/hostile/claimed/low-source/unverified candidates excluded: '+JSON.stringify(bad));
}
{
  const enemyTransit=record('E2N3',['E2N2','E2N4'],{owner:'Rival'});
  const x=inspect.evaluate(readiness,[parent()],game,memoryWith([
    record('E2N2',['E2N3'],{my:true}),enemyTransit,
    record('E2N4',['E2N3'])
  ]));
  assert.equal(x.candidateCount,0,
    'Never traverse occupied rival room to discover apparently safe candidate');
}
{
  const oldParent=record('E2N2',['E2N3'],{my:true,tick:10});
  const x=inspect.evaluate(readiness,[parent()],game,memoryWith([
    oldParent,record('E2N3',['E2N2'])
  ]));
  assert.equal(x.candidateCount,0,'Do not infer frontier through stale parent intel');
}
{
  const world=Array.from({length:160},(_,i)=>record(
    'E'+(4+i)+'N5',[],{sources:2}));
  const exits=world.map(r=>r.roomName);
  const x=inspect.evaluate(readiness,[parent()],game,memoryWith([
    record('E2N2',exits,{my:true}),...world
  ]));
  assert.equal(x.frontierTruncated,true);
  assert.ok(x.visitedRooms<=100,'Hard cap on examined rooms');
  assert.ok(x.topCandidates.length<=3,'Bounded telemetry size');
}
assert.equal(inspect._test.validRoomName('E1N1'),true);
assert.equal(inspect._test.validRoomName('E1N1;claimController()'),false);
console.log('expansion candidate shadow frontier (no intents): PASS');
