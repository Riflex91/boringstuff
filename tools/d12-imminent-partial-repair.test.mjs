import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const nodeRequire=createRequire(import.meta.url);
// The real commonJS policy is executed in host Node, unlike the Creep
// handler VM. Its actual Screeps global constants must be installed here.
global.STRUCTURE_SPAWN='spawn';
global.STRUCTURE_TOWER='tower';
global.STRUCTURE_STORAGE='storage';
const priority=nodeRequire('../game/work.priority.js');
const source=fs.readFileSync(new URL('../game/role.worker.js',import.meta.url),'utf8');
const events=[];
const supply={acquire(){events.push('BASELINE_ACQUIRE');return true;},
 acquireForConsumer(){events.push('BASELINE_HAULER_WAIT');return true;},
 deliver(){events.push('DELIVER_INFRASTRUCTURE');return true;}};
const ctx={module:{exports:{}},
 RESOURCE_ENERGY:'energy',WORK:'work',
 FIND_STRUCTURES:'structures',FIND_HOSTILE_CREEPS:'hostiles',
 FIND_MY_CREEPS:'friendlies',FIND_MY_CONSTRUCTION_SITES:'sites',
 OK:0,ERR_NOT_IN_RANGE:-9,
 STRUCTURE_SPAWN:'spawn',STRUCTURE_TOWER:'tower',
 STRUCTURE_STORAGE:'storage',STRUCTURE_RAMPART:'rampart',
 STRUCTURE_EXTENSION:'extension',STRUCTURE_WALL:'wall',
 STRUCTURE_ROAD:'road',
 require(name){if(name==='work.priority')return priority;
  if(name==='config')return {PATH_MAX_OPS:200,CONSUMER_HAULER_WAIT_TICKS:12,
   REPAIR_WALL_TARGET_RCL_MULTIPLIER:25000};
  if(name==='energy')return supply;
  throw Error('unexpected require '+name);}
};
vm.runInNewContext(source,ctx,{filename:'role.worker.js'});
const worker=ctx.module.exports;
const pos=(x,y)=>({x,y,getRangeTo(target) {
 const p=target?.pos||target;
 return Math.max(Math.abs(x-p.x),Math.abs(y-p.y));
}});
const own=(id,type,x,hits=5000)=>({
 id,my:true,structureType:type,pos:pos(x,10),hits,hitsMax:5000});
const spawn=own('spawn','spawn',10);
const tower=own('tower','tower',12);
const shield={id:'spawn-shield',my:true,structureType:'rampart',
 pos:pos(10,10),hits:100,hitsMax:100000};
const armed={pos:pos(9,10),body:[{type:'work',hits:100},
 {type:'move',hits:100}]};
const hauler={spawning:false,memory:{role:'hauler'}};
const room={controller:{my:true,safeMode:0},structures:[spawn,tower,shield],
 hostiles:[armed],haulers:[hauler],
 find(type,opts) {
  const list=type==='structures'?this.structures:
   type==='hostiles'?this.hostiles:
   type==='friendlies'?this.haulers:
   type==='sites'?[]:null;
  if(!list)throw Error('unknown Room.find '+type);
  return opts?.filter?list.filter(opts.filter):list.slice();
 }};
const creep={room,memory:{role:'repairer',working:false,waitingEnergyTicks:5,
  logisticsFallback:false},
 store:{energy:25,getFreeCapacity(){return 100-this.energy;}},
 pos:{findClosestByPath(items){return items?.[0]||null;}},
 getActiveBodyparts(part){return part==='work'?1:0;},
 repair(target){events.push('REPAIR_'+target.id);return 0;},
 moveTo(){events.push('MOVE');return 0;},
 upgradeController(){events.push('UPGRADE');return 0;}
};
function reset({role='repairer',energy=25,working=false}={}) {
 events.length=0;
 creep.memory={role,working,waitingEnergyTicks:5,logisticsFallback:false};
 creep.store.energy=energy;
}
function act(){worker.run(creep);return events.slice();}
reset();
assert.deepEqual(act(),['REPAIR_spawn-shield'],
 'a partial-load dedicated repairer must act this tick on imminent Spawn shield');
assert.equal(creep.memory.working,true);
assert.equal(creep.memory.waitingEnergyTicks,0);
assert.equal(creep.store.energy,25,
 'test intents cannot fabricate game-settled energy consumption');
