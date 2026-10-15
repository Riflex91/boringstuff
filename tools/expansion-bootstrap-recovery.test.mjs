import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let enabled=true,continuity=true,bucket=10000,spawns=[],sites=[],
    routeHostiles=[],returnWrong=false;
const mission=()=>({schemaVersion:1,
  id:'claim-E1N1-E1N2-1000',phase:'BOOTSTRAP_BLOCKED',
  reason:'FIRST_SPAWN_NOT_OBSERVED_BY_DEADLINE',
  parent:'E1N1',target:'E1N2',route:['E1N1','E1N2'],
  createdTick:1000,confirmedTick:1300,blockedTick:3301,
  pioneerOrders:4,verifiedSpawnSite:{x:25,y:25,roomName:'E1N2'}});
const home={name:'E1N1',controller:{my:true,safeMode:0,safeModeCooldown:0},
  find(which){return routeHostiles;}};
const target={name:'E1N2',controller:{my:true},
  find(which){return which===3?spawns:which===4?sites:routeHostiles;}};
const game={time:3900,rooms:{E1N1:home,E1N2:target},creeps:{},
  map:{describeExits(room){
    if(returnWrong)return {3:'E9N9'};
    return room==='E1N1'?{3:'E1N2'}:{7:'E1N1'};
  }},
  cpu:{get bucket(){return bucket;},limit:40,getUsed(){return 4;}}};
const parent={room:home,spawn:{spawning:null},emergency:false,
  health:{status:'HEALTHY'},energyStored:12000,
  energyCapacityAvailable:1050,energyAvailable:1050,
  economyModel:{consumerCriticalCount:0,haulerCarryDeficit:0}};
const memory={bot:{expansionClaim:mission()}};
const sandbox={module:{exports:{}},FIND_MY_SPAWNS:3,
  FIND_MY_CONSTRUCTION_SITES:4,FIND_HOSTILE_CREEPS:1,
  FIND_HOSTILE_STRUCTURES:2,STRUCTURE_SPAWN:'spawn',
  require(name){
    if(name==='config')return {
      get AUTO_EXPANSION_CLAIM(){return enabled;},
      get AUTO_EXPANSION_BOOTSTRAP(){return enabled;}};
    if(name==='expansion.parent.stability.shadow')return {
      qualifies(){return continuity;}};
    throw Error('Unexpected import '+name);
  }};
vm.runInNewContext(fs.readFileSync(new URL(
  '../game/expansion.bootstrap.recovery.js',import.meta.url),'utf8'),sandbox);
const {resume}=sandbox.module.exports;
const run=()=>resume([parent],game,memory,{});
function reset() {
  memory.bot.expansionClaim=mission();game.time=3900;
  game.rooms.E1N1=home;game.rooms.E1N2=target;
  home.controller.safeMode=0;home.controller.my=true;
  target.controller.my=true;parent.health.status='HEALTHY';
  parent.energyStored=12000;parent.energyAvailable=1050;
  game.creeps={};enabled=true;continuity=true;bucket=10000;
  spawns=[];sites=[];routeHostiles=[];returnWrong=false;
}
reset();game.time=3700;
assert.equal(run().reason,'RECOVERY_COOLDOWN_OR_CADENCE');
assert.equal(memory.bot.expansionClaim.pioneerOrders,4);
reset();game.time=3901;
assert.equal(run().reason,'RECOVERY_COOLDOWN_OR_CADENCE');
reset();bucket=100;
assert.equal(run().reason,'CPU_OR_CURRENT_PARENT_STATES_UNSAFE');
reset();continuity=false;
assert.equal(run().reason,'PARENT_DEFENSE_OR_CONTINUITY_UNVERIFIED');
reset();parent.energyStored=4000;
assert.equal(run().reason,'PARENT_ECONOMY_OR_CREW_RESERVE_LOW');
reset();game.creeps.old={memory:{
  role:'pioneer',claimMissionId:mission().id}};
