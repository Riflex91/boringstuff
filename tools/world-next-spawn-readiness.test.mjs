import assert from 'node:assert/strict';
import {assessNextSpawnReadiness} from './world-next-spawn-readiness.mjs';
const observations=Array.from({length:24},(_,i)=>({room:'test'+i,verified:true}));
const ring={mode:'GET_ONLY',target:{shard:'shard0',room:'W37S79',x:37,y:26},
  siteChecksPass:true,requestedRooms:24,verifiedRooms:24,
  coverageComplete:true,observations,foreignControlledRooms:0,
  risk:'NO_FOREIGN_CONTROL_IN_RING',nearbyRcl8ForeignOwned:[]};
const names=['world-status-empty','room-status-normal','controller-exists',
 'controller-unowned','controller-unreserved','spawn-tile-free-and-buildable',
 'spawn-name-available','world-branch-present','world-code-ready'];
const check={ok:true,room:'W37S79',x:37,y:26,name:'Spawn1',branch:'chatgpt',
 worldStatus:'empty',roomStatus:'normal',tile:{ok:true,terrain:'plain'},
 checks:names.map(name=>({name,pass:true,severity:'error'})),
 evidence:{placementEndpointCalled:false}};
assert.equal(assessNextSpawnReadiness(ring,check,{ok:true,exactInactiveCode:true}).ok,true);
assert.equal(assessNextSpawnReadiness({...ring,verifiedRooms:23},check,{ok:true,exactInactiveCode:true}).ok,false);
assert.equal(assessNextSpawnReadiness({...ring,foreignControlledRooms:1},check,{ok:true,exactInactiveCode:true}).ok,false);
assert.equal(assessNextSpawnReadiness({...ring,risk:'NEARBY_RCL8'},check,{ok:true,exactInactiveCode:true}).ok,false);
assert.equal(assessNextSpawnReadiness(ring,{...check,name:'Wrong'},{ok:true,exactInactiveCode:true}).ok,false);
assert.equal(assessNextSpawnReadiness(ring,{...check,evidence:{placementEndpointCalled:true}},{ok:true,exactInactiveCode:true}).ok,false);
assert.equal(assessNextSpawnReadiness(ring,{...check,checks:check.checks.slice(1)},{ok:true,exactInactiveCode:true}).ok,false);
console.log('W37S79 GET-only readiness fail-closed tests: PASS');

assert.equal(assessNextSpawnReadiness(ring,check,{ok:false,exactInactiveCode:false}).ok,false);
