import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ledgerModule=require('../game/empire.resource.ledger.shadow.js');
const reserve=require('../game/empire.resource.reserve.shadow.js');

const tick=1700;
const state=(name,stock)=>({
  room:{name,controller:{my:true}},creeps:[],
  energyAvailable:300,energyCapacityAvailable:800,
  structures:[
    {id:name+'-storage',my:true,structureType:'storage',
      store:{energy:stock,Z:25}},
    {id:name+'-terminal',my:true,structureType:'terminal',
      store:{energy:200}}
  ]
});
const ledger=ledgerModule.snapshot([state('E8N1',1000),state('E7N1',500)],tick);
assert.equal(ledger.status,'OBSERVED');
const policy={
  owner:'survival-policy',observedTick:tick,expiresTick:tick+10,
  survivalReserve:400,forecastDemand:200,productionPipelineDemand:100,
  desiredBuffer:100,inboundForecast:900
};
const commitments=[
  {id:'defense-1',owner:'defense',roomName:'E8N1',
    resourceType:'energy',amount:150,createdTick:tick-2,expiresTick:tick+5},
  {id:'expansion-1',owner:'expansion',roomName:'E8N1',
    resourceType:'energy',amount:50,createdTick:tick-3,expiresTick:tick+4}
];
const run=(l=ledger,r='E8N1',resource='energy',p=policy,cs=commitments)=>
  reserve.analyze(l,r,resource,p,cs);
