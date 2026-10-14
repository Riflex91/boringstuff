import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const src=fs.readFileSync(new URL('../game/role.claimer.js',import.meta.url),'utf8');
const m=()=>({
  schemaVersion:1,id:'mission-1',phase:'CLAIMING',
  parent:'E1N1',target:'E1N2',
  route:['E1N1','E1N2'],createdTick:900
});
const home={name:'E1N1',controller:{my:true,safeMode:0,safeModeCooldown:0},
  find(type){return [];}};
const neutral={pos:{x:22,y:22},level:0};
const target={name:'E1N2',controller:neutral,find(type){return [];}};
const context={
  module:{exports:{}},
  require(name){if(name==='config')return {PATH_MAX_OPS:200};
    throw Error('Unexpected '+name);},
  Game:{time:1000,gcl:{level:2},rooms:{E1N1:home,E1N2:target},
    map:{findExit(){return 1;}}},
  Memory:{bot:{expansionClaim:m()}},
  FIND_HOSTILE_CREEPS:1,FIND_HOSTILE_STRUCTURES:2,
  ERR_NOT_IN_RANGE:-9,ERR_BUSY:-4,OK:0
};
vm.runInNewContext(src,context);
const role=context.module.exports;
let claims=0,claimRc=0,moves=[];
const creep={
  room:target,memory:{role:'claimer',claimMissionId:'mission-1'},
  pos:{findClosestByRange(){return {id:'exit'};}},
  claimController(){claims++;return claimRc;},
  moveTo(obj,opts){moves.push({obj,opts});return 0;}
};
role.run(creep);
assert.equal(claims,1,'claim intent issued only in neutral authorized target');
assert.equal(context.Memory.bot.expansionClaim.phase,'CLAIMING',
  'accepted claim intent is not confirmed ownership');
context.Memory.bot.expansionClaim=m();
claimRc=-9;claims=0;moves=[];
role.run(creep);
assert.equal(claims,1);
assert.equal(moves.length,1);
assert.equal(moves[0].obj,neutral);
assert.equal(moves[0].opts.maxOps,200);
assert.equal(moves[0].opts.maxRooms,1);
context.Memory.bot.expansionClaim=m();
claimRc=0;claims=0;moves=[];
creep.memory.claimMissionId='wrong';
role.run(creep);
assert.equal(claims,0,'foreign mission identity never grants controller claim');
creep.memory.claimMissionId='mission-1';
context.Memory.bot.expansionClaim={...m(),route:['E1N1','E9N9','E1N2','E1N3','E2N2']};
role.run(creep);
assert.equal(claims,0,'unsupported route length is never followed');
context.Memory.bot.expansionClaim=m();
creep.room=home;moves=[];
role.run(creep);
assert.equal(claims,0,'travel step cannot claim parent controller');
assert.equal(moves.length,1);
assert.equal(moves[0].obj.id,'exit');
assert.equal(moves[0].opts.maxRooms,1);
creep.room=target;
context.Memory.bot.expansionClaim=m();
neutral.owner={username:'rival'};moves=[];claims=0;
role.run(creep);
assert.equal(claims,0,'enemy-owned controllers cannot be claimed');
assert.equal(context.Memory.bot.expansionClaim.phase,'ABORTED');
assert.equal(context.Memory.bot.expansionClaim.reason,'TARGET_NO_LONGER_NEUTRAL');
assert.equal(moves.length,1,'failed claim returns toward parent');
delete neutral.owner;
context.Memory.bot.expansionClaim=m();
neutral.reservation={username:'rival'};claims=0;
role.run(creep);
assert.equal(claims,0);
assert.equal(context.Memory.bot.expansionClaim.phase,'ABORTED');
delete neutral.reservation;
neutral.my=true;neutral.owner={username:'self'};
context.Memory.bot.expansionClaim=m();
role.run(creep);
assert.equal(context.Memory.bot.expansionClaim.phase,'CLAIMED');
assert.equal(context.Memory.bot.expansionClaim.confirmedTick,1000);
delete neutral.my;delete neutral.owner;
context.Memory.bot.expansionClaim=m();
home.controller.safeMode=50;claims=0;
role.run(creep);
assert.equal(claims,0,'parent emergency aborts remote claim');
assert.equal(context.Memory.bot.expansionClaim.reason,'PARENT_DEFENSE_OR_VISION_UNSAFE');
home.controller.safeMode=0;
context.Memory.bot.expansionClaim=m();
home.controller.safeModeCooldown=60;
role.run(creep);
assert.equal(context.Memory.bot.expansionClaim.reason,'PARENT_DEFENSE_OR_VISION_UNSAFE');
home.controller.safeModeCooldown=0;
context.Memory.bot.expansionClaim=m();
target.find=()=>[{id:'hostile'}];claims=0;
role.run(creep);
assert.equal(claims,0);
assert.equal(context.Memory.bot.expansionClaim.reason,'UNVERIFIED_ROUTE_OR_HOSTILE');
target.find=()=>[];
context.Memory.bot.expansionClaim=m();
context.Game.gcl.level=1;claims=0;
role.run(creep);
assert.equal(claims,0);
assert.equal(context.Memory.bot.expansionClaim.reason,'OWNERSHIP_CAPACITY_EXHAUSTED');
context.Game.gcl.level=2;
context.Memory.bot.expansionClaim=m();
context.Game.time=1902;claims=0;
role.run(creep);
assert.equal(claims,0,'expired mission cannot trigger further claim intents');
context.Game.time=1000;
context.Memory.bot.expansionClaim=m();
creep.room={name:'E4N4',controller:neutral,find(){return [];}};
role.run(creep);
assert.equal(context.Memory.bot.expansionClaim.reason,'UNVERIFIED_ROUTE_OR_HOSTILE');
console.log('I4 fail-closed authorized claimer executor tests PASS');
