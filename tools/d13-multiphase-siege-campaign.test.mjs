import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import Module from 'node:module';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);
Object.assign(global,{
 RESOURCE_ENERGY:'energy',WORK:'work',
 FIND_STRUCTURES:'structures',FIND_HOSTILE_CREEPS:'hostiles',
 FIND_MY_CREEPS:'friendlies',FIND_MY_STRUCTURES:'my-structures',
 FIND_MY_CONSTRUCTION_SITES:'sites',
 STRUCTURE_SPAWN:'spawn',STRUCTURE_EXTENSION:'extension',
 STRUCTURE_TOWER:'tower',STRUCTURE_STORAGE:'storage',
 STRUCTURE_RAMPART:'rampart',STRUCTURE_WALL:'constructedWall',
 STRUCTURE_ROAD:'road',OK:0,ERR_NOT_IN_RANGE:-9,
 ERR_FULL:-8,ERR_INVALID_TARGET:-7,ERR_NO_PATH:-2
});
const policy=require('../game/work.priority.js');
const siege=require('../game/defense.siege.triage.js');
const energy=require('../game/energy.js');
const scriptTower=fs.readFileSync(new URL('../game/tower.manager.js',import.meta.url),'utf8');
const scriptWorker=fs.readFileSync(new URL('../game/role.worker.js',import.meta.url),'utf8');
const vmModule=(source,mocks)=>{
 const sandbox={module:{exports:{}},require:name=>{
  if(Object.hasOwn(mocks,name))return mocks[name];
  throw Error('unexpected dependency '+name);
 }, ...Object.fromEntries([
 'RESOURCE_ENERGY','WORK','FIND_STRUCTURES','FIND_HOSTILE_CREEPS',
 'FIND_MY_CREEPS','FIND_MY_STRUCTURES','FIND_MY_CONSTRUCTION_SITES',
 'STRUCTURE_SPAWN','STRUCTURE_EXTENSION','STRUCTURE_TOWER',
 'STRUCTURE_STORAGE','STRUCTURE_RAMPART','STRUCTURE_WALL',
 'STRUCTURE_ROAD','OK','ERR_NOT_IN_RANGE','ERR_INVALID_TARGET','ERR_FULL'
 ].map(k=>[k,global[k]]))};
 vm.runInNewContext(source,sandbox);
 return sandbox.module.exports;
};
const logger={warn() {},info() {}};
const towerAI=vmModule(scriptTower,{
 logger,'defense.siege.triage':siege
});
let currentSim=null;
const workerAI=vmModule(scriptWorker,{
 'config':require('../game/config.js'),
 'work.priority':policy,
 'energy':{
   deliver(creep) {
     const targets=energy.deliveryTargets(creep);
     if(!targets.length||!currentSim)return false;
     const target=targets[0];
     if(target.store.energy>=target.store.getCapacity('energy'))return false;
     const available=creep.store.energy;
     if(!available)return false;
     const moved=Math.min(available,
       target.store.getCapacity('energy')-target.store.energy);
     creep.store.energy-=moved;target.store.energy+=moved;
     currentSim.counts.repairerDiverted+=moved;
     return moved>0;
   },
   acquire() {return false;},
   acquireForConsumer(){return false;}
 }
});

function position(x,y=10){
 return{x,y,roomName:'E8N1',getRangeTo(o){
  const p=o?.pos||o;
  return Math.max(Math.abs(x-p.x),Math.abs(y-p.y));
 }};
}
function store(cap,initial){
 return{energy:initial,getCapacity(){return cap;},
  getFreeCapacity(){return Math.max(0,cap-this.energy);}};
}
function hostile(id,x,body){
 return{id,pos:position(x),body:body.map(([type,boost])=>
  ({type,hits:100,...(boost?{boost:'BOOSTED'}:{})})),
  owner:{username:'SIMULATED'},hits:2000,hitsMax:2000};
}
const EVENT_WAVES=[
 {label:'unarmed_scout',duration:8,hostile:()=>hostile('scout',9,[['move']])},
 {label:'single_unboosted_dismantler',duration:26,
  hostile:()=>hostile('unboosted',9,[['work'],['move']])},
 {label:'boosted_dismantler_saturation',duration:12,
  hostile:()=>hostile('boosted',9,[['work',true],['work',true],
   ['work',true],['move']])},
 {label:'supply_interruption_with_ranged_fire',duration:20,
  hostile:()=>hostile('ranged',8,[['ranged_attack',true],['move']])},
 {label:'aftermath',duration:9,hostile:()=>null}
];

