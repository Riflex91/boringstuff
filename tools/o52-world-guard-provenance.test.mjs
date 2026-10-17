import assert from 'node:assert/strict';
import {inspectWorldAstSource} from './o51-world-ast-egress-audit.mjs';
import {LEGACY_WORLD_MUTATOR_EXPORTS} from './o50-world-write-path-audit.mjs';
import {WORLD_GUARD_OPERATION_NAMES}
  from './o52-world-guard-provenance.mjs';

// Synthetic malicious source snippets only. No real World API is imported.
const mod='./o45-world-mutation-entrypoint-hold.mjs';
const id='assertLegacyWorldMutationDisabled';
function fixture(filename,options={}){
  const op=options.op||WORLD_GUARD_OPERATION_NAMES[filename];
  const importStmt=options.importStmt===undefined?
    'import {'+id+'} from '+JSON.stringify(mod)+';':options.importStmt;
  const exports=LEGACY_WORLD_MUTATOR_EXPORTS[filename];
  const guard=id+'('+JSON.stringify(op)+');';
  return importStmt+'\n'+exports.map((name,index)=>
    'export async function '+name+'(api){'+
    (options.body?options.body(name,index,guard):guard+
      "return api._request('POST','/api/user/code');")+'}').join('\n')+
    '\nasync function main(){'+(options.main===undefined?guard:options.main)+'}\n';
}
function check(file,source,reason){
  const r=inspectWorldAstSource(file,source);
  assert.ok(r.violations.some(v=>v.includes(reason)),
    reason+' should hold: '+JSON.stringify(r.violations));
  return r;
}
for(const [file,expected] of Object.entries(WORLD_GUARD_OPERATION_NAMES)){
  const valid=inspectWorldAstSource(file,fixture(file));
  assert.deepEqual(valid.violations,[],
    'trusted name and expected operation must pass: '+file);
  assert.equal(valid.guardedExports,LEGACY_WORLD_MUTATOR_EXPORTS[file].length);
  check(file,fixture(file,{op:'legacy-direct-code-deploy'}),
    'GUARD_WRONG_OPERATION_OR_ORDER');
  check(file,fixture(file,{
    main:id+"('legacy-not-the-operation');"
  }),'GUARD_WRONG_OPERATION_OR_ORDER_main');
  check(file,fixture(file,{
    importStmt:'import * as '+id+' from '+JSON.stringify(mod)+';'
  }),'GUARD_NOT_TRUSTED_NAMED_IMPORT');
  check(file,fixture(file,{
    importStmt:'import '+id+' from '+JSON.stringify(mod)+';'
  }),'GUARD_NOT_TRUSTED_NAMED_IMPORT');
  check(file,fixture(file,{
    importStmt:'import {'+id+"} from './fake.mjs';"
  }),'GUARD_NOT_TRUSTED_NAMED_IMPORT');
  check(file,fixture(file,{
    importStmt:'import {pretend as '+id+'} from '+JSON.stringify(mod)+';'
  }),'GUARD_NOT_TRUSTED_NAMED_IMPORT');
  check(file,fixture(file,{
    body:(_name,_index,guard)=>'void 0;'+guard
  }),'GUARD_WRONG_OPERATION_OR_ORDER');
  check(file,fixture(file,{
    body:()=>id+'?.('+JSON.stringify(expected)+');'
  }),'GUARD_WRONG_OPERATION_OR_ORDER');
  check(file,fixture(file,{
    body:()=>id+"('legacy'+'-'+"+JSON.stringify(expected.slice(7))+");"
  }),'GUARD_WRONG_OPERATION_OR_ORDER');
  // These declarations can shadow a correctly spelled initial guard call.
  check(file,fixture(file,{
    body:(_name,_index,guard)=>guard+' var '+id+'=()=>{};'
  }),'GUARD_BINDING_SHADOWED');
  check(file,fixture(file,{
    body:(_name,_index,guard)=>guard+' let '+id+';'
  }),'GUARD_BINDING_SHADOWED');
  check(file,fixture(file,{
    body:(_name,_index,guard)=>guard+' try{}catch('+id+'){}'
  }),'GUARD_BINDING_SHADOWED');
}
for(const args of [
  id,'{'+id+'}','['+id+']','...'+id
]){
  const file='world-branch-bootstrap.mjs';
  const code='import {'+id+'} from '+JSON.stringify(mod)+';'+
    'export async function stageInactiveWorldCode('+args+'){'+
    id+"('legacy-code-bootstrap');}"+
    'async function main(){'+id+"('legacy-code-bootstrap');}";
  check(file,code,'GUARD_BINDING_SHADOWED_stageInactiveWorldCode');
}
// A globally collected GET const is NOT proof the function argument of
// the same name cannot contain POST. It must remain suspicious.
const ambiguous=inspectWorldAstSource('world-new-audit-target.mjs',
  "const verb='GET'; function write(api,verb){"+
  "return api._request(verb,'/api/user/code',{});}");
assert.ok(ambiguous.findings.some(x=>x.kind==='UNKNOWN_HTTP_VERB'));
assert.ok(ambiguous.violations.includes('UNREVIEWED_WORLD_EXECUTABLE_SINK'));
const literal=inspectWorldAstSource('world-readonly.mjs',
  "async function read(api){return api._request('GET','/api/user/code');}");
assert.deepEqual(literal.findings,[]);
assert.deepEqual(literal.violations,[]);

console.log('O52 trusted named import, exact operation, unshadowed guard, ambiguous GET: PASS');
