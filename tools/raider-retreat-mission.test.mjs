import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../game/role.raider.js',import.meta.url),'utf8');
const makeMission=()=>({schemaVersion:1,id:'raid-E1N1-E1N2-1000',
  phase:'ATTACKING',parent:'E1N1',target:'E1N2',aggressor:'Enemy',
  createdTick:1000,targetOwnerSeenTick:990,route:['E1N1','E1N2']});
let enemies=[],towers=[],homeEnemies=[],attacks=[],moves=[],rc=0,parts=2;
const home={name:'E1N1',controller:{my:true,safeMode:0,safeModeCooldown:0},
  find(type){return homeEnemies;}};
const target={name:'E1N2',
  controller:{my:false,owner:{username:'Enemy'},safeMode:0},
  find(type){return type===1?enemies:towers;}};
const game={time:1000,rooms:{E1N1:home,E1N2:target},
  map:{describeExits(room) {
    return room==='E1N1'?{3:'E1N2'}:{7:'E1N1'};
  },findExit(){return 9;}}};
const memory={bot:{counterattackMission:makeMission(),
  combatAggressionEvidence:{schemaVersion:1,records:[
    {player:'Enemy',room:'E1N1',tick:900,armedParts:3}
  ]}}};
const ctx={module:{exports:{}},require(name) {
  if(name==='config')return {PATH_MAX_OPS:200};
  throw Error('Unexpected '+name);
},Game:game,Memory:memory,
  FIND_HOSTILE_CREEPS:1,FIND_HOSTILE_STRUCTURES:2,
  STRUCTURE_TOWER:'tower',ATTACK:'attack',
  ERR_NOT_IN_RANGE:-9,ERR_BUSY:-4,OK:0};
vm.runInNewContext(source,ctx);
const role=ctx.module.exports;
const enemy=(id,username,types)=>({
  id,owner:{username},pos:{x:10,y:10},
  body:types.map(type=>({type,hits:100}))
});
const healer=enemy('enemy-healer','Enemy',['heal','move']);
const striker=enemy('enemy-attacker','Enemy',['attack','move']);
const neutral=enemy('neutral','Other',['move']);
const creep={room:target,hits:100,hitsMax:100,ticksToLive:350,
  memory:{role:'raider',combatMissionId:makeMission().id},
  pos:{getRangeTo(target){return target.id==='enemy-healer'?2:3;},
    findClosestByRange(){return {id:'exit'};}},
  getActiveBodyparts(type){assert.equal(type,'attack');return parts;},
  attack(t){attacks.push(t.id);return rc;},
  moveTo(t,opts){moves.push({id:t.id,opts});return 0;}
};
function reset(){
  memory.bot.counterattackMission=makeMission();
  memory.bot.combatAggressionEvidence={schemaVersion:1,records:[
    {player:'Enemy',room:'E1N1',tick:900,armedParts:3}
  ]};
  game.time=1000;game.rooms.E1N1=home;game.rooms.E1N2=target;
  homeEnemies=[];home.controller.safeMode=0;
  home.controller.safeModeCooldown=0;
  target.controller={my:false,owner:{username:'Enemy'},safeMode:0};
  creep.room=target;creep.hits=100;creep.ticksToLive=350;
  creep.memory={role:'raider',combatMissionId:makeMission().id};
  enemies=[healer,striker];towers=[];attacks=[];moves=[];rc=0;parts=2;
}
reset();role.run(creep);
assert.deepEqual(attacks,['enemy-healer'],
  'armed healer support is prioritised over other raiders');
assert.equal(moves.length,0);
reset();rc=-9;role.run(creep);
assert.deepEqual(attacks,['enemy-healer']);
assert.equal(moves.length,1);
assert.equal(moves[0].id,'enemy-healer');
assert.equal(moves[0].opts.maxRooms,1);
assert.equal(moves[0].opts.maxOps,200);
reset();creep.memory.combatMissionId='foreign';
role.run(creep);assert.equal(attacks.length,0);
reset();memory.bot.combatAggressionEvidence.records=[];
role.run(creep);assert.equal(attacks.length,0,
  'no verified prior armed incursion means no raid authorization');
reset();memory.bot.counterattackMission.id='raid-E9N9-E1N2-1000';
creep.memory.combatMissionId='raid-E9N9-E1N2-1000';
role.run(creep);assert.equal(attacks.length,0);
reset();target.controller.owner.username='Neutral';
role.run(creep);assert.equal(attacks.length,0);
assert.equal(memory.bot.counterattackMission.phase,'RETREAT');
assert.equal(memory.bot.counterattackMission.reason,
  'TARGET_OWNERSHIP_OR_SAFE_MODE_CHANGED');
assert.equal(moves.length,1,'wrong owner makes raider withdraw');
reset();target.controller.my=true;role.run(creep);
assert.equal(memory.bot.counterattackMission.phase,'RETREAT');
reset();target.controller.safeMode=100;role.run(creep);
assert.equal(memory.bot.counterattackMission.phase,'RETREAT');
reset();towers=[{id:'enemy-tower',structureType:'tower'}];
role.run(creep);assert.equal(attacks.length,0);
assert.equal(memory.bot.counterattackMission.reason,
  'ENEMY_TOWER_OR_UNVERIFIED_DEFENSE');
reset();enemies=[neutral,healer];role.run(creep);
assert.equal(attacks.length,0,'third party cannot be attacked');
assert.equal(memory.bot.counterattackMission.reason,
  'UNEXPECTED_THIRD_PARTY');
reset();homeEnemies=[neutral];role.run(creep);
assert.equal(attacks.length,0);
assert.equal(memory.bot.counterattackMission.reason,
  'HOME_DEFENSE_RECALLED');
reset();home.controller.safeMode=100;role.run(creep);
assert.equal(memory.bot.counterattackMission.phase,'RETREAT');
reset();home.controller.safeModeCooldown=100;role.run(creep);
assert.equal(memory.bot.counterattackMission.phase,'RETREAT');
reset();creep.hits=70;role.run(creep);
assert.equal(memory.bot.counterattackMission.reason,
  'CASUALTY_OR_TTL_ABORT');
reset();creep.ticksToLive=149;role.run(creep);
assert.equal(memory.bot.counterattackMission.reason,
  'CASUALTY_OR_TTL_ABORT');
reset();parts=0;role.run(creep);
assert.equal(memory.bot.counterattackMission.reason,
  'NO_ACTIVE_ATTACK_CAPABILITY');
reset();creep.room=home;role.run(creep);
assert.equal(moves.length,1);
assert.equal(moves[0].id,'exit');
assert.equal(moves[0].opts.maxRooms,1);
reset();creep.room={name:'E9N9',controller:target.controller,
  find:target.find};role.run(creep);
assert.equal(memory.bot.counterattackMission.reason,
  'OFF_APPROVED_ROUTE');
assert.equal(attacks.length,0);
reset();enemies=[];for(let i=0;i<10;i++)role.run(creep);
assert.equal(memory.bot.counterattackMission.phase,'RETREAT');
assert.equal(memory.bot.counterattackMission.reason,
  'NO_VERIFIED_AGGRESSOR_TARGET');
reset();game.time=1902;role.run(creep);
assert.equal(attacks.length,0,'old raid never attacks after expiry');
console.log('U11 mission-only raider target identity and retreat tests PASS');
