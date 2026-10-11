import assert from 'node:assert/strict';
import {extractWorldRooms,sampleWorldRooms,fallbackProbeRooms,verifyShardName,selectStrategicWinner} from './world-scout-core.mjs';
assert.deepEqual(extractWorldRooms({rooms:['W1N1','W1N1','E2S3','not-a-room']}),['E2S3','W1N1']);
assert.deepEqual(extractWorldRooms({rooms:{W1N1:{}, E2S3:{}}}),['E2S3','W1N1']);
assert.deepEqual(extractWorldRooms({rooms:[{room:'E2S3'}, {name:'W1N1'}]}),['E2S3','W1N1']);
assert.deepEqual(sampleWorldRooms(['E2S3','W1N1'],24),['E2S3','W1N1']);
assert.equal(sampleWorldRooms(Array.from({length:100},(_,i)=>'E'+(i+1)+'S1'),12).length,12);
assert.throws(()=>sampleWorldRooms(['E2S3'],251),/limit/);
assert.equal(verifyShardName('shard3'),'shard3');
assert.equal(verifyShardName('shardX'),'shardX');
assert.throws(()=>verifyShardName('shard3; echo leak'),/Invalid/);
const report=(shard,score,status='normal')=>({server:'world',shard,options:{deep:true,place:false},selected:{
  room:'E2S3',x:24,y:25,strategicScore:score,categoryScores:{compositeScore:4},
  deepAnalysis:{freshness:'fresh-api'},statusVerification:{status}}});
assert.equal(selectStrategicWinner([{shard:'shard1',report:report('shard1',120)},
  {shard:'shard2',report:report('shard2',125)}]).shard,'shard2');
assert.equal(selectStrategicWinner([{shard:'shard1',report:report('shard1',300,'novice')},
  {shard:'shard2',report:report('shard2',125)}]).shard,'shard2');
assert.equal(selectStrategicWinner([{shard:'shard1',report:report('shard2',900)}]),null);
assert.equal(selectStrategicWinner([{shard:'shardX',report:report('shardX',999)},
  {shard:'shard3',report:report('shard3',100)}]).shard,'shard3',
  'Restricted shardX must not win without verified access');
const fallback = fallbackProbeRooms(null,24);
assert.equal(fallback.length,24,'unknown world size must yield bounded fallback');
assert.equal(new Set(fallback).size,24,'no duplicate probe rooms');
assert.ok(fallback.every(name => /^[WE]\\d+[NS]\\d+$/.test(name)), 'only valid room names');
assert.deepEqual(fallbackProbeRooms(null,24),fallback,'probes must be deterministic');
assert.equal(fallbackProbeRooms({width:96,height:96},24).length,24);
assert.ok(fallbackProbeRooms({width:16,height:16},24).length <=24);
assert.throws(()=>fallbackProbeRooms(null,251),/candidate limit/);
console.log('World scouting selection (offline only): PASS');
