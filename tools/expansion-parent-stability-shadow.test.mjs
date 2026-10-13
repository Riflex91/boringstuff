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
const stability=require('../game/expansion.parent.stability.shadow.js');

function parent(name='E2N2',overrides={}){
  return {
    room:{name,controller:{my:true}},spawn:{id:'spawn'},
    rcl:5,emergency:false,health:{status:'HEALTHY'},hostileCreeps:[],
    economyModel:{haulerCarryDeficit:0},
    energyCapacityAvailable:1050,energyAvailable:1050,energyStored:6000,
    creeps:[
      {memory:{role:'harvester'}},{memory:{role:'harvester'}},
      {memory:{role:'hauler'}},{memory:{role:'hauler'}},
      {memory:{role:'upgrader',waitingEnergyTicks:0,logisticsFallback:false}}
    ],...overrides
  };
}
const memory={bot:{}};
const game={time:1000};
const state=parent();
const original=JSON.stringify(state);
let s=stability.observe([state],game,memory);
assert.equal(s.status,'OBSERVATIONS_AVAILABLE');
assert.equal(s.rooms[0].status,'OBSERVING');
assert.equal(s.rooms[0].consecutiveSupportTicks,1);
assert.equal(s.rooms[0].firstTick,1000);
assert.equal(s.claimActionEnabled,false);
assert.equal(s.actionAuthority,'NONE');
assert.equal(JSON.stringify(state),original,'observer cannot mutate the live colony');
assert.equal(stability.observe([state],game,memory).rooms[0].consecutiveSupportTicks,1,
  'same-tick reevaluation must not fabricate additional evidence');
for(let tick=1001;tick<1099;tick++){
  game.time=tick;
  stability.observe([state],game,memory);
}
assert.equal(stability.snapshot(memory,game.time).rooms[0].consecutiveSupportTicks,99);
assert.equal(stability.snapshot(memory,game.time).rooms[0].status,'OBSERVING');
game.time=1099;
s=stability.observe([state],game,memory);
assert.equal(s.rooms[0].consecutiveSupportTicks,100);
assert.equal(s.rooms[0].status,'CONTINUOUS_SUPPORT_OBSERVED');
assert.equal(s.rooms[0].firstTick,1000);
assert.equal(s.rooms[0].lastTick,1099);
assert.equal(s.rooms[0].claimActionEnabled,false,
  '100 consecutive parent support observations cannot authorize claiming');
assert.equal(stability.snapshot(memory,1100).status,'STALE',
  'a missed tick cannot be treated as up-to-date support');
game.time=1101;
s=stability.observe([state],game,memory);
assert.equal(s.rooms[0].consecutiveSupportTicks,1,
  'one missing tick resets the entire support window');
assert.equal(s.rooms[0].firstTick,1101);
game.time=1102;
s=stability.observe([parent('E2N2',{energyAvailable:10})],game,memory);
assert.equal(s.rooms[0].status,'HOLD');
assert.equal(s.rooms[0].reason,'PARENT_INFRASTRUCTURE_REFILL_PRESSURE');
assert.equal(s.rooms[0].consecutiveSupportTicks,0);
assert.equal(s.rooms[0].firstTick,null);
game.time=1103;
s=stability.observe([state],game,memory);
assert.equal(s.rooms[0].consecutiveSupportTicks,1,
  'a support outage cannot carry a prior healthy streak forward');
game.time=1104;
s=stability.observe([parent('E2N2',{creeps:state.creeps.map((c,i)=>i===4?
  {memory:{...c.memory,waitingEnergyTicks:5}}:c)})],game,memory);
assert.equal(s.rooms[0].reason,'PARENT_CONSUMER_SUPPLY_PRESSURE');
assert.equal(s.rooms[0].consecutiveSupportTicks,0);
game.time=1105;
s=stability.observe([state,parent('E2N3')],game,memory);
assert.deepEqual(s.rooms.map(x=>x.room),['E2N2','E2N3']);
assert.deepEqual(s.rooms.map(x=>x.consecutiveSupportTicks),[1,1]);
game.time=1106;
s=stability.observe([state],game,memory);
assert.equal(s.rooms.length,1,'missing owned room invalidates its cached window');
game.time=1107;
s=stability.observe([state,parent('E2N3')],game,memory);
assert.equal(s.rooms.find(x=>x.room==='E2N3').consecutiveSupportTicks,1,
  'returning room must start a fresh continuity window');

const before=JSON.stringify(memory);
game.time=1108;
for(const bad of [
  [state,state],[{...state,room:{name:'invalid',controller:{my:true}}}],
  [{...state,room:{name:'E2N2',controller:{my:false}}}]
]){
  assert.equal(stability.observe(bad,game,memory).status,'UNVERIFIED');
  assert.equal(JSON.stringify(memory),before,'invalid input cannot rewrite evidence');
}
assert.equal(stability.observe([], {time:null},memory).status,'UNVERIFIED');
assert.equal(JSON.stringify(memory),before);
assert.equal(stability.observe([state],game,null).status,'UNVERIFIED');
assert.equal(stability.observe(Array(21).fill(state),game,memory).status,'UNVERIFIED');

game.time=1108;
s=stability.observe([state],game,memory);
assert.equal(s.rooms[0].consecutiveSupportTicks,2);
game.time=1106;
s=stability.observe([state],game,memory);
assert.equal(s.rooms[0].consecutiveSupportTicks,1,
  'time rollback cannot preserve a prior streak');
memory.bot.expansionParentStabilityShadow.rooms.E2N2={
  streak:100,lastTick:game.time,firstTick:999999,reason:null
};
assert.equal(stability.snapshot(memory,game.time).status,'UNVERIFIED',
  'inconsistent persisted tick bounds cannot be accepted');
const moduleText=fs.readFileSync(path.resolve(here,
  '../game/expansion.parent.stability.shadow.js'),'utf8');
const mainText=fs.readFileSync(path.resolve(here,'../game/main.js'),'utf8');
for(const forbidden of ['.claimController(','.reserveController(',
  '.spawnCreep(','.createConstructionSite(','.moveTo(']){
  assert.equal(moduleText.includes(forbidden),false,
    'parent stability witness never issues game intents: '+forbidden);
}
assert.ok(mainText.includes("require('expansion.parent.stability.shadow')"));
assert.ok(mainText.includes('expansionParentStabilityShadow.observe(roomStates, Game, Memory)'));
assert.ok(mainText.includes('    expansionParentStability,'));
console.log('I4 parent support 100-real-tick continuity witness PASS');