assert.equal(events.some(e=>e.startsWith('BASELINE_')),false,
 'D12 avoids waiting for full delivery ONLY under verified imminent siege');
reset({working:true});
assert.deepEqual(act(),['REPAIR_spawn-shield'],
 'already loaded D11 repairer retains legacy emergency behavior');
reset({role:'worker'});
assert.deepEqual(act(),['BASELINE_HAULER_WAIT'],
 'sole productive worker is never promoted into D12 siege duty');
reset({role:'builder'});
assert.deepEqual(act(),['BASELINE_HAULER_WAIT'],
 'builder must not sacrifice construction/hauler recovery');
reset({role:'upgrader'});
assert.deepEqual(act(),['BASELINE_HAULER_WAIT'],
 'upgrader remains in its established gather routine');
room.haulers=[];
reset();
assert.deepEqual(act(),['BASELINE_ACQUIRE'],
 'with no ready Hauler, original independent fallback takes precedence');
assert.equal(creep.memory.working,false);
room.haulers=[{spawning:true,memory:{role:'hauler'}}];
reset();
assert.deepEqual(act(),['BASELINE_ACQUIRE'],
 'a still-spawning Hauler cannot falsely guarantee energy logistics');
room.haulers=[hauler];
room.controller.safeMode=100;
reset();
assert.deepEqual(act(),['BASELINE_HAULER_WAIT']);
room.controller.safeMode=0;
shield.hits=1500;
reset();
assert.deepEqual(act(),['BASELINE_HAULER_WAIT'],
 'non-imminent core shield does not interrupt regular energy acquisition');
shield.hits=100;
room.hostiles=[{pos:pos(9,10),body:[{type:'work',hits:0},
 {type:'move',hits:100}]}];
reset();
assert.deepEqual(act(),['BASELINE_HAULER_WAIT'],
 'dead enemy weapon cannot trigger crisis state transition');
room.hostiles=[{pos:pos(25,10),body:[{type:'work',hits:100}]}];
reset();
assert.deepEqual(act(),['BASELINE_HAULER_WAIT'],
 'remote dismantler does not authorize switching to siege repair');
room.hostiles=[armed];
shield.my=false;
reset();
assert.deepEqual(act(),['BASELINE_HAULER_WAIT'],
 'enemy-owned shield cannot trigger own defensive repair priority');
shield.my=true;
shield.pos=pos(18,10);
reset();
assert.deepEqual(act(),['BASELINE_HAULER_WAIT'],
 'non-core rampart does not qualify');
shield.pos=pos(10,10);
spawn.hits=1000;
reset();
assert.deepEqual(act(),['BASELINE_HAULER_WAIT'],
 'existing directly critical Spawn repair remains senior to shield promotion');
spawn.hits=5000;
reset({energy:0});
assert.deepEqual(act(),['BASELINE_HAULER_WAIT'],
 'accepted but unsettled energy-transfer intent is never treated as energy');
assert.equal(creep.memory.working,false);
reset({energy:25});
creep.getActiveBodyparts=()=>0;
assert.deepEqual(act(),['BASELINE_HAULER_WAIT'],
 'Creep with no active WORK must not claim to repair shields');
creep.getActiveBodyparts=(part)=>part==='work'?1:0;
reset({energy:25});
creep.memory.lastHaulerIntentTick=505;
creep.memory.lastHaulerIntentEnergy=25;
// Different or same-tick accepted transfer intents cannot themselves
// alter the evidence, but actually carried energy is authoritative.
assert.deepEqual(act(),['REPAIR_spawn-shield']);
assert.equal(creep.memory.working,true);
assert.equal(creep.memory.lastHaulerIntentEnergy,25,
 'existing delivery reconciliation metadata remains untouched');
const helper=worker._test.resumePartialLoadForImminentShield;
assert.equal(typeof helper,'function');
assert.equal(source.indexOf('resumePartialLoadForImminentShield(creep);')<
 source.indexOf('if (needsEnergy(creep))'),
 'D12 must check real partial energy BEFORE the 12-tick gather wait');
console.log('D12 partially loaded critical repairer immediate rescue, 1-hauler supply guard and no false siege regression PASS');
