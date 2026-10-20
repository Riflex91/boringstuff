import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const siege=require('../game/defense.siege.triage.js');
const src=fs.readFileSync(new URL('../game/tower.manager.js',import.meta.url),'utf8');
const context={module:{exports:{}},
 STRUCTURE_SPAWN:'spawn',STRUCTURE_TOWER:'tower',
 STRUCTURE_STORAGE:'storage',STRUCTURE_RAMPART:'rampart',
 STRUCTURE_WALL:'wall',RESOURCE_ENERGY:'energy',
 FIND_MY_CREEPS:'my_creeps',
 require(name){
  if(name==='logger')return{warn(){}};
  if(name==='defense.siege.triage')return siege;
  throw Error(name);
 }};
vm.runInNewContext(src,context,{filename:'tower.manager.js'});
const towerManager=context.module.exports;
const pos=x=>({x,y:10,getRangeTo(other) {
 const p=other?.pos || other;
 return Math.max(Math.abs(x-(p?.x??100)),Math.abs(10-(p?.y??100)));
}});
const core={id:'our-spawn',my:true,structureType:'spawn',pos:pos(10),
 hits:5000,hitsMax:5000};
function enemy(id,x,parts){return {id,pos:pos(x),body:parts.map(type=>
 typeof type==='string'?{type,hits:100}:type)};}
function friend(id,x,hits,hitsMax=500){
 return {id,my:true,pos:pos(x),hits,hitsMax};
}
const actions=[];
const tower=id=>({
 id,store:{energy:1000},
 attack(target){actions.push({tower:id,kind:'attack',target:target.id});return 0;},
 heal(target){actions.push({tower:id,kind:'heal',target:target.id});return 0;},
 repair(target){actions.push({tower:id,kind:'repair',target:target.id});return 0;}
});
const t=[tower('tower-1'),tower('tower-2')];
const state={room:{name:'E8N1',controller:{level:6},find(){return[];}},
 hostileCreeps:[],towers:t,structures:[core],creeps:[],
 energyStored:5000};
const attack=enemy('assault',12,['attack','move']);
const distantHeal=enemy('healer',17,['heal','move']);
const adjacent=enemy('breacher',11,['attack','move']);
{
 state.hostileCreeps=[attack,distantHeal];
 towerManager.run(state);
 assert.deepEqual(actions.map(x=>x.target),['healer','healer'],
  'distant active healer remains high-priority without immediate core strike');
 assert.equal(state.defenseTowerAction.status,'FOCUS_FIRE');
 assert.equal(state.defenseTowerAction.attackAttempts,2);
 assert.equal(state.defenseSiege.status,'OBSERVED');
 actions.length=0;
}
{
 state.hostileCreeps=[distantHeal,adjacent];
 towerManager.run(state);
 assert.deepEqual(actions.map(x=>x.target),['breacher','breacher'],
  'enemy currently damaging our spawn outranks distant support');
 actions.length=0;
}
{
 const wounded=friend('defender-at-death-door',14,70);
 const boosted=enemy('boosted-raider',15,
  [{type:'attack',hits:100,boost:'UH2O'},{type:'move',hits:100}]);
 state.creeps=[wounded];
 state.hostileCreeps=[boosted];
 towerManager.run(state);
 assert.deepEqual(actions.map(x=>x.kind),['heal','heal'],
  'a predicted lethal incoming strike triggers immediate all-tower healing');
 assert.deepEqual(actions.map(x=>x.target),[wounded.id,wounded.id]);
 assert.equal(state.defenseTowerAction.status,'HEAL_IMMINENT');
 assert.equal(state.defenseTowerAction.attackAttempts,0);
 assert.equal(state.defenseTowerAction.healAttempts,2);
 actions.length=0;
}
{
 const wounded=friend('hurt-ranger',14,70,200);
 const e=enemy('melee',15,['attack','attack','move']);
 state.creeps=[wounded];
 state.hostileCreeps=[e];
 towerManager.run(state);
 assert.deepEqual(actions.map(x=>x.kind),['heal','attack'],
  'one tower heals a threatened-but-not-imminently-dying ally');
 assert.deepEqual(actions.map(x=>x.target),[wounded.id,e.id]);
 assert.equal(state.defenseTowerAction.status,'HEAL_AND_FOCUS_FIRE');
 assert.equal(state.defenseTowerAction.attackAttempts,1);
 actions.length=0;
}
{
 state.creeps=[friend('scratched',14,390)];
 state.hostileCreeps=[enemy('melee',15,['attack','move'])];
 towerManager.run(state);
 assert.deepEqual(actions.map(x=>x.kind),['attack','attack'],
  'minor scratches cannot divert defensive focus fire');
 actions.length=0;
}
{
 state.creeps=[friend('critical',14,70,200)];
 state.hostileCreeps=[enemy('unarmed',15,['move'])];
 towerManager.run(state);
 assert.equal(state.defenseTowerAction.status,'HEAL_PEACE',
  'harmless scouts cannot block peace-time healing');
 assert.deepEqual(actions.map(x=>x.kind),['heal','heal']);
 actions.length=0;
}
{
 const target=friend('one-tower-defender',14,75,200);
 state.towers=[t[0]];state.creeps=[target];
 state.hostileCreeps=[enemy('melee',15,['attack','move'])];
 towerManager.run(state);
 assert.deepEqual(actions.map(x=>x.kind),['attack'],
  'single tower stays on hostile when wound is not yet near lethal');
 actions.length=0;
 state.towers=t;
}
{
 assert.equal(siege.estimatedDamage(enemy('x',15,
  [{type:'attack',hits:100,boost:'UH2O'}]),friend('c',14,100)),120);
 assert.equal(siege.estimatedDamage(enemy('x',19,
  ['attack','move']),friend('c',14,100)),0);
 assert.equal(siege.estimatedDamage(enemy('x',15,
  [{type:'attack',hits:0}]),friend('c',14,100)),0);
 const summary=siege.threatSummary([enemy('s',12,['move']),
   enemy('heal',13,[{type:'heal',hits:100,boost:'XLHO2'}]),
   enemy('attack',14,['work','ranged_attack'])]);
 assert.equal(summary.hostiles,3);
 assert.equal(summary.active,2);
 assert.equal(summary.healingParts,1);
 assert.equal(summary.rangedParts,1);
 assert.equal(summary.dismantleParts,1);
 assert.equal(summary.boostedParts,1);
 assert.ok(!JSON.stringify(summary).includes('attack') ||
  !JSON.stringify(summary).includes('our-spawn'));
 assert.equal(siege.threatSummary(Array.from({length:41},()=>enemy('x',11,['attack']))).status,'CAP_EXCEEDED');
 assert.equal(siege.chooseEmergencyHeal(null,[]).status,'UNVERIFIED');
}
{
 const main=fs.readFileSync(new URL('../game/main.js',import.meta.url),'utf8');
 const room=fs.readFileSync(new URL('../game/room.manager.js',import.meta.url),'utf8');
 assert.match(main,/defenseSiege:\s*state\.defenseSiege\s*\|\|\s*null/);
 assert.match(main,/defenseTowerAction:\s*state\.defenseTowerAction\s*\|\|\s*null/);
 assert.match(room,/defenseSiege:\s*state\.defenseSiege\s*\|\|\s*null/);
 assert.match(room,/defenseTowerAction:\s*state\.defenseTowerAction\s*\|\|\s*null/);
 assert.equal(src.includes('Memory.'),false,
  'tower module does not mutate Memory for new defense telemetry');
}
console.log('D4/D5 bounded siege telemetry, verified core threat targeting, threatened-ally healing, at-most-one tower intent PASS');
