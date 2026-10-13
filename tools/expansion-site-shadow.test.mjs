import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import Module from 'node:module';
import fs from 'node:fs';

const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);
const site=require('../game/expansion.site.shadow.js');
const operation=require('../game/expansion.operation.shadow.js');

globalThis.TERRAIN_MASK_WALL=1;
globalThis.LOOK_STRUCTURES='structures';
globalThis.LOOK_CONSTRUCTION_SITES='sites';
globalThis.FIND_SOURCES='sources';
globalThis.FIND_HOSTILE_CREEPS='hostiles';
globalThis.RoomPosition=class RoomPosition {
  constructor(x,y,roomName){this.x=x;this.y=y;this.roomName=roomName;}
};
const pos=(x,y,roomName)=>({x,y,roomName});
let calls=0, pathIncomplete=false, forbiddenRoomAllowed=false;
globalThis.PathFinder={search(from,goal,options){
  calls++;
  if (options.roomCallback('E9N9') !== false) forbiddenRoomAllowed=true;
  if (pathIncomplete) return {incomplete:true,cost:1,path:[]};
  return {incomplete:false,cost:10,path:[
    new RoomPosition(goal.pos.x,goal.pos.y,goal.pos.roomName)]};
}};

const records=()=>({
  E2N2:{
    schemaVersion:1,roomName:'E2N2',
    observation:{lastSeenTick:1000,confidence:1,source:'visible-room'},
    classification:{roomStatus:'normal'},
    controller:{exists:true,my:true,owner:'Me',reservationOwner:null,
      level:5,pos:pos(20,20,'E2N2')},
    resources:{sourceCount:2,sources:[
      {id:'pa',pos:pos(12,18,'E2N2')},{id:'pb',pos:pos(31,22,'E2N2')}],
      mineral:null},
    topology:{exits:[{roomName:'E2N3'}]},
    structures:{count:0,ownedByType:{}},
    threat:{hostileCreeps:0,lastHostileTick:null}
  },
  E2N3:{
    schemaVersion:1,roomName:'E2N3',
    observation:{lastSeenTick:1000,confidence:1,source:'visible-room'},
    classification:{roomStatus:'normal'},
    controller:{exists:true,my:false,owner:null,reservationOwner:null,
      level:0,pos:pos(20,20,'E2N3')},
    resources:{sourceCount:2,sources:[
      {id:'sa',pos:pos(12,18,'E2N3')},{id:'sb',pos:pos(31,22,'E2N3')}],
      mineral:null},
    topology:{exits:[{roomName:'E2N2'}]},
    structures:{count:0,ownedByType:{}},
    threat:{hostileCreeps:0,lastHostileTick:null}
  }
});
const makeRoom=(name,record,opts={})=>({
  name,controller:{
    my: record.controller.my,
    owner: record.controller.owner?{username:record.controller.owner}:null,
    reservation:record.controller.reservationOwner?{username:record.controller.reservationOwner}:null,
    level:record.controller.level,pos:record.controller.pos
  },
  getTerrain:()=>({get:(x,y)=>opts.walls?.has(x+','+y)?1:0}),
  find:(kind)=>kind===FIND_HOSTILE_CREEPS?(opts.hostiles||[]):
    kind===FIND_SOURCES?record.resources.sources:[],
  lookForAt:(kind,x,y)=>opts.blocked?.has(x+','+y)?[{id:'blocker'}]:[]
});
const parent=()=>({
  room:{name:'E2N2',controller:{my:true}},
  spawn:{name:'Home',pos:pos(25,25,'E2N2')},
  rcl:5,emergency:false,health:{status:'HEALTHY'},hostileCreeps:[],
  economyModel:{haulerCarryDeficit:0},
  energyCapacityAvailable:1050,energyAvailable:1050,energyStored:6000,
  creeps:[
    {memory:{role:'harvester'}},{memory:{role:'harvester'}},
    {memory:{role:'hauler'}},{memory:{role:'hauler'}},
    {memory:{role:'upgrader',waitingEnergyTicks:0,logisticsFallback:false}}
  ]
});
const fixture=()=>{
  const intel=records();
  const game={time:1050,
    cpu:{limit:40,bucket:10000,getUsed:()=>10},
    rooms:{
      E2N2:makeRoom('E2N2',intel.E2N2),
      E2N3:makeRoom('E2N3',intel.E2N3)
    },
    map:{findRoute:(_a,_b,opts)=>{
      assert.equal(opts.routeCallback('E2N3'),1);
      return [{room:'E2N3',exit:3}];
    }}
  };
  const memory={bot:{worldIntel:{rooms:intel}}};
  return {intel,game,memory,parent:parent()};
};
const evaluate=f=>operation.evaluate({
  authority:'SHADOW',status:'PLANNING_CANDIDATE',
  claimActionEnabled:false,availableClaimSlots:1
},{
  authority:'SHADOW',status:'ADVISORY_ONLY',
  claimActionEnabled:false,placementEnabled:false,
  topCandidates:[{roomName:'E2N3',parentRoom:'E2N2',hops:1}]
},[f.parent],f.game,f.memory,{
  schemaVersion:1,authority:'SHADOW_EVIDENCE',actionAuthority:'NONE',
  claimActionEnabled:false,status:'OBSERVATIONS_AVAILABLE',
  lastTick:f.game.time,requiredTicks:100,rooms:[{
    room:'E2N2',status:'CONTINUOUS_SUPPORT_OBSERVED',
    reason:null,actionAuthority:'NONE',claimActionEnabled:false,
    firstTick:f.game.time-99,lastTick:f.game.time,
    consecutiveSupportTicks:100,requiredTicks:100
  }]
});

