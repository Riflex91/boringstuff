import assert from 'node:assert/strict';
import {assessPlacementApproval,PLACEMENT_APPROVAL} from './world-next-place-spawn.mjs';
const good={ok:true,mode:'GET_ONLY',target:{shard:'shard0',room:'W37S79',x:37,y:26},
  stageBranch:'chatgpt-w37s79-stage',activeBranch:'chatgpt',
  exactInactiveCode:true,ringVerifiedRooms:24,
  ringRisk:'NO_FOREIGN_CONTROL_IN_RING',finalCheckPassed:true};
assert.equal(assessPlacementApproval(PLACEMENT_APPROVAL,good).ok,true);
assert.equal(assessPlacementApproval('',good).ok,false);
for(const patch of [{ok:false},{ringVerifiedRooms:23},{exactInactiveCode:false},
  {activeBranch:'default'},{target:{...good.target,x:38}},
  {stageBranch:'chatgpt'}])
  assert.equal(assessPlacementApproval(PLACEMENT_APPROVAL,{...good,...patch}).ok,false);
console.log('W37S79 placement approval gates: PASS');
