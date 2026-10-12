import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import Module from 'node:module';
import fs from 'node:fs';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);
const operation = require('../game/expansion.operation.shadow.js');

const readiness = {authority:'SHADOW',status:'PLANNING_CANDIDATE',
  availableClaimSlots:1,claimActionEnabled:false};
const advisory = {authority:'SHADOW',status:'ADVISORY_ONLY',
  claimActionEnabled:false,placementEnabled:false,
  topCandidates:[{roomName:'E2N3',parentRoom:'E2N2',hops:1,reconScore:72}]};
const owned = (options={}) => ({
  room:{name:'E2N2',controller:{my:true}},spawn:{name:'First'},
  rcl:5,emergency:false,health:{status:'HEALTHY'},
  hostileCreeps:[],economyModel:{haulerCarryDeficit:0},
  energyCapacityAvailable:1050,energyAvailable:1050,energyStored:6000,
  creeps:[
    {memory:{role:'harvester'}},{memory:{role:'harvester'}},
    {memory:{role:'hauler'}},{memory:{role:'hauler'}},
    {memory:{role:'upgrader',waitingEnergyTicks:0,logisticsFallback:false}}
  ],...options
});
function record(name, exits, mine=false, options={}) {
  return {schemaVersion:1,roomName:name,
    observation:{lastSeenTick:1000,confidence:1,source:'visible-room'},
    classification:{roomStatus:'normal'},
    controller:{exists:true,my:mine,owner:mine?'Me':null,
      reservationOwner:null,level:mine?5:0},
    resources:{sourceCount:2,sources:[0,1].map(i=>({
      id:'source-'+name+i,pos:{x:10+i,y:15,roomName:name}
    })),mineral:null},
    topology:{exits:exits.map(roomName=>({roomName}))},
    structures:{count:0,ownedByType:{}},
    threat:{hostileCreeps:0,lastHostileTick:null},
    ...options
  };
}
function fixture() {
  const rooms = {
    E2N2:record('E2N2',['E2N3'],true),
    E2N3:record('E2N3',['E2N2'])
  };
  let calls = 0;
  const game = {time:1050,cpu:{limit:40,bucket:10000,getUsed:()=>10},
    map:{findRoute:(_from,_to,opts)=>{
      calls++;
      assert.equal(opts.routeCallback('E2N3'),1);
      return [{room:'E2N3',exit:3}];
    }}};
  const memory = {bot:{worldIntel:{rooms}}};
  return {rooms,game,memory,get calls(){return calls;}};
}
const evaluate=(f,r=readiness,a=advisory,states=[owned()])=>
  operation.evaluate(r,a,states,f.game,f.memory);