assert.equal(run().reason,'SURVIVING_CREW_MUST_RETURN_FIRST');
reset();returnWrong=true;
assert.equal(run().reason,'RECOVERY_ROUTE_ADJACENCY_FAILED');
reset();routeHostiles=[{id:'enemy'}];
assert.equal(run().reason,'RECOVERY_ROUTE_NOT_SAFE');
reset();sites=[{structureType:'spawn',pos:{
  x:20,y:20,roomName:'E1N2'}}];
assert.equal(run().reason,'UNVERIFIED_OR_DUPLICATE_FIRST_SPAWN_SITE');
reset();spawns=[{id:'stray',my:true,pos:{roomName:'E1N2',x:20,y:20}}];
assert.equal(run().reason,'UNVERIFIED_SPAWN_AT_DIFFERENT_LOCATION');
reset();enabled=false;
assert.equal(run().reason,'RECOVERY_FEATURE_DISABLED');
reset();target.controller.my=false;
assert.equal(run().reason,'TARGET_NOT_OWNED_REQUIRES_NEW_CLAIM_MISSION');
reset();delete game.rooms.E1N2;
assert.equal(run().reason,'OWNERSHIP_VISION_UNAVAILABLE');
reset();spawns=[{id:'first-built',my:true,
  pos:{roomName:'E1N2',x:25,y:25}}];enabled=false;
delete game.rooms.E1N1;
const achieved=run();
assert.equal(achieved.status,'ESTABLISHED',
  'verified daughter colony finishes even if flags off and parent destroyed');
assert.equal(memory.bot.expansionClaim.phase,'ESTABLISHED');
assert.equal(memory.bot.expansionClaim.firstSpawnId,'first-built');
assert.equal(memory.bot.expansionClaim.establishedTick,3900);
reset();sites=[{structureType:'spawn',pos:{
  x:25,y:25,roomName:'E1N2'}}];
const id=memory.bot.expansionClaim.id;
const first=run();
assert.equal(first.status,'RESUMED_BOOTSTRAP');
assert.equal(first.recoveryWaves,1);
assert.equal(memory.bot.expansionClaim.id,id,'claim mission identity immutable');
assert.equal(memory.bot.expansionClaim.phase,'CLAIMED');
assert.equal(memory.bot.expansionClaim.confirmedTick,3900);
assert.equal(memory.bot.expansionClaim.firstConfirmedTick,1300);
assert.equal(memory.bot.expansionClaim.pioneerOrders,0,
  'only now allows the bounded real pioneer provisioner another wave');
assert.equal(memory.bot.expansionClaim.lastRecoveryTick,3900);
assert.equal(run().reason,'NO_VERIFIED_BLOCKED_BOOTSTRAP',
  'same tick cannot issue a second rescue wave');
reset();memory.bot.expansionClaim.recoveryWaves=1;
assert.equal(run().status,'RESUMED_BOOTSTRAP');
assert.equal(memory.bot.expansionClaim.recoveryWaves,2);
reset();memory.bot.expansionClaim.recoveryWaves=2;
assert.equal(run().reason,'RECOVERY_WAVE_LIMIT_REACHED');
assert.equal(memory.bot.expansionClaim.phase,'BOOTSTRAP_BLOCKED',
  'two rescue waves maximum; permanently hold rather than infinite expense');
reset();memory.bot.expansionClaim.id='claim-E1N1-E9N9-1000';
assert.equal(run().reason,'NO_VERIFIED_BLOCKED_BOOTSTRAP');
reset();memory.bot.expansionClaim.blockedTick=3000;
assert.equal(run().reason,'NO_VERIFIED_BLOCKED_BOOTSTRAP',
  'forged timeout earlier than 2000 ticks may not trigger recovery');
const main=fs.readFileSync(new URL('../game/main.js',import.meta.url),'utf8');
assert.ok(main.includes('expansionBootstrapRecovery.resume('));
assert.ok(main.indexOf('expansionBootstrapRecovery.resume(')<
  main.indexOf('expansionPioneerProvisioner.provision('),
  'recovery supervisor must precede normal live pioneer provisioning');
console.log('I4 bounded actual first-spawn bootstrap recovery / no phantom claim PASS');