function scene({shieldHits=400,haulers=1,towerAmmo=750,
 repairerEnergy=40,storedEnergy=15000,roomEnergy=1050}={}){
 const counts={towerAttack:0,towerHeal:0,towerRepair:0,scoutShots:0,
  shieldRepair:0,shieldRepairHits:0,workerMoves:0,
  repairerDiverted:0,spawnRefills:0,towerRefills:0,
  netShieldDamage:0,spawnHitsLost:0,shieldBreached:false,
  firstBreachTick:null,partialLoadResumes:0,
  attemptedRepairWithoutEnergy:0,spawningSupplyDenied:0,
  firstShotAtTick:null};
 const spawn={id:'owned-spawn',my:true,structureType:'spawn',
  pos:position(10),hits:5000,hitsMax:5000,store:store(300,300)};
 const extension={id:'owned-extension',my:true,structureType:'extension',
  pos:position(12),store:store(50,50)};
 const shield={id:'owned-shield',my:true,structureType:'rampart',
  pos:position(10),hits:shieldHits,hitsMax:1000000};
 const towers=Array.from({length:2},(_,i)=>({
  id:'owned-tower-'+i,my:true,structureType:'tower',
  pos:position(13+i),hits:3000,hitsMax:3000,
  store:store(1000,towerAmmo),
  attack(target) {
   if(this.store.energy<10)return -6;
   this.store.energy-=10;counts.towerAttack++;
   if(target.id==='scout')counts.scoutShots++;
   if(counts.firstShotAtTick===null)counts.firstShotAtTick=sim.tick;
   return 0; // No enemy casualties are invented.
  },
  heal() {
   if(this.store.energy<10)return -6;
   this.store.energy-=10;counts.towerHeal++;return 0;
  },
  repair(target) {
   if(this.store.energy<10)return -6;
   this.store.energy-=10;counts.towerRepair++;
   if(target===shield){target.hits+=800;counts.shieldRepairHits+=800;}
   return 0;
  }
 }));
 const storage={id:'storage',my:true,structureType:'storage',
  pos:position(15),hits:10000,hitsMax:10000,store:store(100000,storedEnergy)};
 const room={name:'E8N1',controller:{my:true,level:6,safeMode:0},
  energyAvailable:roomEnergy,energyCapacityAvailable:1050,
  hostiles:[],creeps:[],structures:[spawn,extension,shield,...towers,storage],
  find(type,options) {
   let values=type==='structures'?this.structures:
    type==='hostiles'?this.hostiles:
    type==='friendlies'?this.creeps:
    type==='my-structures'?this.structures.filter(s=>s.my===true):
    type==='sites'?[]:null;
   if(!values)throw Error('unknown Room.find '+type);
   return typeof options?.filter==='function'?values.filter(options.filter):values.slice();
  }};
 const repairer={id:'repairer',my:true,pos:position(10),room,
  hits:300,hitsMax:300,spawning:false,
  memory:{role:'repairer',working:false,waitingEnergyTicks:5,
   logisticsFallback:false},
  store:store(100,repairerEnergy),
  getActiveBodyparts(type){return type==='work'?1:type==='move'?1:0;},
  repair(target){
   if(!this.store.energy){counts.attemptedRepairWithoutEnergy++;return -6;}
   if(target.hits>=target.hitsMax)return -8;
   this.store.energy--;target.hits+=100;
   counts.shieldRepair++;counts.shieldRepairHits+=100;return 0;
  },
  pos:{...position(10),
   findClosestByPath(list){return Array.isArray(list)?list[0]||null:null;}},
  moveTo(){counts.workerMoves++;return 0;},
  upgradeController(){return 0;}
 };
 const carriers=Array.from({length:haulers},(_,i)=>({
  id:'hauler-'+i,my:true,pos:position(14),room,spawning:false,
  memory:{role:'hauler',delivering:true},
  store:store(300,300),hits:300,hitsMax:300,
  getActiveBodyparts(type){return type==='carry'?5:0;}
 }));
 room.creeps=[repairer,...carriers];
 const state={room,rcl:6,spawn,spawns:[spawn],towers,structures:room.structures,
  hostileCreeps:room.hostiles,creeps:room.creeps,
  energyStored:storedEnergy,energyAvailable:roomEnergy,
  energyCapacityAvailable:1050,emergency:false,byRole:{repairer:1,hauler:haulers,worker:1,defender:2}};
 const sim={counts,room,spawn,extension,shield,towers,repairer,carriers,
  storage,state,tick:0,log:[]};
 return sim;
}
function simulateTick(sim,enemy,{cutHaulers=false,starveSource=false}={}){
 currentSim=sim;sim.tick++;
 sim.room.hostiles=enemy?[enemy]:[];
 sim.state.hostileCreeps=sim.room.hostiles;
 sim.room.creeps=cutHaulers?[sim.repairer]:
  [sim.repairer,...sim.carriers];
 sim.state.creeps=sim.room.creeps;
 sim.state.byRole.hauler=cutHaulers?0:sim.carriers.length;
 // Execute the REAL tower and repairer policies; only their environment is
 // simulated. A Tower action is just an attempt; attacks NEVER kill enemies.
 const beforeEnergy=sim.repairer.store.energy;
 const beforeWorking=sim.repairer.memory.working;
 towerAI.run(sim.state);
 workerAI.run(sim.repairer);
 if(!beforeWorking && sim.repairer.memory.working &&
     beforeEnergy>0 && enemy)
   sim.counts.partialLoadResumes++;
 // Real logistics target policy is used; settlement is a deterministic
 // simplified warehouse/hauler transfer, not a Screeps server receipt.
 for(const carrier of cutHaulers?[]:sim.carriers) {
  const targets=energy.deliveryTargets(carrier);
  if(targets.length && carrier.store.energy>0) {
   const target=targets[0];
   const moved=Math.min(100,carrier.store.energy,
     target.store.getFreeCapacity());
   carrier.store.energy-=moved;target.store.energy+=moved;
   if(target===sim.spawn)sim.counts.spawnRefills+=moved;
   if(sim.towers.includes(target))sim.counts.towerRefills+=moved;
  }
  if(!starveSource) {
   const take=Math.min(100,carrier.store.getFreeCapacity(),
     sim.storage.store.energy);
   sim.storage.store.energy-=take;carrier.store.energy+=take;
  }
 }
 if(enemy){
  // Hostile damage is applied AFTER owned intents (same-tick simplified
  // resolution). Combat body parts remain active for the worst-case raid.
  const damage=policyDamage(enemy,sim.shield);
  if(damage>0){
   if(sim.room.structures.includes(sim.shield)){
    const absorbed=Math.min(sim.shield.hits,damage);
    sim.shield.hits-=absorbed;sim.counts.netShieldDamage+=absorbed;
    if(sim.shield.hits<=0){
      sim.counts.shieldBreached=true;
      if(sim.counts.firstBreachTick===null)
        sim.counts.firstBreachTick=sim.tick;
      sim.room.structures=sim.room.structures.filter(s=>s!==sim.shield);
      sim.state.structures=sim.room.structures;
    }
   }else{
    sim.spawn.hits=Math.max(0,sim.spawn.hits-damage);
    sim.counts.spawnHitsLost+=damage;
   }
  }
 }
 sim.log.push({tick:sim.tick,enemy:enemy?.id||'none',
  shieldHits:sim.room.structures.includes(sim.shield)?sim.shield.hits:0,
  spawnHits:sim.spawn.hits,towerAmmo:sim.towers.reduce((n,t)=>n+t.store.energy,0),
  repairerEnergy:sim.repairer.store.energy,haulers:cutHaulers?0:sim.carriers.length});
 currentSim=null;
}
function policyDamage(enemy,target){
 let total=0,range=enemy.pos.getRangeTo(target);
 for(const p of enemy.body){
  if(p.hits<=0)continue;
  const scale=p.boost?4:1;
  if(range<=1&&p.type==='work')total+=50*scale;
  if(range<=1&&p.type==='attack')total+=30*scale;
  if(range<=3&&p.type==='ranged_attack')total+=10*scale;
 }
 return total;
}

