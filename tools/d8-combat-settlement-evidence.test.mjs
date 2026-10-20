import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import Module from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);
global.EVENT_ATTACK=1;
global.EVENT_HEAL=2;
global.EVENT_REPAIR=3;
const d8=require('../game/defense.combat.settlement.js');
function scene(){
 const spawn={id:'s1',my:true,structureType:'spawn',pos:{x:10,y:10}},
   tower={id:'t1',my:true,structureType:'tower',pos:{x:11,y:10}},
   ramp={id:'r1',my:true,structureType:'rampart',pos:{x:10,y:10},
     hits:1000,hitsMax:100000},
   remote={id:'r2',my:true,structureType:'rampart',pos:{x:20,y:20}},
   civilian={id:'c1',my:true,hits:100,hitsMax:200};
 const world={time:200},mem={bot:{}},events=[];
 const state={room:{name:'E8N1',controller:{my:true},
   getEventLog(){return events.slice();}},
   towers:[tower],structures:[spawn,tower,ramp,remote],
   creeps:[civilian],hostileCreeps:[{body:[{type:'attack',hits:100}]}]};
 return {state,world,mem,events,ramp,spawn,tower,civilian};
}
const attack=(actor,target,damage)=>({
 event:EVENT_ATTACK,objectId:actor,data:{targetId:target,damage}});
const heal=(actor,target,amount)=>({
 event:EVENT_HEAL,objectId:actor,data:{targetId:target,amount}});