{
  const f=fixture();
  assert.equal(site.MAX_CANDIDATES,16);
  assert.equal(site._test.sites(f.intel.E2N3).length,16);
  const first=site.assess(f.game,f.parent,f.intel.E2N3,['E2N3'],0);
  assert.equal(first.status,'REJECTED','No spawn on top of controller');
  assert.equal(calls,0);
  const second=site.assess(f.game,f.parent,f.intel.E2N3,['E2N3'],1);
  assert.equal(second.status,'PASS');
  assert.deepEqual(second.site,pos(25,20,'E2N3'));
  assert.equal(second.checkedRoutes,4,'Parent-to-spawn, controller and two sources');
  assert.equal(second.pathCost,40);
  assert.equal(forbiddenRoomAllowed,false);
  assert.equal(calls,4);
}
{
  const f=fixture();
  delete f.game.rooms.E2N3;
  assert.equal(site.assess(f.game,f.parent,f.intel.E2N3,['E2N3'],1).reason,
    'COMPLETE_ROUTE_VISION_REQUIRED');
  assert.equal(site.assess(f.game,f.parent,f.intel.E2N3,['E2N3'],1).status,'DEFERRED');
}
{
  const f=fixture();
  f.game.rooms.E2N3=makeRoom('E2N3',f.intel.E2N3,{hostiles:[{id:'enemy'}]});
  assert.equal(site.assess(f.game,f.parent,f.intel.E2N3,['E2N3'],1).status,'DEFERRED');
}
{
  const f=fixture();
  const middle=makeRoom('E2N4',f.intel.E2N3);
  middle.controller.owner={username:'Other'};
  f.game.rooms.E2N4=middle;
  assert.equal(site.assess(f.game,f.parent,f.intel.E2N3,['E2N4','E2N3'],1).status,
    'DEFERRED','Current rival ownership overrides old neutral route data');
}
{
  const f=fixture();
  f.game.rooms.E2N3=makeRoom('E2N3',f.intel.E2N3,{walls:new Set(['25,20'])});
  assert.equal(site.assess(f.game,f.parent,f.intel.E2N3,['E2N3'],1).status,'REJECTED');
}
{
  const f=fixture();
  f.game.rooms.E2N3=makeRoom('E2N3',f.intel.E2N3,{blocked:new Set(['25,20'])});
  assert.equal(site.assess(f.game,f.parent,f.intel.E2N3,['E2N3'],1).status,'REJECTED');
}
{
  const f=fixture();
  f.game.rooms.E2N3.controller.owner={username:'Other'};
  assert.equal(site.assess(f.game,f.parent,f.intel.E2N3,['E2N3'],1).status,'DEFERRED');
}
{
  const f=fixture();
  f.game.rooms.E2N3.find=kind=>kind===FIND_SOURCES?[]:[];
  assert.equal(site.assess(f.game,f.parent,f.intel.E2N3,['E2N3'],1).status,'DEFERRED');
}
{
  const f=fixture();
  pathIncomplete=true;
  assert.equal(site.assess(f.game,f.parent,f.intel.E2N3,['E2N3'],1).reason,
    'CREEP_PATH_UNVERIFIED');
  pathIncomplete=false;
}
{
  const f=fixture();
  calls=0;
  assert.equal(evaluate(f).phase,'ROUTE_CHECK');
  assert.equal(evaluate(f).phase,'SUPPORT_CHECK');
  assert.equal(evaluate(f).phase,'AWAITING_TILE_VALIDATION');
  assert.equal(evaluate(f).reason,'SPAWN_TILE_GEOMETRY_BLOCKED');
  assert.equal(calls,0,'Rejected tile does not invoke PathFinder');
  f.game.cpu.getUsed=()=>35;
  assert.equal(evaluate(f).reason,'SITE_CPU_HEADROOM_DEFERRED');
  assert.equal(calls,0);
  f.game.cpu.getUsed=()=>10;
  const ready=evaluate(f);
  assert.equal(ready.phase,'SITE_VERIFIED_ADVISORY');
  assert.equal(ready.spawnTileVerified,true);
  assert.equal(ready.tilePathVerified,true);
  assert.equal(ready.readyForClaim,false);
  assert.equal(ready.claimActionEnabled,false);
  assert.deepEqual(ready.spawnSite,pos(25,20,'E2N3'));
  assert.equal(calls,4);
  assert.equal(evaluate(f).phase,'SITE_VERIFIED_ADVISORY');
  f.game.time=1251;
  for(const rec of Object.values(f.intel)) rec.observation.lastSeenTick=1200;
  const expired=evaluate(f);
  assert.equal(expired.phase,'ROUTE_CHECK');
  assert.equal(expired.reason,'SITE_EVIDENCE_EXPIRED_RECHECK');
  assert.equal(expired.tilePathVerified,false);
  assert.equal(expired.spawnSite,null);
}
{
  const f=fixture();
  evaluate(f);evaluate(f);evaluate(f);
  // No positional/vision proof can become claim authority even when 16
  // geometrically plausible candidates all fail.
  f.game.rooms.E2N3.getTerrain=()=>({get:()=>1});
  for(let i=0;i<16;i++) evaluate(f);
  const b=evaluate(f);
  assert.equal(b.phase,'BACKOFF');
  assert.equal(b.readyForClaim,false);
}
const source=fs.readFileSync(path.resolve(here,'../game/expansion.site.shadow.js'),'utf8');
for(const forbidden of ['.claimController(','.reserveController(',
  '.spawnCreep(','.createConstructionSite(','.createSpawn(']) {
  assert.equal(source.includes(forbidden),false,
    'Spawn site shadow must not issue gameplay intents: '+forbidden);
}
console.log('I4 visible spawn-site/path shadow tests passed');