// Phase A: harmless scouts must consume no combat ammo or produce repair
// escalation even when the initially built protective shield is weak.
{
 const s=scene({shieldHits:400});
 for(let i=0;i<8;i++)simulateTick(s,EVENT_WAVES[0].hostile());
 assert.equal(s.counts.towerAttack,0);
 assert.equal(s.counts.scoutShots,0);
 assert.equal(s.counts.shieldBreached,false);
 assert.equal(s.spawn.hits,5000);
}
// Phase B: one active unboosted dismantler, one ready Hauler, a partially
// energized D12 repairer. Verify real policy does eventually respond; no
// test can infer tower kills or real game victory.
{
 const s=scene({shieldHits:400,repairerEnergy:40});
 for(let i=0;i<26;i++)simulateTick(s,EVENT_WAVES[1].hostile());
 assert.ok(s.counts.towerAttack>0,
  'actual Tower AI must issue combat attempts against armed attacker');
 assert.equal(s.counts.scoutShots,0);
 assert.ok(s.counts.partialLoadResumes>=1,
  'D12 partial-load repairer should react by imminent threshold');
 assert.ok(s.counts.shieldRepair>=1,
  'real role.worker policy must attempt emergency Rampart repairs');
 assert.ok(!s.counts.shieldBreached,
  'simplified 50/tick WORK raid is supportable with working supply');
 assert.equal(s.spawn.hits,5000);
 assert.equal(s.counts.attemptedRepairWithoutEnergy,0);
 console.log('D13_SCENARIO_SINGLE_DISMANTLER '+JSON.stringify({
  ticks:s.tick,simulatedShieldSurvived:!s.counts.shieldBreached,
  repairAttempts:s.counts.shieldRepair,
  towerAttackAttempts:s.counts.towerAttack,
  partialLoadResumes:s.counts.partialLoadResumes,
  finalShieldHits:s.shield.hits,
  simulatedSource:'OFFLINE_WORST_CASE_NO_ENEMY_DEATH_NO_SAFEMODE'}));
}
// Phase C: boosted 3-WORK saturation overwhelms one repairer. This is
// EXPECTED VULNERABILITY, not a test failure or an actual colony loss.
{
 const s=scene({shieldHits:1000,repairerEnergy:45});
 for(let i=0;i<12;i++)simulateTick(s,EVENT_WAVES[2].hostile());
 assert.equal(s.counts.shieldBreached,true,
  'simulation must expose vulnerability against heavily boosted WORK');
 assert.ok(s.counts.spawnHitsLost>0,
  'under sustained unkillable boosted attacker model, core takes damage');
 assert.equal(s.counts.scoutShots,0);
 console.log('D13_SCENARIO_BOOSTED_SATURATION '+JSON.stringify({
  ticks:s.tick,simulatedShieldBreached:s.counts.shieldBreached,
  firstBreachTick:s.counts.firstBreachTick,
  simulatedSpawnDamage:s.counts.spawnHitsLost,
  towerAttackAttempts:s.counts.towerAttack,
  scope:'OFFLINE_VULNERABILITY_NO_ENEMY_DAMAGE_RESOLUTION_OR_SAFEMODE'}));
}
// Phase D: lost Hauler and low Tower energy force no repairer special
// diversion. Prove the actual hard infrastructure target order survives.
{
 const s=scene({shieldHits:800,repairerEnergy:20,haulers:1,
  towerAmmo:200,roomEnergy:400});
 s.spawn.store.energy=50;
 let previousEnergy=s.repairer.store.energy;
 for(let i=0;i<20;i++)simulateTick(s,EVENT_WAVES[3].hostile(),
  {cutHaulers:true,starveSource:true});
 assert.equal(s.counts.partialLoadResumes,0,
  'cannot claim last-second partial repair protection without live Hauler');
 assert.equal(s.counts.towerRefills,0);
 assert.equal(s.counts.spawnRefills,0);
 assert.ok(s.counts.towerAttack>0);
 assert.equal(s.counts.attemptedRepairWithoutEnergy,0);
 assert.ok(s.repairer.store.energy<=previousEnergy);
 const supplyHauler={...s.carriers[0],room:s.room,
  pos:position(14),store:store(300,100)};
 const targets=energy.deliveryTargets(supplyHauler);
 assert.equal(targets[0],s.spawn,
  'actual logistics keeps critically depleted Spawn energy ahead of Tower');
 assert.ok(targets.findIndex(t=>s.towers.includes(t))>=1);
 console.log('D13_SCENARIO_HAULER_LOSS '+JSON.stringify({
  ticks:s.tick,noReadyHaulerRepairerOverrides:s.counts.partialLoadResumes===0,
  towerAttackAttempts:s.counts.towerAttack,
  towerAmmo:s.towers.reduce((n,t)=>n+t.store.energy,0),
  hypotheticalSpawnEnergy:s.spawn.store.energy,
  scope:'OFFLINE_HAULER_LOSS_NO_ENEMY_DAMAGE_RESOLUTION_OR_SAFEMODE'}));
}
// Phased long campaign: validate 75 successive synthetic game steps,
// including attacker changes, missing Hauler windows and peaceful recovery.
{
 const s=scene({shieldHits:6000,repairerEnergy:30,towerAmmo:900,
  storedEnergy:30000});
 for(const wave of EVENT_WAVES)for(let i=0;i<wave.duration;i++)
  simulateTick(s,wave.hostile(),
   {cutHaulers:wave.label==='supply_interruption_with_ranged_fire'&&i<8,
    starveSource:wave.label==='supply_interruption_with_ranged_fire'});
 const expected=EVENT_WAVES.reduce((sum,x)=>sum+x.duration,0);
 assert.equal(s.log.length,expected);
 assert.equal(s.tick,expected);
 assert.equal(s.counts.scoutShots,0);
 assert.ok(s.counts.towerAttack>0);
 assert.equal(s.counts.shieldBreached,false,
  'prefortified 75-tick case remains intact in this synthetic model; separate saturation test proves failure case');
 assert.ok(s.log.every(row=>Number.isSafeInteger(row.towerAmmo)&&row.towerAmmo>=0));
 assert.ok(s.log.every(row=>Number.isSafeInteger(row.spawnHits)&&row.spawnHits>=0));
 assert.ok(s.log.every(row=>Number.isSafeInteger(row.repairerEnergy)&&row.repairerEnergy>=0));
 console.log('D13_SCENARIO_75_TICK_CAMPAIGN '+JSON.stringify({
  ticks:s.tick,phases:EVENT_WAVES.map(w=>w.label),
  syntheticBreach:s.counts.shieldBreached,
  firstBreachTick:s.counts.firstBreachTick,
  repairAttempts:s.counts.shieldRepair,
  towerAttackAttempts:s.counts.towerAttack,
  towerRepairAttempts:s.counts.towerRepair,
  scope:'OFFLINE_MODEL_NOT_LIVE_SIEGE_OR_SETTLED_EVENTS'}));
}
console.log('D13 multistage adversarial siege campaign: REAL bot policy exercised against SYNTHETIC engine with known boosted-overwhelm and lost-hauler limits PASS');
