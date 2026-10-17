import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'acorn';
import {
  LEGACY_WORLD_MUTATOR_EXPORTS,WRITE_PATH_CLASSES
} from './o50-world-write-path-audit.mjs';
import { validateWorldGuardProvenance } from './o52-world-guard-provenance.mjs';
import {verifyPinnedWorldHoldImplementation} from './o53-pinned-world-hold.mjs';
import {REVIEWED_READONLY_TRANSPORT_SHAPES, isExactlyReviewedReadOnlyTransport, detectDynamicDispatch} from './o54-reviewed-readonly-transport-shapes.mjs';

// O51 bounded independent AST layer over O50's known-pattern inventory.
// Soundness LIMIT: AST syntax analysis and local const alias folding is not
// a whole-program dataflow analysis or global runtime egress sandbox.
const HOLD='O51_WORLD_AST_AUDIT_HOLD_';
const fail=reason=>{throw new Error(HOLD+reason);};
const MUTATORS=new Set([
  'userUploadCodeOnce','userSetActiveBranch','gamePlaceSpawn',
  'gameCheckUniqueObjectName','cloneBranch','placeSpawn'
]);
const NET_MODULES=new Set([
  'node:http','http','node:https','https','node:net','net',
  'node:tls','tls','ws','undici','axios','got','node:child_process'
]);
const NETWORK_METHODS=new Set(['request','get','connect','createConnection',
  'exec','execFile','spawn','fork']);
const RECORD_LIMIT=250;
// Reviewed read-only transports still receive strict AST-shape checks.
// Future method/argument changes deliberately require manual review.
const REVIEWED_READONLY_TRANSPORTS=REVIEWED_READONLY_TRANSPORT_SHAPES;
function allowReviewedReadOnlyTransport(filename,node,kind,bindings){
  return isExactlyReviewedReadOnlyTransport(filename,node,kind,bindings);
}
function nodes(root,cb){
  function visit(x,parent){
    if(!x||typeof x!=='object')return;
    if(Array.isArray(x)){for(const n of x)visit(n,parent);return;}
    if(typeof x.type!=='string')return;
    cb(x,parent);
    for(const [k,v] of Object.entries(x)){
      if(k==='loc'||k==='range'||k==='start'||k==='end')continue;
      if(v&&typeof v==='object')visit(v,x);
    }
  }
  visit(root,null);
}
function rootName(expr){
  if(!expr||typeof expr!=='object')return '';
  if(expr.type==='Identifier')return expr.name;
  if(expr.type==='ThisExpression')return 'this';
  if(expr.type==='MemberExpression')return rootName(expr.object);
  return '';
}
function memberProperty(expr,consts,depth){
  if(!expr||expr.type!=='MemberExpression')return null;
  if(!expr.computed)return expr.property.type==='Identifier'?expr.property.name:null;
  return primitive(expr.property,consts,depth);
}
function primitive(expr,consts,depth=0){
  if(depth>7||!expr)return null;
  if(expr.type==='Literal'&&typeof expr.value==='string')return expr.value;
  if(expr.type==='TemplateLiteral'&&expr.expressions.length===0)
    return expr.quasis[0]?.value?.cooked??null;
  if(expr.type==='Identifier'&&consts.has(expr.name))
    return primitive(consts.get(expr.name),consts,depth+1);
  if(expr.type==='BinaryExpression'&&expr.operator==='+'){
    const a=primitive(expr.left,consts,depth+1),
      b=primitive(expr.right,consts,depth+1);
    return typeof a==='string'&&typeof b==='string'?a+b:null;
  }
  if(expr.type==='ConditionalExpression'){
    const a=primitive(expr.consequent,consts,depth+1),
      b=primitive(expr.alternate,consts,depth+1);
    return a===b?a:null;
  }
  return null;
}
function deref(expr,consts,depth=0){
  if(depth>7||!expr)return expr;
  return expr.type==='Identifier'&&consts.has(expr.name)
    ?deref(consts.get(expr.name),consts,depth+1):expr;
}
function memberCall(expr,consts){
  const e=deref(expr,consts);
  if(e?.type==='MemberExpression')return {
    member:memberProperty(e,consts,0),object:rootName(e.object),
    dynamic:e.computed&&memberProperty(e,consts,0)===null
  };
  return {member:e?.type==='Identifier'?e.name:null,object:'',dynamic:false};
}
function firstExecutableStatement(fn){
  return fn?.body?.type==='BlockStatement'?fn.body.body[0]:null;
}
function isGuard(statement){
  return statement?.type==='ExpressionStatement'&&
    statement.expression?.type==='CallExpression'&&
    statement.expression.callee?.type==='Identifier'&&
    statement.expression.callee.name==='assertLegacyWorldMutationDisabled'&&
    statement.expression.arguments.length===1&&
    typeof statement.expression.arguments[0]?.value==='string'&&
    statement.expression.arguments[0].value.startsWith('legacy-');
}
function collectDeclarations(ast){
  const consts=new Map(),imports=new Map();
  nodes(ast,node=>{
    if(node.type==='ImportDeclaration'){
      for(const spec of node.specifiers||[]){
        imports.set(spec.local?.name,node.source?.value);
      }
    }else if(node.type==='VariableDeclaration'&&node.kind==='const'){
      for(const entry of node.declarations||[]){
        if(entry.id?.type==='Identifier'&&entry.init)
          consts.set(entry.id.name,entry.init);
      }
    }
  });
  return {consts,imports};
}
function candidateKind(node,bindings){
  const {consts,imports}=bindings;
  if(node.type==='ImportExpression'){
    const s=primitive(node.source,consts);
    return NET_MODULES.has(s)?'DYNAMIC_NETWORK_IMPORT':null;
  }
  if(node.type!=='CallExpression'&&node.type!=='NewExpression')return null;
  const call=memberCall(node.callee,consts);
  const {member,object,dynamic}=call;
  if(dynamic&&['api','client','this','http','https','socket','ws'].includes(object))
    return 'DYNAMIC_API_MEMBER';
  if(member==='_request'){
    const verb=primitive(node.arguments[0],consts);
    // O52: globally collected const aliases are not lexical-scope proofs.
    // Only a directly written GET literal is provably read-only here.
    // A shadowed variable called "verb" could otherwise hide a POST.
    if(node.arguments[0]?.type==='Literal'&&
       node.arguments[0].value==='GET')return null;
    return verb===null||verb==='GET'?'UNKNOWN_HTTP_VERB':
      'MUTATING_API_REQUEST';
  }
  if(MUTATORS.has(member))return 'MUTATING_CLIENT_WRAPPER';
  if(member==='fetch'&&(object==='globalThis'||object===''))
    return 'FETCH_TRANSPORT';
  if(member==='fetch'&&imports.get(member))return 'FETCH_TRANSPORT';
  if(imports.has(member)&&NET_MODULES.has(imports.get(member)))
    return 'ALTERNATE_NETWORK_TRANSPORT';
  if(['eval','Function'].includes(member))return 'DYNAMIC_JS_EVALUATION';
  if(node.type==='NewExpression'&&['WebSocket','XMLHttpRequest'].includes(member))
    return 'ALTERNATE_SOCKET_OR_XHR';
  if(['send'].includes(member)&&['ws','socket'].includes(object))
    return 'SOCKET_SEND';
  if(NETWORK_METHODS.has(member)&&
      (NET_MODULES.has(imports.get(object))||
       ['http','https','net','tls','axios','got','undici','child_process'].includes(object)))
    return 'ALTERNATE_NETWORK_TRANSPORT';
  if(['POST','PUT','PATCH','DELETE'].includes(member)&&
    ['api','client','http'].includes(object))
    return 'DYNAMIC_HTTP_VERB_WRAPPER';
  return null;
}

