import assert from 'node:assert/strict';
import {summarizeWorldBranchActivation} from './world-next-branch-diagnostic.mjs';
assert.deepEqual(summarizeWorldBranchActivation({activeWorld:'tutorial-1',list:[
 {branch:'default',activeWorld:false},{branch:'chatgpt',activeWorld:true}]}),{
 reportedActiveWorld:'tutorial-1',branches:[
 {name:'default',activeWorld:false,activeWorldFieldPresent:true},
 {name:'chatgpt',activeWorld:true,activeWorldFieldPresent:true}]});
assert.equal(summarizeWorldBranchActivation({list:[{branch:'default'}]}).branches[0].activeWorldFieldPresent,false);
console.log('World branch activation diagnostics: PASS');
