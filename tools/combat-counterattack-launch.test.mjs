import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const adviser=require('../game/combat.counterattack.shadow.js');
const code=fs.readFileSync(new URL('../game/combat.counterattack.launch.js',
  import.meta.url),'utf8');
let enabled=true,spawnRc=0,spawnRequests=[],enemyDamage=30;
const enemy=()=>({owner:{username:'Aggressor'},body:[
  {type:'attack',hits:100},{type:'move',hits:100}],
  pos:{roomName:'E1N2'}});
let opponents=[enemy()],enemyStructures=[],homeHostiles=[];
const myRoom={name:'E1N1',controller:{my:true,safeMode:0,safeModeCooldown:0},
  find(){return homeHostiles;}};
const enemyRoom={name:'E1N2',controller:{my:false,
  owner:{username:'Aggressor'},safeMode:0},
  find(which){if(which===1)return opponents;
    if(which===2)return enemyStructures;
    throw Error('find type '+which);}};
const spawn={spawning:false,spawnCreep(parts,name,opts){
  spawnRequests.push({parts,name,opts});
  return spawnRc;
}};
const guard={my:true,spawning:false,name:'Guard',room:myRoom,
  memory:{role:'defender',home:'E1N1'},
  body:[{type:'move',hits:100},{type:'attack',hits:100}]};
const home={room:myRoom,spawn,health:{status:'HEALTHY'},
  emergency:false,energyAvailable:1300,energyCapacityAvailable:1300,
  energyStored:20000,hostileCreeps:[],creeps:[guard],byRole:{
    defender:1,harvester:2,worker:2}};
const game={time:1000,rooms:{E1N1:myRoom,E1N2:enemyRoom},creeps:{Guard:guard},
  map:{getRoomLinearDistance(){return 1;},
    describeExits(name) {return name==='E1N1'?
      {3:'E1N2'}:{7:'E1N1'};}},
  cpu:{bucket:9000,limit:45,getUsed(){return 5;}}};
const intel=()=>({E1N2:{roomName:'E1N2',
  controller:{owner:'Aggressor',my:false,safeMode:0},
  observation:{lastSeenTick:1000},
  structures:{byType:{tower:0}}}});
const memory={bot:{worldIntel:{rooms:intel()},
  combatAggressionEvidence:{schemaVersion:1,records:[
    {room:'E1N1',player:'Aggressor',tick:980,armedParts:1}]}}};
const sandbox={module:{exports:{}},TOUGH:'tough',ATTACK:'attack',MOVE:'move',
  BODYPART_COST:{tough:10,attack:80,move:50},
  OK:0,FIND_HOSTILE_CREEPS:1,FIND_HOSTILE_STRUCTURES:2,
  STRUCTURE_TOWER:'tower',
  require(name) {
    if(name==='config')return {
      get AUTO_COUNTERATTACK_RAID(){return enabled;}};
    if(name==='combat.counterattack.shadow')return adviser;
    throw Error('unknown '+name);
  }};
vm.runInNewContext(code,sandbox);
const {start,supervise}=sandbox.module.exports;
function reset() {
  game.time=1000;game.creeps={Guard:guard};home.creeps=[guard];
  home.energyStored=20000;home.energyAvailable=1300;
  home.hostileCreeps=[];homeHostiles=[];
  myRoom.controller.safeMode=0;
  enemyRoom.controller.owner.username='Aggressor';
  enemyRoom.controller.safeMode=0;
  opponents=[enemy()];enemyStructures=[];
  game.cpu.bucket=9000;
  memory.bot.counterattackMission=undefined;
  memory.bot.worldIntel.rooms=intel();
  memory.bot.combatAggressionEvidence.records[0].tick=980;
  spawnRequests=[];spawnRc=0;enabled=true;
}
reset();home.creeps=[];
assert.equal(start([home],game,memory).reason,
  'LIVE_OWNER_PARENT_OR_ROOM_UNVERIFIED',
  'an obsolete defender role count without actual armed home guard cannot launch');
reset();enabled=false;
assert.equal(start([home],game,memory).reason,'AUTO_RAID_DISABLED');
assert.equal(spawnRequests.length,0);
reset();opponents=[{owner:{username:'Aggressor'},
  body:[{type:'move',hits:100}]}];
assert.equal(start([home],game,memory).reason,
  'BOOSTED_OR_UNVERIFIED_TARGET_BODY','no combat enemy means no expedition');
reset();enemyStructures=[{structureType:'tower'}];
assert.equal(start([home],game,memory).reason,
  'TOWER_OR_THIRD_PARTY_OR_TARGET_UNVERIFIED','real tower blocks all attacks');