export function inspectWorldAstSource(filename,source){
  if(typeof filename!=='string'||typeof source!=='string')fail('INPUT');
  let ast;
  try{
    ast=parse(source,{ecmaVersion:'latest',sourceType:'module',
      allowHashBang:true,locations:true});
  }catch{fail('SYNTAX_'+filename.replace(/[^a-zA-Z0-9._-]/g,'_'));}
  const bindings=collectDeclarations(ast),findings=[],violations=[];
  // O53: a genuine imported name is insufficient if the imported O45
  // function itself is altered to return. Never auto-trust a new blob.
  if(filename==='o45-world-mutation-entrypoint-hold.mjs'&&
      !verifyPinnedWorldHoldImplementation(source).verified)
    violations.push('O45_GUARD_IMPLEMENTATION_BLOB_CHANGED');
  const reviewed=WRITE_PATH_CLASSES[filename]||null;
  const exposed=LEGACY_WORLD_MUTATOR_EXPORTS[filename]||[];
  violations.push(...validateWorldGuardProvenance(ast,filename,exposed));
  const guardedImport=[...bindings.imports.entries()].some(([local,uri])=>
    local==='assertLegacyWorldMutationDisabled'&&
    uri==='./o45-world-mutation-entrypoint-hold.mjs');
  if(reviewed==='LEGACY_BLOCKED'&&!guardedImport)
    violations.push('LEGACY_GUARD_IMPORT_MISSING');
  const fns=[];
  for(const stmt of ast.body){
    if(stmt.type==='FunctionDeclaration')fns.push({fn:stmt,exported:false});
    if(stmt.type==='ExportNamedDeclaration'&&stmt.declaration?.type==='FunctionDeclaration')
      fns.push({fn:stmt.declaration,exported:true});
  }
  for(const name of exposed){
    const matches=fns.filter(x=>x.fn.id?.name===name&&x.exported);
    if(matches.length!==1||!isGuard(firstExecutableStatement(matches[0]?.fn)))
      violations.push('EXPORT_FIRST_EXECUTABLE_HOLD_MISSING_'+name);
  }
  if(reviewed==='LEGACY_BLOCKED'){
    const entry=fns.filter(x=>x.fn.id?.name==='main');
    if(entry.length!==1||!isGuard(firstExecutableStatement(entry[0]?.fn)))
      violations.push('MAIN_FIRST_EXECUTABLE_HOLD_MISSING');
  }
  if(filename==='initial-spawn-planner.mjs'){
    const entry=fns.filter(x=>x.fn.id?.name==='main');
    const body=entry[0]?.fn?.body?.body||[];
    const gate=body.findIndex(x=>x.type==='ExpressionStatement'&&
      x.expression?.type==='CallExpression'&&
      x.expression.callee?.name==='assertWorldPlannerReadOnly'&&
      x.expression.arguments[0]?.name==='args');
    if(entry.length!==1||gate<0||gate>2||
       bindings.imports.get('assertWorldPlannerReadOnly')!==
          './o51-world-planner-readonly-gate.mjs')
      violations.push('SCOUT_CHILD_PLANNER_WORLD_PLACE_HOLD_MISSING');
    else{
      const gatedAt=body[gate].start;
      nodes(ast,node=>{
        if(node.type==='CallExpression'&&
           ['fromConfig','gamePlaceSpawn','userSetActiveBranch'].includes(
             memberCall(node.callee,bindings.consts).member)&&
           node.start<gatedAt)
          violations.push('WORLD_PLANNER_GUARD_NOT_BEFORE_NETWORK');
      });
    }
  }
  if(filename==='world-scout.mjs'){
    let safeArg=null,spawn=null;
    nodes(ast,node=>{
      if(node.type==='CallExpression'&&node.callee?.name==='assertWorldScoutRoomArguments'&&
         node.arguments[0]?.name==='selected')safeArg=node;
      if(node.type==='CallExpression'&&node.callee?.name==='spawnSync')spawn=node;
    });
    if(bindings.imports.get('assertWorldScoutRoomArguments')!==
         './o51-world-planner-readonly-gate.mjs'||
       !safeArg||!spawn||safeArg.start>=spawn.start)
      violations.push('SCOUT_SUBPROCESS_ARGV_GUARD_MISSING');
  }
  let reviewedReadonlyCalls=0;
  nodes(ast,node=>{
    // O54: indirect invocation is itself review-required even when an
    // earlier scanner sees no literal network call (Reflect/call/apply).
    const kind=detectDynamicDispatch(node)||candidateKind(node,bindings);
    if(!kind)return;
    if(allowReviewedReadOnlyTransport(filename,node,kind,bindings)){
      reviewedReadonlyCalls++;
    }else if(REVIEWED_READONLY_TRANSPORTS[filename]){
      violations.push('READONLY_TRANSPORT_CHANGED_OR_ADDED_'+kind);
    }
    if(findings.length<RECORD_LIMIT)
      findings.push({kind,line:node.loc?.start?.line??0});
  });
  if(REVIEWED_READONLY_TRANSPORTS[filename]&&reviewedReadonlyCalls!==1)
    violations.push('EXPECTED_REVIEWED_READONLY_TRANSPORT_NOT_UNIQUE');
  // Deliberately dual-use Newbieland spawn planner. O51 checks that the
  // World --place gate runs before credential initialization; new alternate
  // transports or dynamic mutators still require explicit review.
  if(filename==='initial-spawn-planner.mjs'&&
      findings.some(f=>f.kind!=='MUTATING_CLIENT_WRAPPER'))
    violations.push('SCOUT_CHILD_PLANNER_UNREVIEWED_TRANSPORT');
  // The known guarded sources are deliberately exempt from a simple
  // presence-of-write classification, NOT exempt from their AST HOLD proof.
  // A new world-*.mjs transport or dynamic call cannot silently expand the
  // reviewed writer inventory.
  if(!reviewed&&/^world-.*\.mjs$/.test(filename)&&findings.length&&
      !REVIEWED_READONLY_TRANSPORTS[filename])
    violations.push('UNREVIEWED_WORLD_EXECUTABLE_SINK');
  return {filename,reviewed,findings,violations,guardedExports:exposed.length};
}
export function auditWorldAstRepo(root){
  const dir=path.join(root,'tools');
  const filenames=fs.readdirSync(dir).filter(name=>
    name.endsWith('.mjs')&&!name.endsWith('.test.mjs')&&
    !name.endsWith('.bench.mjs')).sort();
  const errors=[],counts={},reviewed=[],findings=[];
  for(const filename of filenames){
    const result=inspectWorldAstSource(filename,
      fs.readFileSync(path.join(dir,filename),'utf8'));
    errors.push(...result.violations.map(x=>filename+':'+x));
    if(result.reviewed)reviewed.push(filename);
    for(const f of result.findings){
      counts[f.kind]=(counts[f.kind]||0)+1;
      if(findings.length<RECORD_LIMIT)
        findings.push({file:filename,kind:f.kind,line:f.line,
          status:result.reviewed?'KNOWN_REVIEWED_SOURCE':
            filename.startsWith('world-')?'UNREVIEWED_WORLD':'OTHER_SOURCE'});
    }
  }
  if(reviewed.length!==Object.keys(WRITE_PATH_CLASSES).length)
    errors.push('REVIEWED_SOURCE_CARDINALITY_CHANGED');
  return {files:filenames.length,reviewed:reviewed.length,
    findings:findings.length,counts,errors,examples:findings};
}
