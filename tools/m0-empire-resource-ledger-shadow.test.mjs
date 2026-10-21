import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import Module from 'node:module';

const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);
const ledger=require('../game/empire.resource.ledger.shadow.js');

function colony(name, structures=[], creeps=[], owner=true) {
  return {
    room:{name,controller:{my:owner}},
    structures,creeps,
    energyStored:99999999, // legacy figure is NOT additive evidence
    energyAvailable:99999999
  };
}
function structure(id,structureType,store,my=true,owner=undefined) {
  return {id,structureType,store,my,owner};
}
function creep(id,store,my=true) {
  return {id,store,my};
}
{
  const a=colony('E8N1',[
    structure('a-store','storage',{energy:2000,H:40}),
    structure('a-spawn','spawn',{energy:300}),
    structure('a-neutral','container',{energy:100},false),
    structure('a-enemy','storage',{energy:40000},false),
    structure('a-enemy-container','container',{energy:600},false,{username:'other'})
  ],[creep('a-hauler',{energy:90}),creep('a-miner',{energy:10})]);
  const b=colony('E7N1',[
    structure('b-terminal','terminal',{energy:700,Z:25}),
    structure('b-factory','factory',{energy:50})
  ],[creep('b-hauler',{energy:5,Z:2})]);
  const before=JSON.stringify([a,b]);
  const x=ledger.snapshot([a,b],12345);
  assert.equal(x.schemaVersion,1);
  assert.equal(x.authority,'SHADOW');
  assert.equal(x.actionEnabled,false);
  assert.equal(x.availableToCommit,null,'gross energy is not spendable reserve');
  assert.equal(x.tick,12345);
  assert.equal(x.status,'OBSERVED');
  assert.deepEqual(x.reasonCodes,[]);
  assert.deepEqual(x.rooms.map(r=>r.roomName),['E7N1','E8N1']);
  assert.deepEqual(x.totals.structures,{H:40,Z:25,energy:3150});
  assert.deepEqual(x.totals.carried,{Z:2,energy:105});
  assert.deepEqual(x.rooms[1].resources.structures,{H:40,energy:2400});
  assert.deepEqual(x.rooms[0].resources.carried,{Z:2,energy:5});
  assert.deepEqual(x.productionInfrastructure,{labs:0,factories:1,terminals:1,powerSpawns:0});
  assert.deepEqual(x.rooms[0].productionInfrastructure,{labs:0,factories:1,terminals:1,powerSpawns:0});
  assert.deepEqual(x.rooms[1].productionInfrastructure,{labs:0,factories:0,terminals:0,powerSpawns:0});
  assert.equal(x.productionReadyToUse,null);
  assert.equal(x.rooms[0].productionReadyToUse,null);
  assert.equal(x.rooms[0].availableToCommit,null);
  assert.equal(JSON.stringify([a,b]),before,'snapshot is side-effect free');
}
// M0: infrastructure presence is read-only evidence, never lab/reaction
// readiness. Ignore neutral and hostile facilities; never invoke methods
// that could have side effects or conflate gross stock with free capacity.
{
  const readyProbe=()=>{throw new Error('isActive must not be used');};
  const room=colony('E8N1',[
    {...structure('lab-one','lab',{energy:30,X:5}),isActive:readyProbe},
    structure('lab-two','lab',{energy:20}),
    structure('factory-one','factory',{energy:100}),
    structure('terminal-one','terminal',{energy:80}),
    structure('power-one','powerSpawn',{energy:60,power:2}),
    structure('enemy-lab','lab',{energy:500},false,{username:'enemy'}),
    structure('neutral-lab','lab',{energy:200},false)
  ]);
  const v=ledger.snapshot([room],37);
  assert.equal(v.status,'OBSERVED');
  assert.deepEqual(v.productionInfrastructure,
    {labs:2,factories:1,terminals:1,powerSpawns:1});
  assert.deepEqual(v.rooms[0].productionInfrastructure,v.productionInfrastructure);
  assert.equal(v.productionReadyToUse,null);
  assert.equal(v.rooms[0].productionReadyToUse,null);
  assert.equal(v.availableToCommit,null);
  assert.deepEqual(v.totals.structures,{X:5,energy:290,power:2});
}
{
  const duplicate=ledger.snapshot([
    colony('E8N1',[structure('shared-factory','factory',{energy:50})]),
    colony('E7N1',[structure('shared-factory','factory',{energy:500})])
  ],38);
  assert.equal(duplicate.status,'PARTIAL');
  assert.ok(duplicate.reasonCodes.includes('ENTITY_ID_MISSING_OR_DUPLICATE'));
  assert.deepEqual(duplicate.productionInfrastructure,
    {labs:0,factories:1,terminals:0,powerSpawns:0},
    'same device ID cannot inflate empire manufacturing counts');
  assert.equal(duplicate.availableToCommit,null);
}
{
  const prototype=ledger.snapshot([colony('E8N1',[
    structure('unexpected','__proto__',{energy:4})
  ])],39);
  assert.equal(prototype.status,'OBSERVED');
  assert.deepEqual(prototype.productionInfrastructure,
    {labs:0,factories:0,terminals:0,powerSpawns:0});
}
{
  const unknownOwner=colony('E8N1',[],[],false);
  const x=ledger.snapshot([unknownOwner],10);
  assert.equal(x.status,'PARTIAL');
  assert.ok(x.reasonCodes.includes('ROOM_OWNERSHIP_UNVERIFIED'));
  assert.ok(x.reasonCodes.includes('NO_VERIFIED_OWNED_ROOM'));
  assert.equal(x.rooms.length,0,'unknown ownership cannot create a colony');
}
{
  const dup=colony('E8N1',[structure('x','storage',{energy:50})],
    [creep('x',{energy:999})]);
  const x=ledger.snapshot([dup],20);
  assert.equal(x.status,'PARTIAL');
  assert.ok(x.reasonCodes.includes('ENTITY_ID_MISSING_OR_DUPLICATE'));
  assert.deepEqual(x.totals.structures,{energy:50});
  assert.deepEqual(x.totals.carried,{});
  assert.equal(x.availableToCommit,null);
}
{
  const a=colony('E8N1',[structure('large','storage',{energy:Number.MAX_SAFE_INTEGER})]);
  const b=colony('E7N1',[structure('small','storage',{energy:1})]);
  const x=ledger.snapshot([a,b],21);
  assert.equal(x.status,'PARTIAL');
  assert.ok(x.reasonCodes.includes('RESOURCE_OVERFLOW'));
  assert.equal(x.availableToCommit,null);
}
// Defensive/utility structures have no Store and must not force PARTIAL
// on every real fortified room. All actual stock remains strictly accounted.
{
  const room=colony('E8N1',[
    structure('rampart-a','rampart',undefined,true),
    structure('wall-a','constructedWall',null,true),
    structure('road-a','road',undefined,true),
    structure('observer-a','observer',undefined,true),
    structure('extractor-a','extractor',undefined,true),
    structure('controller-a','controller',undefined,true),
    structure('storage-a','storage',{energy:1250,H:3},true),
    structure('source-container','container',{energy:175},false),
  ],[creep('carrier',{energy:25})]);
  const result=ledger.snapshot([room],31);
  assert.equal(result.status,'OBSERVED',
    'ordinary owned non-store structures may not invalidate a verified census');
  assert.deepEqual(result.reasonCodes,[]);
  assert.deepEqual(result.totals.structures,{H:3,energy:1425});
  assert.deepEqual(result.totals.carried,{energy:25});
  assert.equal(result.availableToCommit,null);
}
// Do not silently ignore unknown new structure types or known resource
// structures with missing stores: their unverified inventory is a hard HOLD
// for prospective reserve and market/allocation consumers.
for (const type of ['storage','terminal','spawn','lab','factory','customStore']) {
  const bad=ledger.snapshot([colony('E8N1',[
    structure('missing-'+type,type,undefined,true),
    structure('other','storage',{energy:10},true)
  ])],32);
  assert.equal(bad.status,'PARTIAL',type+' missing store is unverified');
  assert.ok(bad.reasonCodes.includes('STORE_MISSING'));
  assert.equal(bad.availableToCommit,null);
}
// Forward-compatible owned store-bearing types are included even when
// their type has not yet appeared in the baseline Screeps structure roster.
{
  const result=ledger.snapshot([colony('E8N1',[
    structure('future','newStoreType',{energy:3,X:9},true)
  ])],33);
  assert.equal(result.status,'OBSERVED');
  assert.deepEqual(result.totals.structures,{X:9,energy:3});
}

