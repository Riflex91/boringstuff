import {parse} from 'acorn';

// O54: the two historically reviewed read-only transport calls are checked
// against independently specified exact AST shapes. This is NOT a generic
// permission to issue HTTP requests or spawn arbitrary subprocesses.
// Any change in arguments, method, shell options or executable must be
// individually reviewed before the shape is updated.
const fetchGet=String.raw`fetch(url,{headers:{
  Accept:'application/vnd.github+json',
  Authorization:'Bearer '+token,
  'X-GitHub-Api-Version':'2022-11-28'
},redirect:'manual'})`;
const scoutChild=String.raw`spawnSync(process.execPath,[
  'initial-spawn-planner.mjs','--server','world',
  '--shard',shard,'--deep-top','5','--top-rooms','5',
  '--strategic-radius','2','--cache-hours','0','--refresh',
  '--concurrency','4',...selected
],{cwd:dir,env,stdio:['ignore',fd,fd],timeout:7*60*1000})`;
function shape(obj){
  if(Array.isArray(obj))return obj.map(shape);
  if(obj===null||typeof obj!=='object')return obj;
  const out={};
  for(const [key,val] of Object.entries(obj)){
    if(['start','end','range','loc','raw'].includes(key))continue;
    out[key]=shape(val);
  }
  return out;
}
function canonicalCall(src){
  const expr=parse(src,{ecmaVersion:'latest',sourceType:'module'})
    .body[0]?.expression;
  if(expr?.type!=='CallExpression')throw new Error('O54_BAD_STATIC_CALL');
  return JSON.stringify(shape(expr));
}
const PINNED_GITHUB_GET=canonicalCall(fetchGet);
const PINNED_SCOUT_CHILD=canonicalCall(scoutChild);
export const REVIEWED_READONLY_TRANSPORT_SHAPES=Object.freeze({
  'world-first-spawn-live-gate.mjs':'FETCH_TRANSPORT',
  'world-scout.mjs':'ALTERNATE_NETWORK_TRANSPORT'
});
export function isExactlyReviewedReadOnlyTransport(filename,node,kind,bindings){
  if(REVIEWED_READONLY_TRANSPORT_SHAPES[filename]!==kind||
      node?.type!=='CallExpression'||node.optional===true)return false;
  if(filename==='world-first-spawn-live-gate.mjs'){
    // A shadowing *const* or imported "fetch" makes the provenance unknown.
    // Parameter/global reassignment requires separate review; this is AST
    // source inspection, not runtime isolation.
    if(bindings?.consts?.has('fetch')||bindings?.imports?.has('fetch'))
      return false;
    return JSON.stringify(shape(node))===PINNED_GITHUB_GET;
  }
  if(filename==='world-scout.mjs'){
    if(bindings?.imports?.get('spawnSync')!=='node:child_process')
      return false;
    return JSON.stringify(shape(node))===PINNED_SCOUT_CHILD;
  }
  return false;
}

// These are *additional indicators* for common indirections missed by an
// identifier/member call scanner. They are not whole-program alias analysis.
export function detectDynamicDispatch(node){
  if(node?.type!=='CallExpression'&&node?.type!=='NewExpression')
    return null;
  const callee=node.callee;
  if(callee?.type!=='MemberExpression')return null;
  const property=callee.computed
    ?(callee.property?.type==='Literal'?callee.property.value:null)
    :callee.property?.name;
  if(callee.object?.type==='Identifier'&&callee.object.name==='Reflect'&&
      ['apply','construct'].includes(property))
    return 'REFLECT_DYNAMIC_DISPATCH';
  if(['call','apply','bind'].includes(property)){
    const target=callee.object;
    if(target?.type==='Identifier'&&
       ['fetch','spawnSync','eval','Function','WebSocket'].includes(target.name))
      return 'INDIRECT_NETWORK_CALL';
    if(target?.type==='MemberExpression'){
      const prop=target.computed?
        (target.property?.type==='Literal'?target.property.value:null):
        target.property?.name;
      if(['_request','userUploadCodeOnce','gamePlaceSpawn','send',
          'request','connect'].includes(prop))
        return 'INDIRECT_NETWORK_CALL';
    }
  }
  return null;
}
export function reviewedTransportFixtures(){
  // Test-only source snippets for intended exact ASTs, no execution.
  return Object.freeze({githubGet:fetchGet,scoutChild});
}
