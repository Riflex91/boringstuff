import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import Module from 'node:module';

const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);
const ledgerModule=require('../game/empire.resource.ledger.shadow.js');
const allocator=require('../game/empire.resource.allocator.shadow.js');

const tick=1000;
const stock={
  room:{name:'E8N1',controller:{my:true}},
  energyAvailable:800,energyCapacityAvailable:800,creeps:[],
  structures:[
    {id:'source-storage',my:true,structureType:'storage',store:{energy:1000,Z:50}},
    {id:'source-terminal',my:true,structureType:'terminal',store:{energy:200}}
  ]
};
const target={
  room:{name:'E7N1',controller:{my:true}},
  energyAvailable:800,energyCapacityAvailable:800,creeps:[],
  structures:[
    {id:'target-terminal',my:true,structureType:'terminal',store:{energy:100}}
  ]
};
const ledger=ledgerModule.snapshot([stock,target],tick);
assert.equal(ledger.status,'OBSERVED');
const request={roomName:'E7N1',resourceType:'energy',amount:100,
  urgencyPerTickCredits:5};
const evidence={verified:true,asOfTick:tick,expiresTick:tick+10};
const internal={
  id:'colony-transfer',sourceRoom:'E8N1',amount:100,
  evidence,
  reserveProof:{...evidence,roomName:'E8N1',resourceType:'energy',
    owner:'policy-shadow',observedStructureStock:1200,
    strategicReserve:600,committedAmount:200},
  transactionEnergy:20,energyShadowPrice:2,
  reserveOpportunityCostPerUnit:1,terminalOpportunityCost:5,
  arrivalDelayTicks:2
};
const market={
  id:'market-buy',amount:100,evidence,
  resourceType:'energy',destinationRoom:'E7N1',
  transactionEnergy:5,energyShadowPrice:2,pricePerUnit:2,
  terminalOpportunityCost:10,arrivalDelayTicks:0
};
const offerSet={internal:[internal],market:[market],marketAvailable:true};
function plan(l=ledger,r=request,o=offerSet){return allocator.evaluate(l,r,o);}
{
  const before=JSON.stringify({ledger,request,offerSet});
  const p=plan();
  assert.equal(p.schemaVersion,1);
  assert.equal(p.status,'ADVISORY');
  assert.equal(p.authority,'SHADOW');
  assert.equal(p.actionEnabled,false);
  assert.equal(p.command,'NO_ACTION');
  assert.equal(p.verifiedAvailableToCommit,null);
  assert.deepEqual(p.reasonCodes,[]);
  assert.equal(p.selected.kind,'INTERNAL_TRANSFER');
  assert.equal(p.selected.sourceRoom,'E8N1');
  assert.equal(p.selected.readyForExecution,false);
  assert.equal(p.selected.effectiveCost,155);
  assert.deepEqual(p.selected.cost,{
    resourceOrReserve:100,transactionEnergy:40,
    terminalOpportunity:5,urgencyDelay:10
  });
  assert.equal(p.alternatives.length,2);
  assert.equal(p.alternatives[1].effectiveCost,220);
  assert.equal(JSON.stringify({ledger,request,offerSet}),before,
    'M1 cannot mutate any input or issue a game intent');
}
{
  const p=plan(ledger,request,{...offerSet,market:[
    {...market,pricePerUnit:0.5}
  ]});
  assert.equal(p.selected.kind,'MARKET_BUY');
  assert.equal(p.selected.effectiveCost,70);
  assert.equal(p.command,'NO_ACTION');
  assert.equal(p.selected.readyForExecution,false);
}
{
  const p=plan(ledger,request,{...offerSet,market:[
    {...market,pricePerUnit:1.35,transactionEnergy:5,
      energyShadowPrice:2,terminalOpportunityCost:10,arrivalDelayTicks:0}
  ]});
  assert.equal(p.selected.kind,'INTERNAL_TRANSFER',
    'exact economic ties preserve internal option preference');
  assert.equal(p.alternatives[0].effectiveCost,155);
  assert.equal(p.alternatives[1].effectiveCost,155);
}
{
  const p=plan(ledger,request,{...offerSet,
    market:[{...market,pricePerUnit:0.01}],marketAvailable:false});
  assert.equal(p.status,'PARTIAL');
  assert.equal(p.selected.kind,'INTERNAL_TRANSFER',
    'unavailable market quotes are not eligible');
  assert.deepEqual(p.reasonCodes,['UNVERIFIED_OFFERS_EXCLUDED']);
}
for(const replacement of [
  { ...ledger, status:'PARTIAL'},
  { ...ledger, availableToCommit:0 },
  { ...ledger, authority:'EXECUTE'},
  { ...ledger, actionEnabled:true },
  { ...ledger, tick:null },
  { ...ledger, rooms:[ledger.rooms[0],ledger.rooms[0]] },
  { ...ledger, rooms:[] }
]) {
  const p=plan(replacement);
  assert.equal(p.status,'HOLD','unverified ledger must not drive allocation');
  assert.deepEqual(p.reasonCodes,['LEDGER_UNVERIFIED']);
  assert.equal(p.command,'NO_ACTION');
  assert.equal(p.selected,null);
}
for(const bad of [
  {...request,amount:0},
  {...request,amount:1000001},
  {...request,amount:NaN},
  {...request,roomName:'E9N9'},
  {...request,resourceType:'__proto__'},
  {...request,resourceType:'energy/'+'.'.repeat(51)},
  {...request,urgencyPerTickCredits:-1},
  {...request,urgencyPerTickCredits:Infinity}
]){
  const p=plan(ledger,bad);
  assert.equal(p.status,'HOLD');
  assert.deepEqual(p.reasonCodes,['DEMAND_UNVERIFIED']);
}
for(const proof of [
  {...internal.reserveProof,verified:false},
  {...internal.reserveProof,asOfTick:tick-26},
  {...internal.reserveProof,expiresTick:tick-1},
  {...internal.reserveProof,observedStructureStock:1250},
  {...internal.reserveProof,strategicReserve:1100},
  {...internal.reserveProof,committedAmount:1000},
  {...internal.reserveProof,owner:''},
  {...internal.reserveProof,roomName:'E7N1'}
]) {
  const p=plan(ledger,request,{internal:[{...internal,reserveProof:proof}],
    market:[],marketAvailable:false});
  assert.equal(p.status,'HOLD');
  assert.deepEqual(p.reasonCodes,['NO_VERIFIED_ALLOCATION_OFFER']);
  assert.equal(p.selected,null);
}
{
  const p=plan(ledger,request,{internal:[
    {...internal,reserveProof:{...internal.reserveProof,strategicReserve:901}}
  ],market:[market],marketAvailable:true});
  assert.equal(p.status,'PARTIAL');
  assert.equal(p.selected.kind,'MARKET_BUY');
  assert.equal(p.command,'NO_ACTION');
}
{
  const p=plan(ledger,request,{internal:[],market:[],marketAvailable:false});
  assert.equal(p.status,'HOLD');
  assert.deepEqual(p.reasonCodes,['NO_ALLOCATION_OFFER']);
}
{
  const p=plan(ledger,request,{internal:[internal],
    market:[{...market,id:internal.id}],marketAvailable:true});
  assert.equal(p.status,'PARTIAL');
  assert.equal(p.alternatives.length,1,
    'same offer id must not create two competing nominal alternatives');
}
{
  const noTerminal=ledgerModule.snapshot([stock,{
    ...target,structures:[{id:'target-store',my:true,
      structureType:'storage',store:{energy:100}}]
  }],tick);
  const p=plan(noTerminal);
  assert.equal(p.status,'HOLD');
  assert.deepEqual(p.reasonCodes,['DESTINATION_TERMINAL_UNVERIFIED']);
}
for(const bad of [
  {...internal,transactionEnergy:-1},
  {...internal,energyShadowPrice:NaN},
  {...internal,terminalOpportunityCost:Infinity},
  {...internal,arrivalDelayTicks:-2},
  {...internal,amount:50},
  {...internal,evidence:{...evidence,verified:false}},
  {...internal,sourceRoom:'E7N1'}
]){
  const p=plan(ledger,request,{internal:[bad],market:[],
    marketAvailable:false});
  assert.equal(p.status,'HOLD');
  assert.deepEqual(p.reasonCodes,['NO_VERIFIED_ALLOCATION_OFFER']);
}
{
  const excessive=plan(ledger,request,{internal:Array.from({length:17},(_,i)=>({
    ...internal,id:'x'+i
  })),market:[],marketAvailable:false});
  assert.equal(excessive.status,'HOLD');
  assert.deepEqual(excessive.reasonCodes,['OFFERS_UNVERIFIED']);
}
{
  const p=plan(ledger,{...request,resourceType:'Z',amount:5},
    {internal:[{...internal,amount:5,reserveProof:{
      ...internal.reserveProof,resourceType:'Z',observedStructureStock:50,
      strategicReserve:10,committedAmount:5
    }}],market:[],marketAvailable:false});
  assert.equal(p.status,'ADVISORY',
    'M1 understands minerals without assuming energy-only requests');
  assert.equal(p.selected.resourceType,'Z');
}
console.log('M1 internal vs market advisory economic comparisons, reserve proofs and fail-closed guards PASS');
