import assert from 'node:assert/strict';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);
const d10=require('../game/defense.siege.sustain.js');
const realD8=require('../game/defense.combat.settlement.js');
const realD9=require('../game/defense.siege.pressure.js');
global.EVENT_ATTACK=1;global.EVENT_HEAL=2;global.EVENT_REPAIR=3;
const game={time:100},memory={bot:{}};
const states=[{room:{name:'E8N1',controller:{my:true}}}];
let settled,pressure;
const d8={summary(){return settled;}};
const d9={summary(){return pressure;}};
const totals={settledCoreShieldRepair:0,coreShieldRepairEvents:0,
 settledTowerDamage:0,settledTowerHealing:0,settledOwnedDamage:0};
function setWindow(tick,{start=100,repair=0,dam=0,heal=0,owned=0}={}){
 const observedTicks=tick-start+1;
 totals.settledCoreShieldRepair+=repair;
 totals.coreShieldRepairEvents+=repair>0?1:0;
 totals.settledTowerDamage+=dam;
 totals.settledTowerHealing+=heal;
 totals.settledOwnedDamage+=owned;
 const window={status:'PARTIAL',
  source:'SCREEPS_PREVIOUS_TICK_EVENT_LOG',
  attribution:'CURRENT_VISIBLE_OWNED_OBJECTS_ONLY_LOWER_BOUND',
  actionAuthority:'NONE',startObservationTick:start,
  endObservationTick:tick,lastSettledEventTick:tick-1,
  observedTicks,...totals};
 settled={status:'OBSERVING',current:window,lastCompletedWindow:null};
}
function setPressure(tick,{risk='CORE_SHIELD_AT_RISK',
 loss=100,gain=0,ammo=1500,defenders=2,energy=5000,
 activeHostiles=1,continuity='CONSECUTIVE',covered=2,uncovered=0}={}){
 pressure={status:'OBSERVED',authority:'SHADOW_EVIDENCE',actionAuthority:'NONE',
  observationTick:tick,risk,continuity,
  shieldDelta:'SAME_ID_CONSECUTIVE_TICK_NET_HITS_NOT_RAW_DAMAGE',
  damageEstimate:'IN_RANGE_UPPER_BOUND_NOT_SETTLED_DAMAGE',
  activeHostiles,observedNetShieldHitLoss:loss,
  observedNetShieldHitGain:gain,matchedCoreShields:covered,
  coreBuildings:covered+uncovered,coveredCoreBuildings:covered,
  uncoveredCoreBuildings:uncovered,towerAmmo:ammo,
  lowAmmoTowers:ammo<800?1:0,towerCount:2,
  defenderCount:defenders,storedEnergy:energy};
}
function next(t,receipt={},sensor={}){
 game.time=t;setWindow(t,receipt);setPressure(t,sensor);
 return d10.observe(states,game,memory,d8,d9);
}
function summary(){return d10.summary('E8N1',memory,game.time);}
{
 assert.equal(next(100,{dam:200,owned:150}).observedRooms,1);
 const a=summary();
 assert.equal(a.status,'ALIGNED');
 assert.equal(a.sampledConsecutiveTicks,1);
 assert.equal(a.windowStartTick,100);
 assert.equal(a.windowEndTick,100);
 assert.equal(a.shieldNetHitLoss,100);
 assert.equal(a.settledTowerDamage,200);
 assert.equal(a.settledOwnedDamage,150);
 assert.equal(a.settledCoreShieldRepair,0);
 assert.equal(a.confidence,
  'TIMING_ALIGNED_AGGREGATES_NOT_TARGET_LEVEL_CAUSALITY');
 assert.equal(a.causalRepairDeficit,
  'NOT_ESTABLISHED_WITHOUT_SAME_TARGET_SETTLED_DAMAGE_AND_REPAIR');
 assert.equal(a.liveDefenseOutcome,
  'NOT_ESTABLISHED_WITHOUT_REAL_HOSTILE_COMBAT_OUTCOME');
 assert.equal(a.observationBasis,
  'D9_MATCHED_SHIELD_NET_HITS_AND_D8_PREVIOUS_TICK_SETTLED_EVENTS');
 assert.equal(d10.observe(states,game,memory,d8,d9).observedRooms,0,
  'same-tick observer repeated must not duplicate a confirmed sample');
 assert.equal(next(101,{dam:250,owned:70}).observedRooms,1);
 assert.equal(next(102,{dam:120,owned:60}).observedRooms,1);
 const s=summary();
 assert.equal(s.diagnosis,'SUSTAINED_ATTRITION_NO_OBSERVED_CORE_REPAIR');
 assert.equal(s.sampledConsecutiveTicks,3);
 assert.equal(s.shieldNetHitLoss,300);
 assert.equal(s.settledTowerDamage,570);
 assert.equal(s.ticksWithSettledCoreRepair,0);
 assert.equal(s.ticksWithNetShieldLoss,3);
 assert.equal(next(103,{repair:80,dam:50},{loss:60}).observedRooms,1);
 assert.equal(summary().diagnosis,'SUSTAINED_ATTRITION_WITH_REPAIR_EVIDENCE');
 assert.equal(summary().settledCoreShieldRepair,80,
  'D8 evidence is a previous-tick settlement, not inferred shield gain');
 assert.equal(summary().shieldNetHitLoss,360,
  'physical net hit loss is not replaced by repair action values');
 assert.equal(next(104,{repair:40},{loss:0,ammo:200}).observedRooms,1);
 assert.equal(summary().diagnosis,'SIEGE_TOWER_AMMO_SHORTFALL');
 assert.equal(summary().ticksWithTowerAmmoBelowReserve,1);
 assert.equal(next(105,{dam:400},{loss:20,uncovered:1,
  risk:'CORE_UNSHIELDED_UNDER_FIRE'}).observedRooms,1);
 assert.equal(summary().diagnosis,'CRITICAL_UNSHIELDED_CORE',
  'attacked exposed critical Spawn/Tower/Storage is top risk');
 assert.equal(next(106,{},{loss:10,risk:'CORE_SHIELD_BREACH_IMMINENT'}).observedRooms,1);
 assert.equal(summary().diagnosis,'CRITICAL_CORE_SHIELD_BREACH');
 const t=JSON.stringify(summary());
 for(const privateName of ['Spawn1','attacker','shield-id','creepName'])
  assert.equal(t.includes(privateName),false,'no private identities in telemetry');
 const clone=JSON.parse(JSON.stringify(memory));
 assert.equal(d10.summary('E8N1',clone,106).shieldNetHitLoss,
  summary().shieldNetHitLoss,'persistent bounded records survive resets');
}
{
 game.time=107;
 setWindow(107);
 settled.status='GAP_UNKNOWN'; // D8 failed to inspect its event log
 setPressure(107);
 assert.equal(d10.observe(states,game,memory,d8,d9).observedRooms,0);
 assert.equal(summary().status,'GAP_UNKNOWN',
  'a missing settled previous-tick event receipt is not a zero-repair tick');
 game.time=108;
 // D8 recovers its own independent ledger only with first observation.
 settled={status:'OBSERVING',current:{
  ...settled.current,startObservationTick:108,endObservationTick:108,
  lastSettledEventTick:107,observedTicks:1,
  settledCoreShieldRepair:17,coreShieldRepairEvents:1,
  settledTowerDamage:25,settledTowerHealing:0,settledOwnedDamage:0
 },lastCompletedWindow:null};
 setPressure(108);
 assert.equal(d10.observe(states,game,memory,d8,d9).observedRooms,1);
 assert.equal(summary().sampledConsecutiveTicks,1);
 assert.equal(summary().settledCoreShieldRepair,17);
 assert.equal(summary().shieldNetHitLoss,100);
}
{
 // Rollover: COMPLETE tick 200 with 100 observations, followed by new
 // PARTIAL tick 201. Never subtract the previous 100-tick window.
 const mem={bot:{}};const w={time:199};
 const samples=[states[0]];
 const d8wrap={summary(){return settled;}};
 const d9wrap={summary(){return pressure;}};
 function s(tick,start,count,repair) {
  settled={status:'OBSERVING',current:{
   source:'SCREEPS_PREVIOUS_TICK_EVENT_LOG',
   attribution:'CURRENT_VISIBLE_OWNED_OBJECTS_ONLY_LOWER_BOUND',
   actionAuthority:'NONE',status:'PARTIAL',
   startObservationTick:start,endObservationTick:tick,
   lastSettledEventTick:tick-1,observedTicks:count,
   settledCoreShieldRepair:repair,coreShieldRepairEvents:1,
   settledTowerDamage:60,settledTowerHealing:0,settledOwnedDamage:0
  },lastCompletedWindow:null};
  setPressure(tick);
  w.time=tick;
 }
 s(199,101,99,44); // needs previous cumulative for a 99-tick window
 assert.equal(d10.observe(samples,w,mem,d8wrap,d9wrap).observedRooms,0);
 s(200,101,100,50);
 settled.current.status='PARTIAL';
 settled.lastCompletedWindow={...settled.current,status:'COMPLETE'};
 settled.current={...settled.current,startObservationTick:201,
  endObservationTick:200,lastSettledEventTick:199,observedTicks:0};
 assert.equal(d10.observe(samples,w,mem,d8wrap,d9wrap).observedRooms,1);
 assert.equal(d10.summary('E8N1',mem,200).settledCoreShieldRepair,6);
 s(201,201,1,7);
 assert.equal(d10.observe(samples,w,mem,d8wrap,d9wrap).observedRooms,1);
 assert.equal(d10.summary('E8N1',mem,201).settledCoreShieldRepair,13);
 assert.equal(d10.summary('E8N1',mem,201).sampledConsecutiveTicks,2);
}
{
 // D8 and D9 real module integration; no mock source can silently grant
 // aligned evidence when the predecessor record is absent.
 const pos=(x,y)=>({x,y,getRangeTo(target){const p=target?.pos||target;
   return Math.max(Math.abs(x-p.x),Math.abs(y-p.y));}});
 const spawn={id:'spawn1',my:true,structureType:'spawn',pos:pos(10,10)};
 const tower={id:'tower1',my:true,structureType:'tower',pos:pos(14,10),
  store:{energy:1000}};
 const rampart={id:'ramp1',my:true,structureType:'rampart',pos:pos(10,10),
  hits:390,hitsMax:100000};
 const friendly={id:'worker1',my:true,body:[{type:'work',hits:100}]};
 const attacker={id:'hostile1',pos:pos(11,10),
  body:[{type:'attack',hits:100}]};
 let log=[];
 const state={room:{name:'W37S79',controller:{my:true,safeMode:0},
  getEventLog(){return log;}},structures:[spawn,tower,rampart],
  towers:[tower],creeps:[friendly],hostileCreeps:[attacker],
  byRole:{defender:2},energyStored:5000};
 const local={bot:{}};const clock={time:400};
 realD9.observe([state],clock,local);
 realD8.observe([state],clock,local);
 assert.equal(d10.observe([state],clock,local,realD8,realD9).observedRooms,0,
  'D9 lacks authenticated predecessor on first observation');
 rampart.hits=290;clock.time=401;
 log=[{event:EVENT_REPAIR,objectId:'worker1',
  data:{targetId:'ramp1',amount:70}}];
 realD9.observe([state],clock,local);
 realD8.observe([state],clock,local);
 assert.equal(d10.observe([state],clock,local,realD8,realD9).observedRooms,1);
 const t=d10.summary('W37S79',local,401);
 assert.equal(t.status,'ALIGNED');
 assert.equal(t.settledCoreShieldRepair,70);
 assert.equal(t.shieldNetHitLoss,100);
 assert.equal(t.latestPhysicalRisk,'CORE_SHIELD_AT_RISK');
 assert.equal(t.settledOwnedDamage,0);
}
{
 const source=fs.readFileSync(new URL('../game/main.js',import.meta.url),'utf8');
 const module=fs.readFileSync(new URL('../game/defense.siege.sustain.js',import.meta.url),'utf8');
 assert.match(source,/siegeSustain\.observe\(roomStates,Game,Memory,/);
 assert.match(source,/defenseSiegeSustain:\s*siegeSustain\.summary\(state\.room\.name, Memory, Game\.time\)/);
 assert.ok(source.indexOf('combatSettlementEvidence.observe(')<
   source.indexOf('siegeSustain.observe('),
   'D10 must read already-collected D8 outcomes AFTER settled event inspection');
 assert.ok(source.indexOf('siegePressure.observe(')<
   source.indexOf('siegeSustain.observe('),
   'D10 must read D9 physical witness AFTER same-shield observation');
 for(const forbidden of [/\.attack\s*\(/,/\.heal\s*\(/,
   /\.repair\s*\(/,/\.spawnCreep\s*\(/,
   /\.createConstructionSite\s*\(/,/\.activateSafeMode\s*\(/,
   /\.moveTo\s*\(/])
  assert.doesNotMatch(module,forbidden,
   'D10 no combat, movement, Spawn, repair or Safe Mode write authority');
}
console.log('D10 D8/D9 prior-event alignment, 12-tick bounded siege trend, corruption and rollover PASS');
