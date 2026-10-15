import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../game/role.defender.js',import.meta.url),'utf8');
const context={
  module:{exports:{}},
  Game:{},
  require(name) {
    if(name==='config')return {PATH_MAX_OPS:200};
    if(name==='defense.regional.live')return {run(){return false;}};
    throw new Error('unexpected import: '+name);
  },
  FIND_HOSTILE_CREEPS:1,FIND_MY_STRUCTURES:2,FIND_MY_SPAWNS:3,
  STRUCTURE_SPAWN:'spawn',STRUCTURE_STORAGE:'storage',
  STRUCTURE_TOWER:'tower',ERR_NOT_IN_RANGE:-9
};
vm.runInNewContext(source,context);
const role=context.module.exports;
const spawn={id:'base',structureType:'spawn',pos:{x:10,y:10}};
const hostile=(id,parts,dist)=>({id,
  body:parts.map(type=>typeof type==='string'
    ?{type,hits:100}:type),
  pos:{getRangeTo(){return dist;}}});
const scout=hostile('scout',['move'],1);
const dead=hostile('dead',[{type:'attack',hits:0}],1);
const striker=hostile('striker',['attack','move'],1);
const distantHealer=hostile('healer',['heal','move'],15);
const distantRanged=hostile('ranged',['ranged_attack','move'],11);
let enemies=[scout],ordered=[],attacks=[],moves=[],rc=0;
const room={find(type){
  if(type===1)return enemies;
  if(type===2)return [spawn];
  if(type===3)return [spawn];
  throw new Error('unexpected FIND type: '+type);
}};
const creep={room,pos:{
  findClosestByPath(list,opts) {
    assert.equal(opts.maxOps,200,'defensive path search remains bounded');
    ordered=list.map(x=>x.id);
    return list[0]||null;
  },
  getRangeTo(){return 9;}
},
attack(target){attacks.push(target.id);return rc;},
moveTo(target,opts){moves.push([target.id,opts]);return 0;}
};
assert.equal(role._test.threatScore(scout,[spawn]),-Infinity);
assert.equal(role._test.threatScore(dead,[spawn]),-Infinity);
role.run(creep);
assert.deepEqual(attacks,[]);
assert.deepEqual(moves.map(x=>x[0]),['base'],
  'unarmed scout must not lure defender away from owned spawn');
moves=[];
enemies=[dead,scout];
role.run(creep);
assert.deepEqual(attacks,[]);
moves=[];
enemies=[distantHealer,striker,scout,distantRanged];
role.run(creep);
assert.deepEqual(ordered,['striker','healer','ranged'],
  'immediate core striker outranks distant healer and ranged attackers');
assert.deepEqual(attacks,['striker']);
assert.deepEqual(moves,[]);
rc=-9;
role.run(creep);
assert.deepEqual(attacks,['striker','striker']);
assert.equal(moves.length,1);
assert.equal(moves[0][0],'striker');
assert.equal(moves[0][1].maxRooms,1,
  'defender may not chase beyond owned home room');
assert.equal(moves[0][1].maxOps,200);
moves=[];attacks=[];
enemies=[distantHealer,distantRanged,scout];
rc=0;
role.run(creep);
assert.deepEqual(ordered,['healer','ranged'],
  'active healer support remains a hostile combat target');
assert.deepEqual(attacks,['healer']);
enemies=[scout];
role.run(creep);
assert.deepEqual(attacks,['healer'],'harmless creep excluded after raid');
assert.deepEqual(moves.map(x=>x[0]),['base']);
// A defender with surviving RANGED_ATTACK parts must issue actual ranged
// intents, never melee-only attack calls from an incompatible body.
moves=[];attacks=[];enemies=[distantRanged];rc=0;
const rangedAttacks=[];
creep.body=[{type:'ranged_attack',hits:100}];
creep.rangedAttack=target=>{rangedAttacks.push(target.id);return rc;};
role.run(creep);
assert.deepEqual(rangedAttacks,['ranged']);
assert.deepEqual(attacks,[]);
rc=-9;
role.run(creep);
assert.equal(moves.at(-1)[0],'ranged');
assert.equal(moves.at(-1)[1].maxRooms,1);
assert.equal(moves.at(-1)[1].maxOps,200);
creep.body=[{type:'ranged_attack',hits:0},{type:'attack',hits:100}];
rc=0;
role.run(creep);
assert.deepEqual(attacks,['ranged'],
  'disabled ranged part must not be treated as armed');
enemies=[scout];
const before=rangedAttacks.length;
role.run(creep);
assert.equal(rangedAttacks.length,before,'never fire at an unarmed scout');
console.log('D1 active defender core-threat targeting PASS');
