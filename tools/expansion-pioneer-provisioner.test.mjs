import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL(
  '../game/expansion.pioneer.provisioner.js',import.meta.url),'utf8');
let enabled=false,boot=false,safe=true,spawns=[],rc=0,throws=false,
  homeEnemies=[],targetEnemies=[],existing=[];
const home={name:'E1N1',controller:{my:true,safeMode:0,safeModeCooldown:0},
  find(type){return homeEnemies;}};
const target={name:'E1N2',controller:{my:true},find(type){
  return type===3?existing:targetEnemies;
}};
const game={time:1025,rooms:{E1N1:home,E1N2:target},
  creeps:{},cpu:{limit:40,bucket:9000,getUsed(){return 4;}},
  map:{describeExits(name){return name==='E1N1'?{3:'E1N2'}:{};}}};
const spawn={spawning:null,spawnCreep(...args) {
  spawns.push(args);if(throws)throw Error('spawn offline');
  return rc;
}};
function mission(){return {schemaVersion:1,id:'claim-E1N1-E1N2-1000',
  phase:'CLAIMED',parent:'E1N1',target:'E1N2',
  route:['E1N1','E1N2'],createdTick:1000,confirmedTick:1000,
  estimatedClaimTravelTicks:90,
  verifiedSpawnSite:{roomName:'E1N2',x:25,y:25}};}
const memory={bot:{expansionClaim:mission()}};
const states=[{room:home,spawn,emergency:false,
  health:{status:'HEALTHY'},energyStored:12000,
  energyAvailable:1000,energyCapacityAvailable:1000,
  economyModel:{haulerCarryDeficit:0,consumerCriticalCount:0}}];
const ctx={module:{exports:{}},Game:game,Memory:memory,
  require(name){
    if(name==='config')return {
      get AUTO_EXPANSION_CLAIM(){return enabled;},
      get AUTO_EXPANSION_BOOTSTRAP(){return boot;}
    };
    if(name==='expansion.parent.stability.shadow')return {
      qualifies(){return safe;}
    };
    throw Error('Unexpected '+name);
  },
  FIND_HOSTILE_CREEPS:1,FIND_HOSTILE_STRUCTURES:2,FIND_MY_SPAWNS:3,
  WORK:'work',CARRY:'carry',MOVE:'move',OK:0,
  BODYPART_COST:{work:100,carry:50,move:50}};
vm.runInNewContext(source,ctx);
const provision=ctx.module.exports.provision;
const execute=()=>provision(states,game,memory,{status:'OBSERVATIONS_AVAILABLE'});
function reset() {
  enabled=true;boot=true;safe=true;spawns=[];rc=0;throws=false;
  homeEnemies=[];targetEnemies=[];existing=[];
  game.time=1025;game.creeps={};game.cpu.bucket=9000;
  home.controller.safeMode=0;home.controller.safeModeCooldown=0;
  target.controller.my=true;
  spawn.spawning=null;states[0].energyStored=12000;
  states[0].energyAvailable=1000;states[0].emergency=false;
  states[0].health.status='HEALTHY';memory.bot.expansionClaim=mission();
}
reset();enabled=false;
assert.equal(execute().reason,'AUTO_EXPANSION_BOOTSTRAP_DISABLED');
assert.equal(spawns.length,0);
reset();boot=false;
assert.equal(execute().reason,'AUTO_EXPANSION_BOOTSTRAP_DISABLED');
reset();memory.bot.expansionClaim.phase='CLAIMING';
assert.equal(execute().reason,'CONFIRMED_CLAIM_OR_ROUTE_UNVERIFIED');
reset();delete memory.bot.expansionClaim.id;
assert.equal(execute().reason,'CONFIRMED_CLAIM_OR_ROUTE_UNVERIFIED',
  'missing exact mission id must never spawn a pioneer');
reset();memory.bot.expansionClaim.confirmedTick=999;
assert.equal(execute().reason,'CONFIRMED_CLAIM_OR_ROUTE_UNVERIFIED',
  'confirmation cannot precede claim mission creation');
