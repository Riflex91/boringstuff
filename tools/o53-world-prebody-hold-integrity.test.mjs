import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inspectWorldAstSource} from './o51-world-ast-egress-audit.mjs';
import {WORLD_GUARD_OPERATION_NAMES} from './o52-world-guard-provenance.mjs';
import {LEGACY_WORLD_MUTATOR_EXPORTS} from './o50-world-write-path-audit.mjs';
import {
  gitBlobSha,verifyPinnedWorldHoldImplementation,
  PINNED_WORLD_HOLD_GIT_BLOB
} from './o53-pinned-world-hold.mjs';

const guardModule=fs.readFileSync(
  new URL('./o45-world-mutation-entrypoint-hold.mjs',import.meta.url),'utf8');
const actual=verifyPinnedWorldHoldImplementation(guardModule);
assert.equal(actual.verified,true,'Reviewed O45 source must match manually pinned Git blob');
assert.equal(actual.actualGitBlob,PINNED_WORLD_HOLD_GIT_BLOB);
assert.equal(gitBlobSha(guardModule),PINNED_WORLD_HOLD_GIT_BLOB);
assert.equal(actual.mayUploadWorldCode,false);
assert.equal(actual.releaseAuthorized,false);
for(const tampered of [
  guardModule+'\n// formerly reviewed',
  guardModule.replace(
    "throw new Error('O45_WORLD_MUTATION_HOLD_NO_APPROVED_FENCED_EXECUTOR');",
    "return {releaseAuthorized:true};"),
  guardModule.replace(
    "throw new Error('O45_WORLD_MUTATION_HOLD_NO_APPROVED_FENCED_EXECUTOR');",
    "if(false) throw new Error('O45_WORLD_MUTATION_HOLD_NO_APPROVED_FENCED_EXECUTOR');")
]){
  assert.equal(verifyPinnedWorldHoldImplementation(tampered).verified,false);
  const audited=inspectWorldAstSource(
    'o45-world-mutation-entrypoint-hold.mjs',tampered);
  assert.ok(audited.violations.includes('O45_GUARD_IMPLEMENTATION_BLOB_CHANGED'));
}
assert.deepEqual(inspectWorldAstSource(
  'o45-world-mutation-entrypoint-hold.mjs',guardModule).violations,[]);

const ident='assertLegacyWorldMutationDisabled';
const sourceFor=(file,args)=>{
  const op=WORLD_GUARD_OPERATION_NAMES[file];
  const guard=ident+'('+JSON.stringify(op)+');';
  const fns=LEGACY_WORLD_MUTATOR_EXPORTS[file].map(name=>
    'export async function '+name+'('+args+'){'+guard+'}');
  return 'import {'+ident+"} from './o45-world-mutation-entrypoint-hold.mjs';\n"+
    fns.join('\n')+'\nasync function main(){'+guard+'}\n';
};
const err='GUARD_PREBODY_PARAMETER_EFFECT_OR_DESTRUCTURE_';
const consideredUnsafe=[
  'api = doSideEffect()',
  "api = fetch('https://screeps.com/api/user/code',{method:'POST'})",
  "api = (()=>{throw Error('before guard')})()",
  'api = ({write(){}}).write()',
  "{secret = mutate()}",
  "[read = mutate()]",
  "...args",
  'api = ()=>{ mutate(); }',
  'api = async ()=>{}',
  'api = (x)=>{}',
  'api = ()=>mutate()'
];
for(const [filename,op] of Object.entries(WORLD_GUARD_OPERATION_NAMES)){
  const standard=sourceFor(filename,"api,onPhase=()=>{}");
  assert.deepEqual(inspectWorldAstSource(filename,standard).violations,[],
    'Existing reviewed zero-argument empty onPhase factory should be inert: '+filename);
  const original=sourceFor(filename,'api');
  assert.deepEqual(inspectWorldAstSource(filename,original).violations,[]);
  for(const args of consideredUnsafe.filter(x=>!x.includes('await mutation'))){
    const source=sourceFor(filename,args);
    const result=inspectWorldAstSource(filename,source);
    for(const exported of LEGACY_WORLD_MUTATOR_EXPORTS[filename])
      assert.ok(result.violations.some(v=>v===err+exported),
        filename+' '+exported+' must reject prebody initializer/destructuring: '+args+
        ' got '+JSON.stringify(result.violations));
  }
  // In addition, a main() receiving an injected default parameter also
  // executes that initializer before its nominal first-statement HOLD.
  const mainParam=standard.replace('async function main()',
    'async function main(mode = mutate())');
  assert.ok(inspectWorldAstSource(filename,mainParam).violations
    .includes(err+'main'));
}
// Demonstrate the JS sequencing issue in a standalone synthetic function.
// This is an entirely local array write, never an actual Screeps mutation.
const trace=[];
async function illustrativeHold(api = trace.push('PRE_BODY_EFFECT')){
  trace.push('BODY');
  throw new Error('SYNTHETIC_HOLD');
}
await assert.rejects(()=>illustrativeHold(),/SYNTHETIC_HOLD/);
assert.deepEqual(trace,['PRE_BODY_EFFECT','BODY']);

console.log('O53 pre-body parameter effects and pinned O45 throw implementation: PASS');