{
  const broken=colony('E8N1',[
    structure('invalid','storage',{energy:-3,Z:NaN}),
    structure('missing','terminal',null)
  ],[creep('invalid-creep',{energy:3.2})]);
  const x=ledger.snapshot([broken],22);
  assert.equal(x.status,'PARTIAL');
  assert.ok(x.reasonCodes.includes('INVALID_RESOURCE_AMOUNT'));
  assert.ok(x.reasonCodes.includes('STORE_MISSING'));
  assert.deepEqual(x.totals.structures,{});
  assert.deepEqual(x.totals.carried,{});
}
{
  const x=ledger.snapshot([colony('E8N1',[],[]),colony('E8N1',[],[])],23);
  assert.equal(x.status,'PARTIAL');
  assert.ok(x.reasonCodes.includes('ROOM_NAME_MISSING_OR_DUPLICATE'));
  assert.equal(x.rooms.length,1);
}
{
  const x=ledger.snapshot([colony('E8N1',null,[])],24);
  assert.equal(x.status,'PARTIAL');
  assert.ok(x.reasonCodes.includes('ROOM_INVENTORY_INCOMPLETE'));
  assert.equal(x.availableToCommit,null);
  assert.deepEqual(x.totals.structures,{});
}
for(const args of [
  [null,10],[{},10],[[],null],[[], -1],
  [Array.from({length:26},(_,i)=>colony('E'+i+'N1')),20]
]) {
  const x=ledger.snapshot(...args);
  assert.equal(x.status,'HOLD');
  assert.deepEqual(x.reasonCodes,['INPUT_UNVERIFIED']);
  assert.equal(x.availableToCommit,null);
}
// M0: observed infrastructure refill demand and reported starvation are
// distinct from strategic reserves and must never grant transfer authority.
{
  const state=colony('E8N1',[
    structure('storage-needs','storage',{energy:9000})
  ],[
    {...creep('upgrader-needs',{energy:0}),memory:{
      role:'upgrader',waitingEnergyTicks:5,logisticsFallback:true}},
    {...creep('builder-needs',{energy:20}),memory:{
      role:'builder',waitingEnergyTicks:2}},
    {...creep('repairer-needs',{energy:10}),memory:{
      role:'repairer',waitingEnergyTicks:0,logisticsFallback:false}},
    {...creep('worker-needs',{energy:20}),memory:{role:'worker'}},
    {...creep('scout-needs',{}),memory:{role:'scout',
      waitingEnergyTicks:100,logisticsFallback:true}}
  ]);
  state.energyAvailable=300;
  state.energyCapacityAvailable=800;
  const before=JSON.stringify(state);
  const v=ledger.snapshot([state],40);
  assert.equal(v.status,'OBSERVED');
  assert.deepEqual(v.rooms[0].strategicNeeds,{
    status:'OBSERVED',reasonCodes:[],spawnExtensionRefillDeficit:500,
    reportedWaitingConsumers:2,reportedFallbackConsumers:1,
    verifiedStrategicReserve:null,verifiedSupportCapacity:null,
    availableForExternalAllocation:null
  });
  assert.equal(v.availableToCommit,null);
  assert.equal(v.actionEnabled,false);
  assert.equal(JSON.stringify(state),before,'strategic analysis remains pure');
}
{
  const state=colony('E8N1',[],[
    {...creep('upgrader-needs',{energy:0}),memory:{
      role:'upgrader',waitingEnergyTicks:5,logisticsFallback:true}}
  ]);
  state.energyAvailable=800;
  state.energyCapacityAvailable=800;
  const v=ledger.snapshot([state],41);
  assert.equal(v.rooms[0].strategicNeeds.spawnExtensionRefillDeficit,0);
  assert.equal(v.rooms[0].strategicNeeds.reportedWaitingConsumers,1);
  assert.equal(v.rooms[0].strategicNeeds.reportedFallbackConsumers,1);
  assert.equal(v.rooms[0].strategicNeeds.availableForExternalAllocation,null,
    'full spawn/extensions do not prove exportable energy');
}
for(const bad of [
  {energyAvailable:-1,energyCapacityAvailable:800},
  {energyAvailable:801,energyCapacityAvailable:800},
  {energyAvailable:20.5,energyCapacityAvailable:800},
  {energyAvailable:0,energyCapacityAvailable:0},
  {energyAvailable:10,energyCapacityAvailable:null}
]){
  const state={...colony('E8N1'),...bad};
  const v=ledger.snapshot([state],42);
  assert.equal(v.status,'OBSERVED',
    'stock census and separate refill-signal quality are independent');
  assert.equal(v.rooms[0].strategicNeeds.status,'PARTIAL');
  assert.ok(v.rooms[0].strategicNeeds.reasonCodes.includes(
    'INFRASTRUCTURE_ENERGY_UNVERIFIED'));
  assert.equal(v.rooms[0].strategicNeeds.spawnExtensionRefillDeficit,null);
  assert.equal(v.rooms[0].strategicNeeds.availableForExternalAllocation,null);
}
{
  const state=colony('E8N1',[],[
    creep('missing-memory',{energy:5}),
    {...creep('broken-memory',{energy:5}),memory:{
      role:'worker',waitingEnergyTicks:-2,logisticsFallback:'yes'}},
    {...creep('known-worker',{energy:5}),memory:{
      role:'worker',waitingEnergyTicks:7,logisticsFallback:true}}
  ]);
  // Isolate invalid memory signals: the independent room energy input is
  // deliberately complete so refill remains a verified zero.
  state.energyCapacityAvailable=state.energyAvailable;
  const v=ledger.snapshot([state],43);
  const needs=v.rooms[0].strategicNeeds;
  assert.equal(needs.status,'PARTIAL');
  assert.ok(needs.reasonCodes.includes('CONSUMER_MEMORY_UNVERIFIED'));
  assert.ok(needs.reasonCodes.includes('CONSUMER_PRESSURE_UNVERIFIED'));
  assert.equal(needs.spawnExtensionRefillDeficit,0);
  assert.equal(needs.reportedWaitingConsumers,null);
  assert.equal(needs.reportedFallbackConsumers,null);
  assert.equal(needs.verifiedStrategicReserve,null);
  assert.equal(needs.verifiedSupportCapacity,null);
}
console.log('M0 passive resource ledger ownership, double-count, invalid-stock and reserve HOLD PASS');