reset();target.controller.my=false;
assert.equal(execute().reason,'PARENT_DEFENSE_OR_SUPPORT_UNVERIFIED');
reset();home.controller.safeMode=100;
assert.equal(execute().reason,'PARENT_DEFENSE_OR_SUPPORT_UNVERIFIED');
reset();home.controller.safeModeCooldown=100;
assert.equal(execute().reason,'PARENT_DEFENSE_OR_SUPPORT_UNVERIFIED');
reset();states[0].emergency=true;
assert.equal(execute().reason,'PARENT_DEFENSE_OR_SUPPORT_UNVERIFIED');
reset();safe=false;
assert.equal(execute().reason,'PARENT_DEFENSE_OR_SUPPORT_UNVERIFIED');
reset();game.time=1026;
assert.equal(execute().reason,'CPU_OR_REAL_TICK_HEADROOM_DEFERRED');
reset();game.cpu.bucket=1500;
assert.equal(execute().reason,'CPU_OR_REAL_TICK_HEADROOM_DEFERRED');
reset();homeEnemies=[{id:'raider'}];
assert.equal(execute().reason,'ROUTE_HOSTILE_OR_UNVERIFIED');
reset();targetEnemies=[{id:'enemy'}];
assert.equal(execute().reason,'ROUTE_HOSTILE_OR_UNVERIFIED');
reset();existing=[{id:'already-built-spawn'}];
assert.equal(execute().reason,'FIRST_SPAWN_ALREADY_PRESENT');
reset();states[0].energyStored=4900;
assert.equal(execute().reason,'HOME_ENERGY_OR_LOGISTICS_RESERVE_LOW');
reset();states[0].energyAvailable=200;
assert.equal(execute().reason,'HOME_ENERGY_OR_LOGISTICS_RESERVE_LOW');
reset();states[0].economyModel.haulerCarryDeficit=100;
assert.equal(execute().reason,'HOME_ENERGY_OR_LOGISTICS_RESERVE_LOW');
states[0].economyModel.haulerCarryDeficit=0;
reset();rc=-6;
const initial=JSON.stringify(memory.bot.expansionClaim);
assert.equal(execute().status,'SPAWN_REJECTED');
assert.equal(spawns.length,1);
assert.equal(JSON.stringify(memory.bot.expansionClaim),initial,
  'failed pioneer spawn cannot consume unique mission orders');
reset();throws=true;
assert.equal(execute().reason,'PIONEER_SPAWN_EXCEPTION');
assert.equal(memory.bot.expansionClaim.pioneerOrders,undefined);
reset();const first=execute();
assert.equal(first.status,'SPAWN_INTENT_ACCEPTED');
assert.equal(first.pioneerOrders,1);
assert.equal(spawns.length,1);
assert.deepEqual(Array.from(spawns[0][0]),
  ['work','carry','move','work','carry','move']);
assert.equal(spawns[0][2].memory.role,'pioneer');
assert.equal(spawns[0][2].memory.claimMissionId,memory.bot.expansionClaim.id);
assert.equal(spawns[0][2].memory.home,'E1N1');
assert.equal(memory.bot.expansionClaim.lastPioneerSpawnIntentTick,1025);
assert.equal(execute().reason,'PIONEER_ORDER_COOLDOWN');
assert.equal(spawns.length,1,'duplicate in same tick must never spawn twice');
game.time=1050;const second=execute();
assert.equal(second.status,'SPAWN_INTENT_ACCEPTED');
assert.equal(second.pioneerOrders,2);
assert.equal(spawns.length,2);
game.time=1075;
assert.equal(execute().reason,'PIONEER_REPLACEMENT_COOLDOWN_OR_DEADLINE');
assert.equal(spawns.length,2,'no premature third pioneer order');
game.time=1200;
game.creeps={alive:{memory:{role:'pioneer',
  claimMissionId:memory.bot.expansionClaim.id,home:'E1N1'}}};
assert.equal(execute().reason,'PIONEER_REPLACEMENT_NOT_NEEDED',
  'never replace a surviving pioneer merely because two orders were issued');
game.creeps={};
const replacement=execute();
assert.equal(replacement.status,'SPAWN_INTENT_ACCEPTED');
assert.equal(replacement.pioneerOrders,3);
assert.equal(spawns.length,3);
game.time=1225;
assert.equal(execute().reason,'PIONEER_REPLACEMENT_COOLDOWN_OR_DEADLINE');
game.time=1350;
const lastReplacement=execute();
assert.equal(lastReplacement.status,'SPAWN_INTENT_ACCEPTED');
assert.equal(lastReplacement.pioneerOrders,4);
game.time=1500;
assert.equal(execute().reason,'PIONEER_ORDER_LIMIT_REACHED');
assert.equal(spawns.length,4,'maximum four total orders, never unbounded respawns');
reset();game.time=1800;
memory.bot.expansionClaim.pioneerOrders=2;
memory.bot.expansionClaim.lastPioneerSpawnIntentTick=1600;
assert.equal(execute().reason,'PIONEER_REPLACEMENT_COOLDOWN_OR_DEADLINE',
  'do not attempt replacement after bootstrap horizon');
reset();game.creeps={bad:{memory:{role:'pioneer',claimMissionId:mission().id,
  home:'WRONG'}}};
assert.equal(execute().reason,'FOREIGN_OR_CORRUPT_PIONEER');
reset();game.creeps={a:{memory:{role:'pioneer',claimMissionId:mission().id,home:'E1N1'}},
  b:{memory:{role:'pioneer',claimMissionId:mission().id,home:'E1N1'}}};
assert.equal(execute().reason,'EXISTING_PIONEER_CAP');
console.log('I4 bounded pioneer provisioning, reserves and mission exclusivity PASS');
