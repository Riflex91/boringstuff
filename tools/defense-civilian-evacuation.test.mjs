import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL(
  '../game/defense.civilian.evacuate.js',import.meta.url),'utf8');
let enemies=[],calls=[],used=1,limit=40,done=false,rc=0,range=3;
const spawnRoom={name:'E1N1',controller:{my:true,safeMode:0},
  find(type){assert.equal(type,1);return enemies;}};
const creep={room:spawnRoom,memory:{role:'hauler'},
  pos:{roomName:'E1N1',getRangeTo(){return range;},
    getDirectionTo(){return 3;}},
  getActiveBodyparts(type){assert.equal(type,'move');return 1;},
  move(direction){calls.push(direction);return rc;}};
const game={cpu:{get limit(){return limit;},getUsed(){return used;}}};
const sandbox={module:{exports:{}},FIND_HOSTILE_CREEPS:1,
  MOVE:'move',OK:0,ERR_TIRED:-11,
  require(name){if(name==='config')return {PATH_MAX_OPS:200};
    throw Error(name);},
  PathFinder:{search(origin,goals,opts) {
    assert.equal(opts.flee,true);
    assert.equal(opts.maxRooms,1);
    assert.equal(opts.maxOps,120);
    assert.equal(opts.roomCallback('E1N2'),false);
    assert.equal(opts.roomCallback('E1N1'),undefined);
    return {incomplete:done,path:[{roomName:'E1N1',x:26,y:25}]};
  }}};
vm.runInNewContext(source,sandbox);
const move=sandbox.module.exports.run;
const h=(types)=>({pos:{roomName:'E1N1'},
  body:types.map(type=>({type,hits:100}))});
assert.equal(move(creep,game),false,'empty room does not flee');
enemies=[h(['move','carry'])];
assert.equal(move(creep,game),false,'unarmed scout cannot trigger flee');
enemies=[h(['heal'])];
assert.equal(move(creep,game),false,'healer without damage cannot trigger flee');
enemies=[h(['attack'])];range=8;
assert.equal(move(creep,game),false,'far melee creep does not evacuate');
range=3;
assert.equal(move(creep,game),true,'melee at unsafe distance triggers real move');
assert.deepEqual(calls,[3]);
calls=[];enemies=[h(['ranged_attack'])];range=5;
assert.equal(move(creep,game),true,'ranged unit requires larger separation');
assert.equal(calls.length,1);
calls=[];creep.memory.role='claimer';
assert.equal(move(creep,game),false,'claimer owns its own mission retreat');
creep.memory.role='pioneer';
assert.equal(move(creep,game),false,'pioneer owns its own bootstrap retreat');
creep.memory.role='hauler';spawnRoom.controller.safeMode=100;
assert.equal(move(creep,game),false,'safe-mode protected room does not run');
spawnRoom.controller.safeMode=0;
done=true;
assert.equal(move(creep,game),false,'incomplete escape path cannot issue move');
done=false;
limit=3;
assert.equal(move(creep,game),false,'CPU exhaustion cannot start pathfinder');
limit=40;
const dead=h(['ranged_attack']);dead.body[0].hits=0;
enemies=[dead];
assert.equal(move(creep,game),false,'disabled hostile body part ignored');
enemies=[h(['attack'])];range=3;rc=-11;
assert.equal(move(creep,game),true,'fatigued civilian stays in defensive mode');
const managerSource=fs.readFileSync(new URL(
  '../game/creep.manager.js',import.meta.url),'utf8');
assert.match(managerSource,
  /if\(civilianEvacuation\.run\(creep,Game\)\)return;[\s\S]*?handler\.run\(creep\)/,
  'real creep manager must run escape before normal role intents');
console.log('D1 actual proximity evacuation, CPU and scout safety PASS');
