import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'acorn';
import {
  LEGACY_WORLD_MUTATOR_EXPORTS,WRITE_PATH_CLASSES
} from './o50-world-write-path-audit.mjs';

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
    if(verb==='GET')return null;
    return verb===null?'UNKNOWN_HTTP_VERB':'MUTATING_API_REQUEST';
  }
  if(MUTATORS.has(member))return 'MUTATING_CLIENT_WRAPPER';
  if(member==='fetch'&&(object==='globalThis'||object===''))
    return 'FETCH_TRANSPORT';
  if(member==='fetch'&&imports.get(member))return 'FETCH_TRANSPORT';
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
  const reviewed=WRITE_PATH_CLASSES[filename]||null;
  const exposed=LEGACY_WORLD_MUTATOR_EXPORTS[filename]||[];
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
  nodes(ast,node=>{
    const kind=candidateKind(node,bindings);
    if(kind&&findings.length<RECORD_LIMIT)
      findings.push({kind,line:node.loc?.start?.line??0});
  });
  // The known guarded sources are deliberately exempt from a simple
  // presence-of-write classification, NOT exempt from their AST HOLD proof.
  // A new world-*.mjs transport or dynamic call cannot silently expand the
  // reviewed writer inventory.
  if(!reviewed&&/^world-.*\.mjs$/.test(filename)&&findings.length)
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
