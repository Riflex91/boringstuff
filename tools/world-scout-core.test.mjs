import assert from 'node:assert/strict';
import {extractWorldRooms,sampleWorldRooms,fallbackProbeRooms,verifyShardName,selectStrategicWinner,summarizeWorldRemoteRouting,selectRouteClearCandidate,summarizeWorldBuildability} from './world-scout-core.mjs';
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


const deepRoom=(roomName,score,reachable=5,total=5)=>({
  roomName,eligible:true,controller:{owner:null,reservation:null},
  best:{x:12,y:13,blueprint:{complete:true,structureRequired:86,structureFit:86,roadFitRatio:0.8},
    layout:{hubReady:true,labReady:true}},strategicScore:score,
  statusVerification:{status:'normal'},
  deepAnalysis:{freshness:'fresh-api',remoteRoutes:{
    totalSources:total,reachableSources:reachable,inaccessibleSources:total-reachable}}
});
const deepReport=(shard,rooms)=>({
  server:'world',shard,scoreModel:'test-model',
  options:{place:false,deep:true},rooms
});
const routeCandidates=[
  {shard:'shard0',report:deepReport('shard0',[
    deepRoom('W37S79',17299.6,2),deepRoom('W37N11',16154.5)])},
  {shard:'shard2',report:deepReport('shard2',[
    deepRoom('E31S15',14894),deepRoom('W15S52',14875,7,7)])}
];
assert.deepEqual(selectRouteClearCandidate(routeCandidates),{
  shard:'shard0',room:'W37N11',x:12,y:13,strategicScore:16154.5,
  scoreModel:'test-model',remoteRouting:{
    status:'clear',totalSources:5,reachableSources:5,inaccessibleSources:0,
    needsReview:false
  },buildability:{status:'clear',structureRequired:86,structureFit:86,
    roadFitRatio:0.8,hubReady:true,labReady:true,needsReview:false}
},'Highest-scoring fully reachable candidate is an advisory, not the overall winner');
assert.equal(selectRouteClearCandidate([
  {shard:'shardX',report:deepReport('shardX',[deepRoom('E3S3',99999)])},
  {shard:'shard2',report:deepReport('shard2',[deepRoom('E31S15',14894)])}
]).shard,'shard2','shardX must never appear in read-only safe shortlist');
const invalidOptions=[
  {...deepRoom('E1S2',100),eligible:false},
  {...deepRoom('E1S2',100),controller:{owner:'other',reservation:null}},
  {...deepRoom('E1S2',100),controller:{owner:null,reservation:'other'}},
  {...deepRoom('E1S2',100),deepAnalysis:{freshness:'cache',remoteRoutes:{
    totalSources:5,reachableSources:5,inaccessibleSources:0}}},
  {...deepRoom('E1S2',100),statusVerification:{status:'novice'}},
  {...deepRoom('E1S2',100),best:{x:0,y:12}},
  {...deepRoom('E1S2',100),deepAnalysis:{freshness:'fresh-api'}},
  deepRoom('E1S2',100,0,0),
  deepRoom('E1S2',100,4,5),
  {...deepRoom('E1S2',100),best:{x:12,y:13}},
  {...deepRoom('E1S2',100),best:{...deepRoom('E1S2',100).best,
    blueprint:{complete:false,structureRequired:86,structureFit:86,roadFitRatio:0.8}}},
  {...deepRoom('E1S2',100),best:{...deepRoom('E1S2',100).best,
    blueprint:{complete:true,structureRequired:86,structureFit:85,roadFitRatio:0.8}}},
  {...deepRoom('E1S2',100),best:{...deepRoom('E1S2',100).best,
    layout:{hubReady:false,labReady:true}}},
  {...deepRoom('E1S2',100),best:{...deepRoom('E1S2',100).best,
    layout:{hubReady:true,labReady:false}}}
];
for (const bad of invalidOptions)
  assert.equal(selectRouteClearCandidate([{shard:'shard0',
    report:deepReport('shard0',[bad])}]),null,
  'Unverified, blocked or restricted candidate must not pass advisory filter');
assert.equal(selectRouteClearCandidate([{shard:'shard0',report:{
  ...deepReport('shard0',[deepRoom('W37N11',123)]),
  options:{place:true,deep:true}
}}]),null,'Placement-enabled reports must be rejected');
assert.equal(selectRouteClearCandidate([]),null);


assert.deepEqual(summarizeWorldBuildability({
  bestTile:deepRoom('W37N11',16154.5).best
}),{status:'clear',structureRequired:86,structureFit:86,roadFitRatio:0.8,
  hubReady:true,labReady:true,needsReview:false},
'Selected bestTile must expose the same buildability as room.best');
assert.equal(summarizeWorldBuildability(null).status,'unverified');
assert.equal(summarizeWorldBuildability({best:{blueprint:{
  complete:true,structureRequired:86,structureFit:87,roadFitRatio:0.8
},layout:{hubReady:true,labReady:true}}}).status,'unverified',
'Impossible fit > required must fail closed');

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
