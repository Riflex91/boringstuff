import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const reserve=require('../game/expansion.parent.reserve.js');
const store=(id,energy,roomName='E1N1',my=true,type='storage')=>({
  id,structureType:type,my,pos:{roomName},store:{energy}
});
const base={
  room:{name:'E1N1',controller:{my:true}},
  structures:[store('owned',6000),store('enemy',80000,'E1N1',false),
    store('tower',1000,'E1N1',true,'tower')]
};
const before=JSON.stringify(base);
assert.equal(reserve.inspect(base).energy,6000);
assert.equal(reserve.inspect(base).ownedStores,1);
assert.equal(JSON.stringify(base),before);
assert.equal(reserve.inspect({...base,structures:[...base.structures,
  store('terminal',700,'E1N1',true,'terminal')]}).energy,6700);
assert.equal(reserve.inspect({...base,structures:base.structures.slice(1)}).energy,0);
for(const invalid of [
  {...base,structures:null},
  {...base,room:{name:'E1N1',controller:{my:false}}},
  {...base,structures:[null]},
  {...base,structures:[store('owned',1000),store('owned',2000)]},
  {...base,structures:[store('owned',NaN)]},
  {...base,structures:[store('owned',-1)]},
  {...base,structures:[store('owned',6000,'E2N2')]},
  {...base,structures:[{...store('owned',6000),store:null}]}
]) assert.equal(reserve.inspect(invalid).status,'UNVERIFIED');
console.log('I4 owned liquid expansion reserve fail-closed PASS');
