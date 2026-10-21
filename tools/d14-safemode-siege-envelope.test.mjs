import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {scene,simulateTick,hostile} from './d13-multiphase-siege-campaign.test.mjs';

const source=fs.readFileSync(new URL('../game/room.manager.js',import.meta.url),'utf8');
const events=[];
const ctx={
  module:{exports:{}},
  STRUCTURE_SPAWN:'spawn',STRUCTURE_STORAGE:'storage',
  STRUCTURE_TOWER:'tower',STRUCTURE_RAMPART:'rampart',
  require(name) {
    if(name==='config')return {AUTO_SAFE_MODE:true};
    if(name==='logger')return {warn:(...args)=>events.push(args)};
    return {};
  }
};
vm.runInNewContext(source,ctx,{filename:'room.manager.js'});
const {safeModeDecision,maybeSafeMode,immediateDefense}=ctx.module.exports._test;
const tripleBoosted=()=>hostile('boosted-work',9,[
 ['work',true],['work',true],['work',true],['move']]);
const single=()=>hostile('unboosted-work',9,[['work'],['move']]);
function attachMode(s,{charges=1,cooldown=0,duration=200}={}) {
 let calls=0;
 const controller=s.room.controller;
 controller.safeModeAvailable=charges;controller.safeModeCooldown=cooldown;
 controller.safeMode=0;
 controller.activateSafeMode=function(){
  calls++;
  if(this.safeModeAvailable<=0||this.safeModeCooldown||this.safeMode)
   return -8;
  this.safeMode=duration;
  this.safeModeAvailable--;
  return 0;
 };
 return ()=>calls;
}
function protectedTick(s,attacker) {
 maybeSafeMode(s.state);
 simulateTick(s,attacker,{safeModeProtection:true});
}
{
 const s=scene({shieldHits:1000,towerAmmo:450,repairerEnergy:15});
 const calls=attachMode(s);
 assert.equal(safeModeDecision({...s.state,
  hostileCreeps:[tripleBoosted()]}).reason,'CORE_RAMPART_BREACH_IMMINENT',
  'owned weak shield must trigger Safe Mode before a 600/tick burst');
 for(let i=0;i<12;i++){
  s.state.hostileCreeps=[tripleBoosted()];
  protectedTick(s,tripleBoosted());
 }
 assert.equal(calls(),1,'scarce Safe Mode activation should occur exactly once');
 assert.equal(s.counts.shieldBreached,false,
  'synthetic Safe Mode envelope prevents boosted-WORK hit settlement');
 assert.equal(s.shield.hits,1000,
  'synthetic model does not apply enemy damage during Safe Mode');
 assert.equal(s.spawn.hits,5000);
 assert.ok(s.counts.towerAttack>0,
  'tower authority remains available alongside Safe Mode');
 const fresh=events.filter(e=>e[0]==='SAFE_MODE_ATTEMPT');
 assert.equal(fresh.length,1);
 assert.equal(fresh[0][2].reason,'CORE_RAMPART_BREACH_IMMINENT');
 console.log('D14_SAFE_MODE_AVAILABLE '+JSON.stringify({
  syntheticProtectedTicks:12,activationCount:calls(),
  initialShieldHits:1000,finalShieldHits:s.shield.hits,
  simulatedBreach:s.counts.shieldBreached,
  actionAuthority:'REAL_DECISION_SYNTHETIC_ENGINE'}));
}
{
 const s=scene({shieldHits:1000,towerAmmo:450,repairerEnergy:15});
 const calls=attachMode(s,{charges:0});
 for(let i=0;i<12;i++) {
  s.state.hostileCreeps=[tripleBoosted()];
  protectedTick(s,tripleBoosted());
 }
 assert.equal(calls(),0,'unavailable safe mode never creates fake charge');
 assert.equal(s.counts.shieldBreached,true,
  'same unkillable boosted enemy breaches weak shield with zero safe mode');
 assert.equal(s.counts.firstBreachTick,2);
 assert.ok(s.counts.spawnHitsLost>0,
  'synthetic no-Safe-Mode worst-case remains a real risk warning');
 console.log('D14_SAFE_MODE_UNAVAILABLE '+JSON.stringify({
  ticks:s.tick,activationCount:calls(),
  syntheticFirstBreachTick:s.counts.firstBreachTick,
  syntheticSpawnDamage:s.counts.spawnHitsLost,
  actionAuthority:'SIMULATED_ONLY_NO_LIVE_ENEMY_KILLS'}));
}
{
 const s=scene({shieldHits:9000,towerAmmo:850,repairerEnergy:40});
 s.spawn.hits=900; // historical damage from earlier combat
 const calls=attachMode(s);
 s.state.hostileCreeps=[tripleBoosted()];
 assert.equal(safeModeDecision(s.state),null,
  'damaged Spawn physically covered by a healthy owned shield must conserve Safe Mode');
 let activatedTick=null;
 for(let i=0;i<26;i++){
  s.state.hostileCreeps=[tripleBoosted()];
  protectedTick(s,tripleBoosted());
  if(calls()&&!activatedTick)activatedTick=s.tick;
 }
 assert.equal(calls(),1);
 assert.ok(activatedTick>1&&activatedTick<=19,
  'safe mode must be held until shield is actually near loss, then activate before breach');
 assert.equal(s.counts.shieldBreached,false);
 assert.equal(s.spawn.hits,900);
 console.log('D14_OLD_CORE_DAMAGE_BEHIND_SHIELD '+JSON.stringify({
  activeEnemyTicks:26,activationTick:activatedTick,
  shieldHits:s.shield.hits,coreHits:s.spawn.hits,
  safelyDeferred:true,syntheticOnly:true}));
}
{
 const s=scene({shieldHits:4000});const calls=attachMode(s);
 s.state.hostileCreeps=[hostile('harmless-scout',9,[['move']])];
 assert.equal(safeModeDecision(s.state),null);
 s.state.hostileCreeps=[hostile('dead-part',9,
  [['move']])];
 assert.equal(safeModeDecision(s.state),null);
 s.state.hostileCreeps=[single()];
 assert.equal(safeModeDecision(s.state),null,
  'a single 50/tick dismantler is not an immediate threat to 4000 hits');
 s.state.hostileCreeps=[hostile('distant-work',25,
  [['work',true],['work',true],['work',true]])];
 assert.equal(safeModeDecision(s.state),null);
 s.state.hostileCreeps=[tripleBoosted()];
 s.shield.my=false;
 assert.equal(safeModeDecision(s.state),null,
  'foreign Rampart must never count as protection or spend safe mode due to shield breach');
 s.shield.my=true;
 s.shield.pos={...s.shield.pos,x:20};
 assert.equal(safeModeDecision(s.state),null,
  'remote shield cannot activate protection for own Spawn');
 s.shield.pos={...s.shield.pos,x:10};
 s.room.controller.safeModeCooldown=10;
 assert.equal(safeModeDecision(s.state),null);
 s.room.controller.safeModeCooldown=0;
 s.room.controller.safeMode=100;
 assert.equal(safeModeDecision(s.state),null);
 s.room.controller.safeMode=0;
 assert.equal(calls(),0,'all discarded triggers preserve charges');
}
{
 const s=scene({shieldHits:10000});
 attachMode(s);
 s.spawn.hits=1000;
 s.shield.my=false;
 s.state.hostileCreeps=[single()];
 assert.equal(safeModeDecision(s.state).reason,'CRITICAL_CORE_DAMAGE',
  'unshielded damaged Spawn must retain original active Safe Mode trigger');
 s.shield.my=true;
 assert.equal(safeModeDecision(s.state),null,
  'only real owned overlaid Rampart shields exposed core-health test');
 s.shield.my=false;
 s.spawn.my=undefined;
 assert.equal(safeModeDecision(s.state),null,
  'undefined ownership is not evidence of an owned Spawn warranting scarce Safe Mode');
 s.spawn.my=true;
 s.state.structures=s.state.structures.filter(x=>x!==s.shield);
 assert.equal(safeModeDecision(s.state).reason,'CRITICAL_CORE_DAMAGE',
  'destroyed or missing owned Rampart restores direct core protection');
}
assert.match(source,/const protectedByOwnedShield=/);
assert.match(source,/if\(protectedByOwnedShield\)continue;/);
assert.equal((source.match(/controller\.activateSafeMode\(\)/g)||[]).length,1,
 'D14 cannot introduce second or duplicate Safe Mode authority');
console.log('D14 multiwave actual safe-mode decision + synthetic shield-protection envelope and conservation regressions PASS');