{
  const f=fixture();
  const a=evaluate(f);
  assert.equal(a.phase,'ROUTE_CHECK');
  assert.equal(a.routeLevel,'UNVERIFIED');
  assert.equal(f.calls,0,'Route search deferred to a separate snapshot');
  const b=evaluate(f);
  assert.equal(b.phase,'SUPPORT_CHECK');
  assert.equal(b.routeHops,1);
  assert.equal(b.routeLevel,'ROOM_LEVEL_ONLY');
  assert.equal(f.calls,1);
  const c=evaluate(f);
  assert.equal(c.phase,'AWAITING_TILE_VALIDATION');
  assert.equal(c.reason,'TILE_PATH_AND_SPAWN_SITE_NOT_VERIFIED');
  const deferred=evaluate(f);
  assert.equal(deferred.phase,'AWAITING_TILE_VALIDATION');
  assert.equal(deferred.reason,'SPAWN_GEOMETRY_INTEL_MISSING');
  assert.deepEqual(evaluate(f),deferred,'Missing tile intel never upgrades to claim readiness');
  for (const snapshot of [a,b,c]) {
    assert.equal(snapshot.authority,'SHADOW');
    assert.equal(snapshot.claimActionEnabled,false);
    assert.equal(snapshot.spawnActionEnabled,false);
    assert.equal(snapshot.constructionActionEnabled,false);
    assert.equal(snapshot.readyForClaim,false);
    assert.equal(snapshot.tilePathVerified,false);
    assert.equal(snapshot.spawnTileVerified,false);
  }
}
{
  const f=fixture();
  evaluate(f);
  f.game.cpu.getUsed=()=>35;
  assert.equal(evaluate(f).reason,'CPU_HEADROOM_DEFERRED');
  assert.equal(f.calls,0,'Never route-search without CPU headroom');
  f.game.cpu.getUsed=()=>10;
  f.game.cpu.bucket=3000;
  assert.equal(evaluate(f).reason,'CPU_HEADROOM_DEFERRED');
  assert.equal(f.calls,0,'Never route-search under low bucket');
}
{
  const f=fixture();
  evaluate(f);
  f.game.map.findRoute=()=>[{room:'E2N4'},{room:'E2N3'}];
  const bad=evaluate(f);
  assert.equal(bad.phase,'BACKOFF');
  assert.equal(bad.reason,'SAFE_ROOM_ROUTE_UNVERIFIED');
  assert.equal(bad.blockedUntil,1150);
  f.game.time=1090;
  assert.equal(evaluate(f).reason,'BACKOFF_ACTIVE');
  f.game.time=1150;
  assert.equal(evaluate(f).phase,'ROUTE_CHECK','Automatic retry after backoff');
}
{
  const f=fixture();
  evaluate(f);
  f.rooms.E2N3.topology.exits=[];
  assert.equal(evaluate(f).phase,'BACKOFF',
    'A one-way/intel-inconsistent room edge is not proof of a safe route');
}
{
  const f=fixture();
  evaluate(f);
  f.rooms.E2N3.controller.owner='Rival';
  assert.equal(evaluate(f).phase,'BACKOFF');
  assert.equal(evaluate(f).reason,'BACKOFF_ACTIVE');
}
{
  const f=fixture();
  evaluate(f);
  f.rooms.E2N3.observation.lastSeenTick=700;
  assert.equal(evaluate(f).reason,'FRESH_SAFE_INTEL_OR_PARENT_MISSING');
}
{
  const f=fixture();
  evaluate(f);evaluate(f);
  assert.equal(evaluate(f,readiness,advisory,[owned({energyStored:900})]).reason,
    'PARENT_SUPPORT_RESERVE_INSUFFICIENT');
  assert.equal(evaluate(f,readiness,advisory,[owned({energyStored:6000})]).phase,
    'AWAITING_TILE_VALIDATION','Recover automatically when the reserve returns');
}
{
  const f=fixture();
  evaluate(f);
  const hold=evaluate(f,{...readiness,availableClaimSlots:0});
  assert.equal(hold.phase,'HOLD');
  assert.equal(hold.readyForClaim,false);
  assert.equal(evaluate(f).phase,'ROUTE_CHECK',
    'Re-evaluate capability after claim slots return');
}
{
  const f=fixture();
  f.memory.bot.expansionOperationShadow={schemaVersion:0,phase:'CLAIMING',
    candidateRoom:'E2N3',parentRoom:'E2N2',failureCount:1};
  assert.equal(evaluate(f).phase,'ROUTE_CHECK','Invalid schema fails closed');
  assert.equal(f.memory.bot.expansionOperationShadow.schemaVersion,1);
}
{
  const f=fixture();
  assert.equal(evaluate(f,{...readiness,claimActionEnabled:true}).phase,'HOLD');
  assert.equal(evaluate(f,readiness,{...advisory,placementEnabled:true}).phase,'HOLD');
}
// Parent support is a read-only preflight; claim and spawn authority remain off.
// A healthy status alone does not prove replenished energy or redundancy.
{
  const support=require('../game/expansion.parent.support.shadow.js');
  const healthy=owned();
  const original=JSON.stringify(healthy);
  const pass=support.assess(healthy);
  assert.equal(pass.status,'ADVISORY_OK');
  assert.equal(pass.claimActionEnabled,false);
  assert.equal(pass.spawnActionEnabled,false);
  assert.equal(pass.supportActionEnabled,false);
  assert.equal(JSON.stringify(healthy),original);
  const scenarios=[
    [owned({energyAvailable:53}),'PARENT_INFRASTRUCTURE_REFILL_PRESSURE'],
    [owned({energyAvailable:undefined}),'PARENT_INFRASTRUCTURE_ENERGY_UNVERIFIED'],
    [owned({energyAvailable:1100}),'PARENT_INFRASTRUCTURE_ENERGY_UNVERIFIED'],
    [owned({energyAvailable:944}),'PARENT_INFRASTRUCTURE_REFILL_PRESSURE'],
    [owned({energyStored:1000}),'PARENT_SUPPORT_RESERVE_INSUFFICIENT'],
    [owned({creeps:undefined}),'PARENT_WORKFORCE_UNVERIFIED'],
    [owned({creeps:healthy.creeps.slice(0,3)}),
      'PARENT_MINING_OR_HAULING_REDUNDANCY_LOW'],
    [owned({creeps:healthy.creeps.map((c,i)=>i===4?
      {memory:{...c.memory,waitingEnergyTicks:5}}:c)}),
      'PARENT_CONSUMER_SUPPLY_PRESSURE'],
    [owned({creeps:healthy.creeps.map((c,i)=>i===4?
      {memory:{...c.memory,logisticsFallback:true}}:c)}),
      'PARENT_CONSUMER_SUPPLY_PRESSURE'],
    [owned({health:{status:'RECOVERING'}}),'PARENT_NOT_STABLE']
  ];
  for(const [parent,reason] of scenarios){
    const result=support.assess(parent);
    assert.equal(result.reason,reason);
    assert.equal(result.status,'HOLD');
    assert.equal(result.claimActionEnabled,false);
  }
  assert.equal(support.assess(owned({energyAvailable:945})).status,
    'ADVISORY_OK');
}
{
  const f=fixture();
  evaluate(f);evaluate(f);
  assert.equal(evaluate(f).phase,'AWAITING_TILE_VALIDATION');
  const blocked=evaluate(f,readiness,advisory,[owned({energyAvailable:53})]);
  assert.equal(blocked.phase,'SUPPORT_CHECK');
  assert.equal(blocked.reason,'PARENT_INFRASTRUCTURE_REFILL_PRESSURE');
  assert.equal(blocked.readyForClaim,false);
  assert.equal(evaluate(f,readiness,advisory,[owned()]).phase,
    'AWAITING_TILE_VALIDATION');

  const state=f.memory.bot.expansionOperationShadow;
  state.phase='SITE_VERIFIED_ADVISORY';
  state.verifiedSite={x:25,y:25,roomName:'E2N3'};
  state.pathCost=123;
  state.siteVerifiedTick=f.game.time;
  state.siteCursor=2;
  const parent=owned({creeps:owned().creeps.map((c,i)=>i===4?
    {memory:{...c.memory,logisticsFallback:true}}:c)});
  const revoked=evaluate(f,readiness,advisory,[parent]);
  assert.equal(revoked.phase,'SUPPORT_CHECK');
  assert.equal(revoked.reason,'PARENT_CONSUMER_SUPPLY_PRESSURE');
  assert.equal(revoked.spawnTileVerified,false);
  assert.equal(revoked.spawnSite,null);
  assert.equal(state.verifiedSite,null);
  assert.equal(state.siteCursor,0);
}

const source=fs.readFileSync(path.resolve(here,
  '../game/expansion.operation.shadow.js'),'utf8');
for(const forbidden of ['.claimController(','.reserveController(',
  '.spawnCreep(','.createConstructionSite(','.createSpawn(']) {
  assert.equal(source.includes(forbidden),false,
    'Preflight never issues gameplay intents: '+forbidden);
}
console.log('I4 expansion preflight state machine shadow tests passed');
