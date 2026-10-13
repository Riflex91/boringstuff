import assert from 'node:assert/strict';
import {assessW37S79ExactCode} from './world-next-exact-code-gate.mjs';
const branches={list:[{branch:'default',activeWorld:true},{branch:'chatgpt',activeWorld:false}],activeWorld:'default'};
const exact={status:'EXACT_INACTIVE_CODE',exactSourceMatch:true};
assert.equal(assessW37S79ExactCode(branches,exact).ok,true);
assert.equal(assessW37S79ExactCode(branches,{...exact,exactSourceMatch:false}).ok,false);
assert.equal(assessW37S79ExactCode({list:[{branch:'chatgpt',activeWorld:true}]},exact).ok,false);
console.log('W37S79 exact-code gate: PASS');
