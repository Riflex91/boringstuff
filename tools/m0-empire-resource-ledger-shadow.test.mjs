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
  assert.equal(x.rooms[0].availableToCommit,null);
  assert.equal(JSON.stringify([a,b]),before,'snapshot is side-effect free');
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
console.log('M0 passive resource ledger ownership, double-count, invalid-stock and reserve HOLD PASS');