const repair=(actor,target,amount)=>({
 event:EVENT_REPAIR,objectId:actor,data:{targetId:target,amount}});
{
 const f=scene();
 f.events.push(attack('t1','enemy',400),heal('t1','c1',200),
  repair('c1','r1',100),repair('t1','r1',500),
  attack('enemy','r1',150),attack('own-other','s1',50),
  attack('enemy','dead-structure',5000),
  attack('unknown','other',300),heal('enemy','c1',400),
  repair('enemy','r1',200),repair('t1','r2',999),
  {event:EVENT_ATTACK,objectId:'t1',data:{targetId:'enemy',damage:'500'}});
 const got=d8._test.roomInspect(f.state);
 assert.equal(got.towerAttackEvents,1);
 assert.equal(got.settledTowerDamage,400);
 assert.equal(got.towerHealEvents,1);
 assert.equal(got.settledTowerHealing,200);
 assert.equal(got.coreShieldRepairEvents,2);
 assert.equal(got.settledCoreShieldRepair,600);
 assert.equal(got.incomingOwnedHitEvents,2);
 assert.equal(got.settledOwnedDamage,200);
 assert.equal(got.ticksWithArmedHostiles,1);
 assert.equal(got._coreStructures,2);
 assert.equal(got._coveredCoreStructures,1);
 assert.equal(got._minCoreShieldHits,1000);
 assert.equal(JSON.stringify(got).includes('enemy'),false);
 const result=d8.observe([f.state],f.world,f.mem);
 assert.equal(result.observedRooms,1);
 assert.equal(result.completed.length,0);
 const summary=d8.summary('E8N1',f.mem);
 assert.equal(summary.status,'OBSERVING');
 assert.equal(summary.current.observedTicks,1);
 assert.equal(summary.current.firstSettledEventTick,199);
 assert.equal(summary.current.settledTowerDamage,400);
 assert.equal(summary.current.minimumObservedCoreShieldHits,1000);
 assert.equal(summary.current.latestCoreStructures,2);
 assert.equal(summary.current.latestUncoveredCoreStructures,1);
 assert.equal(summary.current.coreShieldSamples,1);
 assert.equal(summary.current.authority,'SHADOW_EVIDENCE');
 assert.equal(summary.current.actionAuthority,'NONE');
 assert.equal(JSON.stringify(summary).includes('s1'),false);
 assert.equal(JSON.stringify(summary).includes('enemy'),false);
 assert.equal(d8.observe([f.state],f.world,f.mem).observedRooms,0,
  'duplicate observer calls in same game tick cannot double-count');
 for(let tick=201;tick<299;tick++){
  f.world.time=tick;
  f.events.length=0;
  assert.equal(d8.observe([f.state],f.world,f.mem).observedRooms,1);
 }
 f.world.time=299;
 const done=d8.observe([f.state],f.world,f.mem);
 assert.equal(done.completed.length,1);
 assert.equal(done.completed[0].summary.status,'COMPLETE');
 assert.equal(done.completed[0].summary.observedTicks,100);
 assert.equal(done.completed[0].summary.startObservationTick,200);
 assert.equal(done.completed[0].summary.endObservationTick,299);
 assert.equal(done.completed[0].summary.firstSettledEventTick,199);
 assert.equal(done.completed[0].summary.lastSettledEventTick,298);
 assert.equal(done.completed[0].summary.settledTowerDamage,400);
 assert.equal(done.completed[0].summary.minimumObservedCoreShieldHits,1000);
 assert.equal(done.completed[0].summary.coreShieldSamples,100);
 assert.equal(d8.summary('E8N1',f.mem).lastCompletedWindow.observedTicks,100);
 const mem=JSON.parse(JSON.stringify(f.mem));
 f.world.time=300;
 assert.equal(d8.observe([f.state],f.world,mem).observedRooms,1,
  'persisted aggregate window survives global reset');
 assert.equal(d8.summary('E8N1',mem).lastCompletedWindow.settledTowerDamage,400);
}
{
 const f=scene();
 f.events.push(attack('t1','enemy',50));
 d8.observe([f.state],f.world,f.mem);
 f.world.time=202;
 d8.observe([f.state],f.world,f.mem);
 const s=d8.summary('E8N1',f.mem);
 assert.equal(s.current.observedTicks,1,
   'missing tick breaks contiguous settlement evidence');
 assert.equal(s.current.startObservationTick,202);
 assert.equal(s.lastCompletedWindow,null);
}
{
 const f=scene();
 f.events.push(attack('t1','enemy',100));
 d8.observe([f.state],f.world,f.mem);
 const saved=f.state.room.getEventLog;
 f.world.time=201;
 f.state.room.getEventLog=()=>{throw Error('event API unavailable');};
 assert.equal(d8.observe([f.state],f.world,f.mem).observedRooms,0);
 assert.equal(d8.summary('E8N1',f.mem).status,'GAP_UNKNOWN');
 f.world.time=202;
 f.state.room.getEventLog=saved;
 d8.observe([f.state],f.world,f.mem);
 assert.equal(d8.summary('E8N1',f.mem).current.observedTicks,1);
 assert.equal(d8.summary('E8N1',f.mem).current.settledTowerDamage,100,
  'new current event sample is independent from last failed window');
}
{
 const f=scene();
 f.events.push(attack('t1','enemy',15));
 f.state.structures.splice(2,1); // Rampart destroyed/not visible
 f.events.push(repair('c1','r1',100));
 const x=d8._test.roomInspect(f.state);
 assert.equal(x._coveredCoreStructures,0,
  'the physically missing shield is not counted as protection');
 assert.equal(x.coreShieldRepairEvents,0,
  'destroyed or not visible shield cannot authenticate actual repaired hits');
 assert.equal(x.towerAttackEvents,1);
 f.state.room.getEventLog=()=>Array(251).fill(attack('t1','enemy',1));
 assert.equal(d8._test.roomInspect(f.state),null);
 assert.equal(d8.observe([f.state],f.world,f.mem).observedRooms,0,
  'truncated event logs cannot be called all-zero outcomes');
}
{
 const f=scene();
 const bad=(x)=>{f.mem.bot.d8CombatSettlement=x;};
 bad({schemaVersion:1,rooms:{E8N1:{current:{startTick:200,
  lastTick:200,observedTicks:1,towerAttackEvents:5000000000},lastWindow:null}}});
 assert.equal(d8.observe([f.state],f.world,f.mem).observedRooms,0);
 assert.equal(d8.summary('E8N1',f.mem).status,'UNVERIFIED');
}
{
 const code=fs.readFileSync(new URL('../game/main.js',import.meta.url),'utf8');
 const module=fs.readFileSync(new URL('../game/defense.combat.settlement.js',import.meta.url),'utf8');
 assert.match(code,/combatSettlementEvidence\.observe\(roomStates,Game,Memory\)/);
 assert.match(code,/defenseCombatSettlement:\s*combatSettlementEvidence\.summary\(state\.room\.name, Memory\)/);
 assert.ok(code.indexOf("id: 'rooms'")<code.indexOf('combatSettlementEvidence.observe('),
   'D8 observation cannot displace immediate Tower/Safe Mode phase');
 for(const illegal of [/\.spawnCreep\s*\(/,/\.attack\s*\(/,/\.repair\s*\(/,
   /\.heal\s*\(/,/\.moveTo\s*\(/,/\.createConstructionSite\s*\(/])
   assert.doesNotMatch(module,illegal,'event observer must be read-only');
}
console.log('D8 prior-tick settled Tower attack/heal and own shield repair: authenticated lower bounds, gap isolation, capped 100-tick evidence PASS');
