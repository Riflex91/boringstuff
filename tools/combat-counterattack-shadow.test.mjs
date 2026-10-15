import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const evidence=require('../game/combat.aggression.evidence.js');
const combat=require('../game/combat.counterattack.shadow.js');

const mine={room:{name:'E1N1',controller:{my:true,safeMode:0,safeModeCooldown:0}},
  spawn:{id:'spawn'},emergency:false,health:{status:'HEALTHY'},
  energyStored:8000,hostileCreeps:[]};
const armed=(username,parts)=>({
  owner:{username},body:parts.map(type=>({type,hits:100}))
});
const game={time:1000,map:{getRoomLinearDistance(from,to) {
  return from==='E1N1' && to==='E1N3'?2:10;
}}};
const memory={bot:{}};
const raid={...mine,hostileCreeps:[
  armed('Aggressor',['attack','move']),
  armed('Invader',['ranged_attack','move']),
  armed('HarmlessScout',['move']),
  armed('HealOnly',['heal','move']),
  armed('Aggressor',['heal','move'])
]};
const hit=evidence.observe([raid],game,memory);
assert.equal(hit.records.length,1,
  'NPCs and scouts cannot create an offensive grudge');
assert.equal(hit.records[0].player,'Aggressor');
assert.equal(hit.records[0].armedParts,1);
assert.equal(hit.records[0].room,'E1N1');
assert.equal(hit.records[0].tick,1000);
const rooms={E1N3:{
  roomName:'E1N3',
  controller:{owner:'Aggressor',my:false,safeMode:0},
  observation:{lastSeenTick:1000},
  structures:{byType:{tower:1}}
}};
const stable={...mine,hostileCreeps:[]};
const eligible=combat.evaluate([stable],rooms,hit,game);
assert.equal(eligible.status,'RECON_ADVISORY');
assert.equal(eligible.candidate.targetRoom,'E1N3');
assert.equal(eligible.candidate.observedAggressor,'Aggressor');
assert.equal(eligible.candidate.observedTowerCount,1);
assert.equal(eligible.attackActionEnabled,false);
assert.equal(eligible.spawnActionEnabled,false);
assert.equal(eligible.moveActionEnabled,false);
assert.equal(eligible.actionAuthority,'NONE');
assert.ok(eligible.unverified.includes('combatVictoryMargin'));
assert.ok(eligible.unverified.includes('retreatRouteAndReinforcementETA'));
const mismatched=combat.evaluate([stable],{
  E1N3:{...rooms.E1N3,controller:{owner:'Neutral',my:false,safeMode:0}}
},hit,game);
assert.equal(mismatched.status,'HOLD','unrelated player is not an automatic attack target');
assert.equal(combat.evaluate([stable],{
  E1N3:{...rooms.E1N3,controller:{owner:null,my:false,safeMode:0}}
},hit,game).status,'HOLD','neutral controllers are not attack targets');
assert.equal(combat.evaluate([stable],{
  E1N3:{...rooms.E1N3,observation:{lastSeenTick:700}}
},hit,game).status,'HOLD','stale ownership intelligence cannot justify retaliation');
assert.equal(combat.evaluate([stable],{
  E1N3:{...rooms.E1N3,controller:{owner:'Aggressor',my:false,safeMode:200}}
},hit,game).status,'HOLD','active Safe Mode blocks counterattack target proposal');
assert.equal(combat.evaluate([{...stable,room:{
  ...stable.room,controller:{my:true,safeModeCooldown:500}}}],rooms,hit,game)
  .reason,'NO_STABLE_HOME_GARRISON');
assert.equal(combat.evaluate([{...stable,energyStored:500}],rooms,hit,game)
  .reason,'NO_STABLE_HOME_GARRISON');
assert.equal(combat.evaluate([{...stable,hostileCreeps:[armed('Aggressor',['attack'])]}],
  rooms,hit,game).reason,'NO_STABLE_HOME_GARRISON',
  'currently threatened colony must prioritize home defense');
game.time=3001;
assert.equal(combat.evaluate([stable],rooms,hit,game).status,'HOLD',
  'old incursion cannot justify new enemy campaign');
const expired=evidence.observe([stable],game,memory);
assert.equal(expired.records.length,0,'stale evidence must be pruned');
const original=fs.readFileSync(new URL('../game/combat.counterattack.shadow.js',
  import.meta.url),'utf8');
for(const intent of ['.attack(','.rangedAttack(','.spawnCreep(',
  '.claimController(','.moveTo(','.createConstructionSite('])
  assert.equal(original.includes(intent),false,
    'recon planner must never issue gameplay intent '+intent);
console.log('U11 observed aggressor reconnaissance / fail-closed target tests PASS');
