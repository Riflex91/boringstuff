import assert from 'node:assert/strict';
import {extractWorldRooms,sampleWorldRooms,fallbackProbeRooms,verifyShardName,selectStrategicWinner,summarizeWorldRemoteRouting} from './world-scout-core.mjs';
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

const routing=(total,reachable,inaccessible)=>({deepAnalysis:{remoteRoutes:{
  totalSources:total,reachableSources:reachable,inaccessibleSources:inaccessible}}});
assert.deepEqual(summarizeWorldRemoteRouting(routing(5,2,3)),{
  status:'review',totalSources:5,reachableSources:2,inaccessibleSources:3,needsReview:true},
'Unreachable sources must trigger operator review without changing the score');
assert.deepEqual(summarizeWorldRemoteRouting(routing(5,5,0)),{
  status:'clear',totalSources:5,reachableSources:5,inaccessibleSources:0,needsReview:false});
assert.deepEqual(summarizeWorldRemoteRouting(routing(0,0,0)),{
  status:'review',totalSources:0,reachableSources:0,inaccessibleSources:0,needsReview:true},
'Zero observed remote sources should not silently pass');
for (const invalid of [null,{},routing(5,6,-1),routing(5,2,2),
  routing(5,NaN,0),routing(2.5,2,0.5)]) {
  assert.deepEqual(summarizeWorldRemoteRouting(invalid),{
    status:'unverified',totalSources:null,reachableSources:null,
    inaccessibleSources:null,needsReview:true}, 'Missing or malformed remote evidence must fail closed');
}

const fallback = fallbackProbeRooms(null,24);
assert.equal(fallback.length,24,'unknown world size must yield bounded fallback');
assert.equal(new Set(fallback).size,24,'no duplicate probe rooms');
assert.ok(fallback.every(name => /^[WE]\d+[NS]\d+$/.test(name)), 'only valid room names');
assert.deepEqual(fallbackProbeRooms(null,24),fallback,'probes must be deterministic');
for (const n of [48,96]) {
  const probes=fallbackProbeRooms(null,n);
  assert.equal(probes.length,n,`${n} distinct World probe rooms`);
  assert.equal(new Set(probes).size,n);
  assert.deepEqual(fallbackProbeRooms(null,n),probes,'deeper probing must be deterministic');
  assert.deepEqual(probes.slice(0,24),fallback,'deeper scan must retain the entire earlier 24-room sample');
  assert.ok(probes.slice(24).some(room => !fallback.includes(room)), 'deeper scan adds genuinely new rooms');
}
assert.equal(fallbackProbeRooms({width:96,height:96},24).length,24);
assert.ok(fallbackProbeRooms({width:16,height:16},24).length <=24);
assert.throws(()=>fallbackProbeRooms(null,251),/candidate limit/);
console.log('World scouting selection (offline only): PASS');