reset();enemyRoom.controller.owner.username='Other';
assert.equal(start([home],game,memory).reason,'LIVE_OWNER_PARENT_OR_ROOM_UNVERIFIED');
reset();home.energyStored=10000;
assert.equal(start([home],game,memory).reason,
  'LIVE_OWNER_PARENT_OR_ROOM_UNVERIFIED');
reset();home.hostileCreeps=[enemy()];
assert.equal(start([home],game,memory).reason,
  'FRESH_ADJACENT_AGGRESSOR_RECON_MISSING',
  'shadow recommendation refuses a home under active attack');
reset();game.cpu.bucket=100;
assert.equal(start([home],game,memory).reason,'GAME_OR_CPU_HEADROOM_UNVERIFIED');
reset();memory.bot.combatAggressionEvidence.records[0].tick=800;
assert.equal(start([home],game,memory).reason,'FRESH_ADJACENT_AGGRESSOR_RECON_MISSING');
reset();opponents=[{...enemy(),body:[
  {type:'attack',hits:100,boost:'UH2O'}]}];
assert.equal(start([home],game,memory).reason,
  'BOOSTED_OR_UNVERIFIED_TARGET_BODY');
reset();spawnRc=-6;
assert.equal(start([home],game,memory).status,'SPAWN_REJECTED');
assert.equal(memory.bot.counterattackMission,undefined,
  'an unsuccessful spawn return must never mint attack authority');
reset();
const first=start([home],game,memory);
assert.equal(first.status,'SPAWN_INTENT_ACCEPTED');
assert.equal(spawnRequests.length,1);
assert.equal(spawnRequests[0].parts.length,24);
assert.equal(spawnRequests[0].parts[0],'tough');
assert.equal(spawnRequests[0].opts.memory.role,'raider');
assert.equal(spawnRequests[0].opts.memory.combatMissionId,first.missionId);
assert.equal(memory.bot.counterattackMission.phase,'ATTACKING');
assert.equal(memory.bot.counterattackMission.verifiedOwnDps,180);
assert.equal(start([home],game,memory).status,'HOLD');
game.time=1001;
assert.equal(supervise(game,memory).status,'ATTACKING',
  'spawn may take 72 ticks before a creep becomes available');
// The mission supervisor must not wait until the next status snapshot to
// recall an expedition whose actual mobile home garrison just disappeared.
game.creeps={};
assert.equal(supervise(game,memory).status,'RETREAT');
assert.equal(memory.bot.counterattackMission.reason,'HOME_GARRISON_LOST');
// The main combat fixtures below still test owner-change recall independently.
reset();
const secondMission=start([home],game,memory);
assert.equal(secondMission.status,'SPAWN_INTENT_ACCEPTED');
const tracked=memory.bot.counterattackMission;
game.time=1002;enemyRoom.controller.owner.username='Other';
assert.equal(supervise(game,memory).status,'RETREAT',
  'ownership changes must recall a raider immediately');
const deployed={room:myRoom,memory:{role:'raider',
  home:'E1N1',combatMissionId:tracked.id},
  hits:2400,hitsMax:2400};
game.creeps[tracked.raiderName]=deployed;
assert.equal(supervise(game,memory).status,'COMPLETE');
assert.equal(deployed.memory.role,'defender');
assert.equal(deployed.memory.combatMissionId,undefined);
assert.equal(tracked.phase,'COMPLETE');
game.time=1300;assert.equal(start([home],game,memory).status,'HOLD',
  'one expedition must have a long recovery period');
reset();
const eligible=start([home],game,memory);
game.time=1100;
assert.equal(supervise(game,memory).status,'ABORTED',
  'missing raid survivor after full spawn grace cannot remain attacking');
reset();home.energyCapacityAvailable=3000;home.energyAvailable=3000;
opponents=[{...enemy(),body:[{type:'attack',hits:100},
  {type:'attack',hits:100},{type:'move',hits:100}]}];
assert.equal(start([home],game,memory).reason,
  'REAL_COMBAT_VICTORY_MARGIN_UNPROVEN',
  'unproven survival margin must block the expedition');
const main=fs.readFileSync(new URL('../game/main.js',import.meta.url),'utf8');
assert.ok(main.includes('combatCounterattackLaunch.start(roomStates,Game,Memory)'));
assert.ok(main.includes('combatCounterattackLaunch.supervise(Game,Memory)'));
assert.ok(main.includes('combatAggressionEvidence.observe(roomStates,Game,Memory)'));
console.log('U11 actual witnessed-aggressor raid spawn and rollback safety PASS');
