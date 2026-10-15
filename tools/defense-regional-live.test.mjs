import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let enabled=true,homeEnemies=[],targetEnemies=[],issued=[];
const defender=(name,strength)=>({
  my:true,spawning:false,name,id:name,ticksToLive:400,
  memory:{role:'defender',home:'E1N1'},
  room:null,
  body:[{type:'move',hits:100},{type:'attack',hits:100},
    ...(strength>1?[{type:'attack',hits:100}]:[])],
  pos:{findClosestByRange(){return {id:'exit'};}},
  moveTo(where,opts){issued.push({name,where,opts});return 0;}
});
const strong=defender('Strong',2),spare=defender('Spare',1);
const home={name:'E1N1',controller:{my:true,safeMode:0,safeModeCooldown:0},
  find(){return homeEnemies;}};
const target={name:'E1N2',controller:{my:true,safeMode:0},
  find(){return targetEnemies;}};
strong.room=home;spare.room=home;
const hostile=()=>({body:[{type:'attack',hits:100}]});
const game={time:1000,rooms:{E1N1:home,E1N2:target},
  creeps:{strong:strong,spare:spare},
  cpu:{limit:40,bucket:10000,getUsed(){return 1;}},
  map:{describeExits(room){return room==='E1N1'?{3:'E1N2'}:{7:'E1N1'};},
    findExit(){return 3;}}};
const homeState={room:home,spawn:{id:'home-spawn'},emergency:false,
  health:{status:'HEALTHY'},energyStored:10000,hostileCreeps:[],
  creeps:[strong,spare]};
const targetState={room:target,spawn:{id:'target-spawn'},emergency:false,
  health:{status:'HEALTHY'},energyStored:2000,hostileCreeps:[hostile()],
  creeps:[]};
const sandbox={module:{exports:{}},FIND_HOSTILE_CREEPS:1,
  require(name){if(name==='config')return {
    get AUTO_REGIONAL_DEFENSE_SUPPORT(){return enabled;},PATH_MAX_OPS:200
  };throw Error(name);}};
vm.runInNewContext(fs.readFileSync(new URL(
  '../game/defense.regional.live.js',import.meta.url),'utf8'),sandbox);
const {assign,run}=sandbox.module.exports;
targetEnemies=[hostile()];
let output=assign([homeState,targetState],game);
assert.equal(output.status,'ASSIGNED');
assert.equal(output.from,'E1N1');
assert.equal(output.to,'E1N2');
assert.equal(output.defender,'Spare',
  'the strongest home fighter must stay at home');
assert.equal(spare.memory.defenseSupportTarget,'E1N2');
assert.equal(strong.memory.defenseSupportTarget,undefined);
assert.equal(assign([homeState,targetState],game).reason,
  'FIELD_REINFORCEMENT_ALREADY_ASSIGNED');
assert.equal(run(spare,game),true,'en route defender must cross only approved exit');
assert.equal(issued[0].opts.maxRooms,1);
assert.equal(issued[0].opts.maxOps,200);
assert.equal(issued[0].where.id,'exit');
spare.room=target;issued=[];
targetEnemies=[hostile()];
assert.equal(run(spare,game),false,'at threatened destination normal defender combat resumes');
assert.equal(issued.length,0);
homeEnemies=[hostile()];
assert.equal(run(spare,game),true,'home attack recalls a field defender immediately');
assert.equal(issued.length,1);
homeEnemies=[];targetEnemies=[];
issued=[];assert.equal(run(spare,game),true,'clear destination recalls defender');
assert.equal(issued.length,1);
spare.room=home;
assert.equal(run(spare,game),false,'once home, return to ordinary local defense');
assert.equal(spare.memory.defenseSupportTarget,undefined);
spare.room=home;targetEnemies=[];targetState.hostileCreeps=[];
assert.equal(assign([homeState,targetState],game).status,'HOLD');
targetState.hostileCreeps=[hostile()];
homeState.creeps=[strong];
assert.equal(assign([homeState,targetState],game).reason,
  'NO_ADJACENT_SAFE_SPARE_GARRISON');
homeState.creeps=[strong,spare];
homeState.hostileCreeps=[hostile()];
assert.equal(assign([homeState,targetState],game).status,'HOLD');
homeState.hostileCreeps=[];
enabled=false;
// Operational rollback must actually recall a deployed fighter, not merely
// prevent future dispatches.
spare.memory.defenseSupportHome='E1N1';
spare.memory.defenseSupportTarget='E1N2';
spare.memory.defenseSupportAssignedTick=1000;
spare.room=target;targetEnemies=[hostile()];issued=[];
assert.equal(run(spare,game),true,
  'turning the flag off must recall field troops still fighting');
assert.equal(issued.length,1,'feature rollback must issue actual return movement');
spare.room=home;
assert.equal(run(spare,game),false,'home arrival clears mission on rollback');
assert.equal(spare.memory.defenseSupportTarget,undefined);
assert.equal(assign([homeState,targetState],game).status,'HOLD',
  'disabled regional dispatch must issue no mission');
enabled=true;
game.time=1001;
assert.equal(assign([homeState,targetState],game).status,'HOLD',
  'only 25-tick dispatch cadence may allocate a field defender');
game.time=1000;
const original=game.map.describeExits;
game.map.describeExits=()=>({3:'E1N3'});
assert.equal(assign([homeState,targetState],game).status,'HOLD',
  'never attempt unverified transit through third-party territory');
game.map.describeExits=original;
const defenderSrc=fs.readFileSync(new URL('../game/role.defender.js',
  import.meta.url),'utf8');
const mainSrc=fs.readFileSync(new URL('../game/main.js',
  import.meta.url),'utf8');
assert.ok(defenderSrc.includes('regionalSupport.run(creep,Game)'));
assert.ok(mainSrc.includes('regionalDefenseLive.assign(roomStates,Game)'));
console.log('D2 active adjacent one-spare inter-colony defense and recall PASS');
