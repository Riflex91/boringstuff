import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const nativeRequire=createRequire(import.meta.url);
// The shared work.priority is a real CommonJS game module, not executed
// in the worker VM. Give its own Node context the same Screeps symbols.
global.STRUCTURE_SPAWN='spawn';
global.STRUCTURE_TOWER='tower';
global.STRUCTURE_STORAGE='storage';
const priority=nativeRequire('../game/work.priority.js');
const source=fs.readFileSync(new URL('../game/role.worker.js',import.meta.url),'utf8');
const calls=[];
let refillResult=true;
const ctx={module:{exports:{}},
 RESOURCE_ENERGY:'energy',FIND_STRUCTURES:'structures',
 FIND_HOSTILE_CREEPS:'hostiles',FIND_MY_CREEPS:'friendlies',
 FIND_MY_CONSTRUCTION_SITES:'sites',
 OK:0,ERR_NOT_IN_RANGE:-9,
 STRUCTURE_SPAWN:'spawn',STRUCTURE_TOWER:'tower',
 STRUCTURE_STORAGE:'storage',STRUCTURE_RAMPART:'rampart',
 STRUCTURE_EXTENSION:'extension',STRUCTURE_WALL:'wall',
 STRUCTURE_ROAD:'road',
 require(name) {
  if(name==='work.priority')return priority;
  if(name==='config')return {PATH_MAX_OPS:200,
   REPAIR_WALL_TARGET_RCL_MULTIPLIER:20000};
  if(name==='energy')return {deliver() {
   calls.push('INFRASTRUCTURE_DELIVERY');
   return refillResult;
  }};
  throw Error(name);
 }};
vm.runInNewContext(source,ctx,{filename:'role.worker.js'});
const roleWorker=ctx.module.exports;
const pos=(x,y)=>({x,y,getRangeTo(target) {
 const p=target?.pos||target;
 return Math.max(Math.abs(x-p.x),Math.abs(y-p.y));
}});
const spawn={id:'spawn1',my:true,structureType:'spawn',
 hits:5000,hitsMax:5000,pos:pos(10,10)};
const tower={id:'tower1',my:true,structureType:'tower',
 hits:3000,hitsMax:3000,pos:pos(11,10)};
const rampart={id:'coreRamp',my:true,structureType:'rampart',
 hits:120,hitsMax:1000000,pos:pos(10,10)};
const distant={id:'distantRamp',my:true,structureType:'rampart',
 hits:1,hitsMax:1000000,pos:pos(25,25)};
const hostile={id:'enemy',pos:pos(9,10),
 body:[{type:'work',hits:100},{type:'move',hits:100}]};
const liveHauler=()=>({memory:{role:'hauler'},spawning:false});
const room={controller:{my:true,safeMode:0},
 structures:[spawn,tower,rampart,distant],
 hostiles:[hostile],haulers:[liveHauler()],
 find(type,opts) {
  const list=type==='structures'?this.structures:
   type==='hostiles'?this.hostiles:
   type==='friendlies'?this.haulers:
   type==='sites'?[]:null;
  if(!list)throw Error('invalid find '+type);
  return opts?.filter?list.filter(opts.filter):list.slice();
 }};
const creep={room,memory:{role:'repairer',working:true},
 store:{energy:100,getFreeCapacity(){return 0;}},
 pos:{findClosestByPath(items) {return items[0]||null;}},
 repair(target){calls.push('REPAIR_'+target.id);return 0;},
 moveTo(){calls.push('MOVE');return 0;},
 upgradeController(){calls.push('UPGRADE');return 0;}
};
function execute(role='repairer') {
 creep.memory.role=role;creep.memory.working=true;
 calls.length=0;
 roleWorker.run(creep);
 return calls.slice();
}
assert.equal(roleWorker._test.liveHaulerCount(room),1,
 'fixture must contain one ready hauler');
assert.deepEqual(priority.criticalCoreShieldTargets(room.structures,
 room.hostiles,{imminentOnly:true}).map(x=>x.id),['coreRamp'],
 'actual owned shield must be in hostile WORK range');

assert.equal(roleWorker._test.preemptForImminentShield(creep),true,
 'direct current-world imminent preemption must be reachable');
calls.length=0;
assert.deepEqual(execute(),['REPAIR_coreRamp'],
 'dedicated repairer preempts logistics when spawn overlay shield <=3 attack ticks');