const fixtureBefore=JSON.stringify({ledger,policy,commitments});
{
  const x=run();
  assert.equal(x.schemaVersion,1);
  assert.equal(x.authority,'SHADOW');
  assert.equal(x.actionEnabled,false);
  assert.equal(x.status,'ADVISORY');
  assert.deepEqual(x.reasonCodes,[]);
  assert.equal(x.currentStock,1200);
  assert.equal(x.survivalReserve,400);
  assert.equal(x.forecastDemand,200);
  assert.equal(x.productionPipelineDemand,100);
  assert.equal(x.desiredBuffer,100);
  assert.equal(x.operationReservations,200);
  assert.equal(x.outboundCommitted,200);
  assert.equal(x.totalProtected,1000);
  assert.equal(x.upperBoundPotentialExcess,200);
  assert.equal(x.grossDeficit,0);
  assert.equal(x.inboundForecast,900);
  assert.equal(x.availableToCommit,null);
  assert.equal(x.reservationProof,null);
  assert.equal(x.command,'NO_ACTION');
  assert.deepEqual(x.commitments.map(c=>c.id),['defense-1','expansion-1']);
  assert.equal(JSON.stringify({ledger,policy,commitments}),fixtureBefore,
    'reserve analysis never mutates policy, memory, stock or commitments');
}
{
  const x=run(ledger,'E8N1','energy',{...policy,inboundForecast:1000000});
  assert.equal(x.upperBoundPotentialExcess,200,
    'future incoming energy is never counted as already transferable');
  assert.equal(x.availableToCommit,null);
}
{
  const x=run(ledger,'E8N1','energy',{...policy,survivalReserve:700});
  assert.equal(x.totalProtected,1300);
  assert.equal(x.upperBoundPotentialExcess,0);
  assert.equal(x.grossDeficit,100);
  assert.equal(x.availableToCommit,null);
}
{
  const x=run(ledger,'E7N1','Z',
    {...policy,survivalReserve:10,forecastDemand:0,
      productionPipelineDemand:3,desiredBuffer:2,inboundForecast:1000},[]);
  assert.equal(x.status,'ADVISORY');
  assert.equal(x.currentStock,25);
  assert.equal(x.totalProtected,15);
  assert.equal(x.upperBoundPotentialExcess,10);
  assert.equal(x.availableToCommit,null);
}
{
  const x=run(ledger,'E8N1','power',
    {...policy,survivalReserve:2,forecastDemand:0,
      productionPipelineDemand:0,desiredBuffer:0,inboundForecast:100},[]);
  assert.equal(x.status,'ADVISORY');
  assert.equal(x.currentStock,0);
  assert.equal(x.grossDeficit,2);
  assert.equal(x.upperBoundPotentialExcess,0);
}
for(const bad of [
  null,{...ledger,status:'PARTIAL'},
  {...ledger,availableToCommit:0},
  {...ledger,actionEnabled:true},
  {...ledger,authority:'EXECUTE'},
  {...ledger,tick:-1},
  {...ledger,rooms:[ledger.rooms[0],ledger.rooms[0]]}
]) {
  const x=run(bad);
  assert.equal(x.status,'HOLD');
  assert.deepEqual(x.reasonCodes,['LEDGER_UNVERIFIED']);
  assert.equal(x.availableToCommit,null);
  assert.equal(x.command,'NO_ACTION');
}
for(const room of ['E0N0','', '__proto__']) {
  const x=run(ledger,room);
  assert.equal(x.status,'HOLD');
  assert.ok(x.reasonCodes[0].startsWith(room==='E0N0'?'ROOM_':'RESOURCE_'));
}
for(const resource of ['__proto__','constructor','invalid/name','']) {
  const x=run(ledger,'E8N1',resource);
  assert.equal(x.status,'HOLD');
  assert.deepEqual(x.reasonCodes,['RESOURCE_IDENTITY_INVALID']);
}
for(const bad of [
  null,
  {...policy,owner:''},
  {...policy,observedTick:tick-26},
  {...policy,observedTick:tick+1},
  {...policy,expiresTick:tick-1},
  {...policy,expiresTick:tick+251},
]) {
  const x=run(ledger,'E8N1','energy',bad);
  assert.equal(x.status,'HOLD');
  assert.deepEqual(x.reasonCodes,['POLICY_EVIDENCE_INVALID']);
}
for(const key of ['survivalReserve','forecastDemand','desiredBuffer',
  'productionPipelineDemand','inboundForecast']){
  for(const amount of [-1,NaN,Infinity,'100',1.5]){
    const x=run(ledger,'E8N1','energy',{...policy,[key]:amount});
    assert.equal(x.status,'HOLD',key+' '+String(amount));
    assert.deepEqual(x.reasonCodes,['POLICY_AMOUNTS_INVALID']);
  }
}
for(const bad of [
  null,
  Array.from({length:129},()=>commitments[0])
]){
  const x=run(ledger,'E8N1','energy',policy,bad);
  assert.equal(x.status,'HOLD');
  assert.deepEqual(x.reasonCodes,['COMMITMENTS_UNVERIFIED']);
}
for(const bad of [
  [commitments[0],commitments[0]],
  [{...commitments[0],amount:0}],
  [{...commitments[0],amount:-1}],
  [{...commitments[0],createdTick:tick-26}],
  [{...commitments[0],expiresTick:tick-1}],
  [{...commitments[0],expiresTick:tick+251}],
  [{...commitments[0],roomName:'E7N1'}],
  [{...commitments[0],resourceType:'Z'}],
  [{...commitments[0],owner:''}],
  [{...commitments[0],id:'__proto__'}]
]){
  const x=run(ledger,'E8N1','energy',policy,bad);
  assert.equal(x.status,'HOLD');
  assert.deepEqual(x.reasonCodes,['COMMITMENT_INVALID_OR_EXPIRED']);
}
{
  const x=run(ledger,'E8N1','energy',
    {...policy,survivalReserve:Number.MAX_SAFE_INTEGER});
  assert.equal(x.status,'HOLD');
  assert.deepEqual(x.reasonCodes,['RESERVE_AMOUNT_OVERFLOW']);
}
{
  const x=run(ledger,'E8N1','energy',policy,[
    {...commitments[0],amount:Number.MAX_SAFE_INTEGER},
    {...commitments[1],amount:1}
  ]);
  assert.equal(x.status,'HOLD');
  assert.deepEqual(x.reasonCodes,['RESERVE_AMOUNT_OVERFLOW']);
}
{
  const contaminated=structuredClone(ledger);
  contaminated.rooms.find(r=>r.roomName==='E8N1')
    .resources.structures.energy='1200';
  const x=run(contaminated);
  assert.equal(x.status,'HOLD');
  assert.deepEqual(x.reasonCodes,['ROOM_STOCK_UNVERIFIED']);
}
console.log('M0 reserve obligation census, expiry, optimistic inbound exclusion, overflow and no-action contracts PASS');
