import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);
const evidence=require('../game/logistics.matching.evidence.js');
const check=evidence._test.validatedJobAccounting;

const direct={
  schemaVersion:1,authority:'SHADOW',haulerId:'h1',
  mode:'DIRECT_CARRIED',supplyRequestId:null,demandRequestId:'request-1',
  amount:50,predicted:{transportTicks:5},
  reservationIds:['reservation-1'],requestKind:'EMERGENCY_DELIVER',
  critical:true
};
const directSummary={
  haulerCount:1,matchedHaulerCount:1,jobCount:1,
  pairedJobCount:0,directCarriedJobCount:1,
  criticalMatchedCount:1,reservedAmount:50,averageTransportTicks:5
};
const original=JSON.stringify({direct,directSummary});
assert.equal(check([direct],directSummary),true);
assert.equal(JSON.stringify({direct,directSummary}),original,
  'Accounting verification must never mutate state');

for(const [name,modify] of [
  ['nonshadow authority',x=>x.authority='LIVE'],
  ['unknown version',x=>x.schemaVersion=3],
  ['missing hauler ID',x=>x.haulerId=''],
  ['missing demand ID',x=>x.demandRequestId=null],
  ['zero amount',x=>x.amount=0],
  ['infinite amount',x=>x.amount=Infinity],
  ['negative ETA',x=>x.predicted.transportTicks=-1],
  ['nonfinite ETA',x=>x.predicted.transportTicks=NaN],
  ['no reservation',x=>x.reservationIds=[]],
  ['wrong reservation cardinality',x=>x.reservationIds=['x','y']],
  ['invalid reservation ID',x=>x.reservationIds=['']],
  ['wrong mode',x=>x.mode='THIRD_PARTY_TRANSFER'],
  ['direct with pickup',x=>x.supplyRequestId='req-supply'],
  ['false critical marker',x=>x.critical=false],
  ['nonmatching critical kind',x=>x.requestKind='DELIVER'],
]){
  const bad=structuredClone(direct);
  modify(bad);
  assert.equal(check([bad],directSummary),false,name);
}
for(const [name,modify] of [
  ['false matched count',x=>x.matchedHaulerCount=2],
  ['wrong job count',x=>x.jobCount=2],
  ['wrong paired count',x=>x.pairedJobCount=1],
  ['wrong direct count',x=>x.directCarriedJobCount=0],
  ['false unique critical count',x=>x.criticalMatchedCount=0],
  ['phantom reserved energy',x=>x.reservedAmount=100],
  ['fabricated travel time',x=>x.averageTransportTicks=1],
  ['too few haulers',x=>x.haulerCount=0]
]){
  const summary={...directSummary};
  modify(summary);
  assert.equal(check([direct],summary),false,name);
}
const paired={
  schemaVersion:1,authority:'SHADOW',haulerId:'h2',
  mode:'PICKUP_DELIVER',
  supplyRequestId:'source',demandRequestId:'normal-demand',
  amount:30,predicted:{transportTicks:8},
  reservationIds:['pickup2','delivery2'],
  requestKind:'DELIVER',critical:false
};
const balance={
  schemaVersion:1,authority:'SHADOW',haulerId:'h3',
  mode:'BALANCE',supplyRequestId:'buffer',demandRequestId:'buffer',
  amount:20,predicted:{transportTicks:7},
  reservationIds:['balance3'],requestKind:'BALANCE',critical:false
};
const allSummary={
  haulerCount:3,matchedHaulerCount:3,jobCount:3,
  pairedJobCount:2,directCarriedJobCount:1,
  criticalMatchedCount:1,reservedAmount:100,averageTransportTicks:6.67
};
assert.equal(check([direct,paired,balance],allSummary),true,
  'Complete actual E4 direct, paired, balance job accounting');
assert.equal(check([balance,direct,paired],allSummary),true,
  'Permutation does not affect accounting');
{
  const p={...paired,supplyRequestId:'normal-demand'};
  assert.equal(check([direct,p,balance],allSummary),false,
    'Paired transport requires separate pickup and delivery requests');
}
{
  const b={...balance,supplyRequestId:'other'};
  assert.equal(check([direct,paired,b],allSummary),false,
    'Balance must refer to the same buffer for source and destination');
}
{
  const dup={...paired,haulerId:'h1'};
  assert.equal(check([direct,dup,balance],allSummary),false,
    'One hauler cannot be assigned twice');
}
{
  const dup={...paired,reservationIds:['reservation-1','delivery2']};
  assert.equal(check([direct,dup,balance],allSummary),false,
    'One reservation cannot appear in multiple transport jobs');
}
{
  const dup={...paired,reservationIds:['same','same']};
  assert.equal(check([direct,dup,balance],allSummary),false,
    'Paired source/destination cannot share one reservation');
}
{
  const two={...paired,critical:true,requestKind:'EMERGENCY_DELIVER',
    demandRequestId:'request-1'};
  assert.equal(check([direct,two,balance],allSummary),true,
    'Two genuinely independent haulers may serve one partially fulfilled critical request; unique demand count remains one');
  const extra={...allSummary,criticalMatchedCount:2};
  assert.equal(check([direct,two,balance],extra),false,
    'Do not double count a single critical request by hauler count');
}
assert.equal(check([],{
  haulerCount:0,matchedHaulerCount:0,jobCount:0,pairedJobCount:0,
  directCarriedJobCount:0,criticalMatchedCount:0,reservedAmount:0,
  averageTransportTicks:0
}),true);

console.log('E4 shadow individual job IDs, one/two reservation atomicity and exact summary accounting PASS');