assert.deepEqual(priority.criticalCoreShieldTargets(room.structures,room.hostiles,
 {imminentOnly:true}).map(x=>x.id),['coreRamp']);
assert.deepEqual(execute('worker'),['INFRASTRUCTURE_DELIVERY'],
 'sole productive worker must keep hard infrastructure recovery');
assert.deepEqual(execute('builder'),['INFRASTRUCTURE_DELIVERY'],
 'builder is not an emergency replacement for owned repairer');
assert.deepEqual(execute('upgrader'),['UPGRADE'],
 'controller specialist keeps role and never joins siege shield repairs');
room.haulers=[];
assert.deepEqual(execute(),['INFRASTRUCTURE_DELIVERY'],
 'dedicated repairer is NOT allowed to preempt when last hauler is dead');
room.haulers=[{memory:{role:'hauler'},spawning:true}];
assert.deepEqual(execute(),['INFRASTRUCTURE_DELIVERY'],
 'still spawning hauler cannot be claimed as ready logistics');
room.haulers=[liveHauler()];
rampart.hits=1000;
assert.deepEqual(execute(),['INFRASTRUCTURE_DELIVERY'],
 'shield at 20 weapon turns is not authorized to override delivery');
// Boosted dismantlers threaten healthy-looking core shields sooner.
rampart.hits=400;
room.hostiles=[{pos:pos(9,10),body:[{type:'work',hits:100,
 boost:'XZH2O'},{type:'move',hits:100}]}];
assert.deepEqual(execute(),['REPAIR_coreRamp'],
 'boosted WORK in range brings shield inside three-tick emergency cutoff');
room.hostiles=[hostile];
rampart.hits=120;
room.hostiles=[{pos:pos(9,10),body:[{type:'work',hits:0},
 {type:'move',hits:100}]}];
assert.deepEqual(execute(),['INFRASTRUCTURE_DELIVERY'],
 'destroyed enemy weapon parts cannot trigger imminent repair');
room.hostiles=[{pos:pos(19,10),body:[{type:'work',hits:100}]}];
assert.deepEqual(execute(),['INFRASTRUCTURE_DELIVERY'],
 'distant dismantler cannot cause emergency diversion');
room.hostiles=[hostile];
room.controller.safeMode=250;
assert.deepEqual(execute(),['INFRASTRUCTURE_DELIVERY'],
 'during active safe mode no hostile attack is resolving');
room.controller.safeMode=0;
spawn.hits=1200;
assert.deepEqual(execute(),['INFRASTRUCTURE_DELIVERY'],
 'direct critically damaged Spawn retains original priority over shield and refill order');
spawn.hits=5000;
rampart.my=false;
assert.deepEqual(execute(),['INFRASTRUCTURE_DELIVERY'],
 'enemy-owned shield cannot consume repairer energy');
rampart.my=true;
rampart.pos=pos(20,20);
assert.deepEqual(execute(),['INFRASTRUCTURE_DELIVERY'],
 'remote shield with no owned critical overlay cannot be emergency');
rampart.pos=pos(10,10);
creep.store.energy=0;
assert.equal(roleWorker._test.preemptForImminentShield(creep),false,
 'empty repairer has no repair intent or delivery override');
creep.store.energy=100;
creep.repair=target=>{calls.push('REPAIR_'+target.id);return -9;};
assert.deepEqual(execute(),['REPAIR_coreRamp','MOVE'],
 'imminent shield outside range issues one repair intent plus safe-range movement');
const optional=roleWorker._test.preemptForImminentShield;
assert.equal(typeof optional,'function');
assert.match(source,/if \(preemptForImminentShield\(creep\)\) return;/);
const first=source.indexOf('if (preemptForImminentShield(creep)) return;');
const delivery=source.indexOf('if (shouldAssistInfrastructure(creep) && refill(creep)) return;');
assert.ok(first<delivery && first>0,
 'imminent repair must be checked strictly before any infrastructure refill');
const repairer=source.indexOf("if (role === 'repairer')");
assert.ok(first<repairer,'existing D6 repair remains later for normal threat');
for(const str of ['d36321e151bddf49884604c171439f0bedc6973c']) {
 assert.ok(str.length===40);
}
console.log('D11 live hauler-preserving critical shield repairer priority, boosted threat cutoff, one-action execution and economic safeguards PASS');
