import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const d9=require('../game/defense.siege.pressure.js');

const pos=(x,y)=>({x,y,getRangeTo(target) {
 const p=target?.pos||target;
 return Math.max(Math.abs(x-p.x),Math.abs(y-p.y));
}});
const core=(id,type,x)=>({id,my:true,structureType:type,pos:pos(x,10),
  hits:5000,hitsMax:5000});
const shield=(id,x,hits=600)=>({id,my:true,structureType:'rampart',
  pos:pos(x,10),hits,hitsMax:1000000});
const enemy=(x,parts)=>({pos:pos(x,10),body:parts.map(p=>
 typeof p==='string'?{type:p,hits:100}:p)});
const threat=enemy(11,['work','move']);
function scene(){
 const spawn=core('spawn1','spawn',10),tower=core('tower1','tower',12),
   storage=core('storage1','storage',16);
 const shieldSpawn=shield('shield-spawn',10),shieldTower=shield('shield-tower',12,5000);
 const state={room:{name:'E8N1',controller:{my:true,safeMode:0}},
  structures:[spawn,tower,storage,shieldSpawn,shieldTower],
  hostileCreeps:[threat],towers:[{...tower,store:{energy:950}}],
  energyStored:12000,byRole:{defender:2}};
 return {state,spawn,tower,storage,shieldSpawn,shieldTower,
   game:{time:200},memory:{bot:{}}};
}
{
 const f=scene();
 const first=d9.observe([f.state],f.game,f.memory);
 assert.equal(first.observedRooms,1);
 const s=d9.summary('E8N1',f.memory,200);
 assert.equal(s.status,'OBSERVED');
 assert.equal(s.risk,'CORE_SHIELD_AT_RISK');
 assert.equal(s.coreBuildings,3);
 assert.equal(s.coveredCoreBuildings,2);
 assert.equal(s.uncoveredCoreBuildings,1);
 assert.equal(s.attackedUncoveredCore,0);
 assert.equal(s.endangeredCoreShields,1);
 assert.equal(s.imminentCoreShields,0);
 assert.equal(s.minimumCoreShieldHits,600);
 assert.equal(s.maximumInRangeEnemyCoreDamagePotential,50);
 assert.equal(s.shortestEstimatedCoreShieldBreachTicks,12);
 assert.equal(s.towerAmmo,950);
 assert.equal(s.defenderCount,2);
 assert.equal(s.storedEnergy,12000);
 assert.equal(s.continuity,'NO_PREDECESSOR');
 assert.equal(s.matchedCoreShields,0);
 assert.equal(s.observedNetShieldHitLoss,0);
 assert.equal(d9.observe([f.state],f.game,f.memory).observedRooms,0,
  'one game tick must never count twice');
 const serialized=JSON.parse(JSON.stringify(f.memory));
 assert.equal(d9.summary('E8N1',serialized,200).risk,'CORE_SHIELD_AT_RISK');
 const telemetryText=JSON.stringify(s);
 assert.equal(telemetryText.includes('shield-spawn'),false);
 assert.equal(telemetryText.includes('spawn1'),false);
 assert.equal(telemetryText.includes('tower1'),false);
 f.shieldSpawn.hits=350;
 f.game.time=201;
 assert.equal(d9.observe([f.state],f.game,f.memory).observedRooms,1);
 const second=d9.summary('E8N1',f.memory,201);
 assert.equal(second.continuity,'CONSECUTIVE');
 assert.equal(second.matchedCoreShields,2);
 assert.equal(second.observedNetShieldHitLoss,250);
 assert.equal(second.observedNetShieldHitGain,0);
 assert.equal(second.shortestEstimatedCoreShieldBreachTicks,7);
 f.shieldSpawn.hits=120;
 f.shieldTower.hits=5200;
 f.game.time=202;
 d9.observe([f.state],f.game,f.memory);
 const third=d9.summary('E8N1',f.memory,202);
 assert.equal(third.risk,'CORE_SHIELD_BREACH_IMMINENT');
 assert.equal(third.imminentCoreShields,1);
 assert.equal(third.observedNetShieldHitLoss,230);
 assert.equal(third.observedNetShieldHitGain,200);
 assert.equal(third.matchedCoreShields,2);
 assert.equal(d9.summary('E8N1',f.memory,203).status,'STALE_OR_UNKNOWN',
  'old dangerous sample must never masquerade as current');
 f.game.time=204;f.shieldSpawn.hits=70;
 d9.observe([f.state],f.game,f.memory);
 assert.equal(d9.summary('E8N1',f.memory,204).continuity,
  'NO_PREDECESSOR','missing tick invalidates shield delta');
 assert.equal(d9.summary('E8N1',f.memory,204).observedNetShieldHitLoss,0);
 // Same-shield identity is mandatory. A weaker replacement shield must
 // not manufacture positive observed damage for an unrelated structure.
 f.state.structures=f.state.structures.filter(x=>x!==f.shieldSpawn);
 const replacement=shield('replacement-shield',10,5);
 f.state.structures.push(replacement);
 f.game.time=205;
 d9.observe([f.state],f.game,f.memory);
 const changed=d9.summary('E8N1',f.memory,205);
 assert.equal(changed.matchedCoreShields,1);
 assert.equal(changed.observedNetShieldHitLoss,0);
 assert.equal(changed.minimumCoreShieldHits,5);
}
{
 const f=scene();
 f.state.hostileCreeps=[enemy(15,['work','move'])];
 d9.observe([f.state],f.game,f.memory);
 const s=d9.summary('E8N1',f.memory,200);
 assert.equal(s.risk,'CORE_UNSHIELDED_UNDER_FIRE',
  'an actual armed threat on unprotected Storage outranks other shields');
 assert.equal(s.attackedUncoveredCore,1);
 f.state.hostileCreeps=[enemy(11,[{type:'attack',hits:0},'move'])];
 f.game.time++;
 d9.observe([f.state],f.game,f.memory);
 assert.equal(d9.summary('E8N1',f.memory,201).risk,'CORE_EXPOSED',
  'destroyed weapons cannot trigger a breach prediction');
 f.state.hostileCreeps=[];
 f.game.time++;
 d9.observe([f.state],f.game,f.memory);
 assert.equal(d9.summary('E8N1',f.memory,202).risk,'CORE_EXPOSED',
  'even in peace a physically uncovered core needs planning attention');
 f.state.structures.push(shield('shield-storage',16,20000));
 f.game.time++;
 d9.observe([f.state],f.game,f.memory);
 assert.equal(d9.summary('E8N1',f.memory,203).risk,'QUIET');
}
{
 const f=scene();
 f.state.towers[0].store.energy=200;
 d9.observe([f.state],f.game,f.memory);
 assert.equal(d9.summary('E8N1',f.memory,200).lowAmmoTowers,1);
 f.state.hostileCreeps=[enemy(11,[{type:'attack',hits:100,
  boost:'XUH2O'}])];
 f.game.time=201;
 d9.observe([f.state],f.game,f.memory);
 const x=d9.summary('E8N1',f.memory,201);
 assert.equal(x.maximumInRangeEnemyCoreDamagePotential,120);
 assert.equal(x.shortestEstimatedCoreShieldBreachTicks,5);
 assert.equal(x.risk,'CORE_SHIELD_AT_RISK');
 f.shieldSpawn.hits=100;
 f.game.time=202;
 d9.observe([f.state],f.game,f.memory);
 assert.equal(d9.summary('E8N1',f.memory,202).risk,'CORE_SHIELD_BREACH_IMMINENT');
}
{
 const f=scene();
 f.state.hostileCreeps=[enemy(11,Array.from({length:51},()=> 'attack'))];
 assert.equal(d9.inspect(f.state),null);
 assert.equal(d9.observe([f.state],f.game,f.memory).observedRooms,0);
 assert.equal(d9.summary('E8N1',f.memory,200).status,'UNOBSERVED');
 f.state.hostileCreeps=[threat];
 d9.observe([f.state],f.game,f.memory);
 f.game.time=201;
 f.state.hostileCreeps=[enemy(11,[{type:'attack',hits:'unknown'}])];
 assert.equal(d9.observe([f.state],f.game,f.memory).observedRooms,0);
 assert.equal(d9.summary('E8N1',f.memory,201).status,'STALE_OR_UNKNOWN',
  'invalid live evidence cannot claim safe current observation');
}
{
 const f=scene();
 d9.observe([f.state],f.game,f.memory);
 const mem=JSON.parse(JSON.stringify(f.memory));
 mem.bot.d9SiegePressure.rooms.E8N1.result.creepId='PRIVATE_NAME';
 mem.bot.d9SiegePressure.rooms.E8N1.result.attacker='PRIVATE_ATTACKER';
 assert.equal(JSON.stringify(d9.summary('E8N1',mem,200)).includes('PRIVATE'),false,
  'telemetry explicitly whitelists aggregate fields only');
 mem.bot.d9SiegePressure.rooms.E8N1.private.shields=[
  {id:'shield-spawn',hits:-5}];
 assert.equal(d9.observe([f.state],{time:201},mem).observedRooms,0,
  'corrupt private data cannot silently become valid');
 assert.equal(d9.summary('E8N1',mem,201).status,'UNOBSERVED',
  'corrupted sample never receives a current verified risk');
}
{
 const f=scene();
 assert.equal(d9.observe([f.state],f.game,{bot:{d9SiegePressure:{
  schemaVersion:1,rooms:{W3N3:{private:{
    tick:199,shields:[{id:'bad',hits:0}]}
  },W1N1:{private:{tick:199,shields:[]}},
  W2N2:{private:{tick:199,shields:[]}}}
 }}}).observedRooms,0,
 'bounded three-room ledger does not admit additional storage');
}
{
 const source=fs.readFileSync(new URL('../game/main.js',import.meta.url),'utf8');
 const observer=fs.readFileSync(new URL('../game/defense.siege.pressure.js',import.meta.url),'utf8');
 assert.match(source,/siegePressure\.observe\(roomStates,Game,Memory\)/);
 assert.match(source,/defenseSiegePressure:\s*siegePressure\.summary\(state\.room\.name, Memory, Game\.time\)/);
 assert.ok(source.indexOf("id: 'rooms'")<source.indexOf('siegePressure.observe('),
  'D9 pressure tracking must NEVER delay early active defense');
 for(const forbidden of [/\.spawnCreep\s*\(/,/\.attack\s*\(/,
  /\.repair\s*\(/,/\.heal\s*\(/,/\.moveTo\s*\(/,
  /\.createConstructionSite\s*\(/,/\.activateSafeMode\s*\(/])
   assert.doesNotMatch(observer,forbidden,'D9 observer has zero gameplay authority');
}
console.log('D9 authenticated same-Rampart loss, physical core exposure, breach pressure and ammo risk regression PASS');
