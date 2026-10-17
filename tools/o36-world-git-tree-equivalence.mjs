// O36: independently compare original successful World O16 game tree to the
// exact predecessor Main game tree. Only authenticated GitHub REST GETs.
// This is code BYTE equivalence, never a substitute for the user's strict
// exact-commit same-run World canonical LIVE_100T_PASS release requirement.
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const PREDECESSOR_MAIN='bc43f2faf1f345e63d9bfe78b6bbaa59e5eaab0c';
export const ORIGINAL_WORLD_RUN_SHA='3f14590592d30dded0b6f61ab0e301e475ed6bf3';
export const EXPECTED_GAME_MODULES=82;
const hex40=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);

export function assessIndependentGameTreeEquality({
  oldTree,currentTree,
  oldCommit=ORIGINAL_WORLD_RUN_SHA,
  currentCommit=PREDECESSOR_MAIN
}={}){
  const invalid=(reason)=>({
    result:'HOLD_CODE_TREE_UNVERIFIED',reason,gameBytesIdentical:false,
    originalWorldRunMatchesExactMain:false,exactMainWorldLive100tPass:false,
    releaseAuthorized:false,gameModuleCount:null,
    originalGameTreeSha:null,currentGameTreeSha:null,apiMutationsAttempted:0
  });
  if(!hex40(oldCommit)||!hex40(currentCommit)||
     oldCommit!==ORIGINAL_WORLD_RUN_SHA||currentCommit!==PREDECESSOR_MAIN)
    return invalid('UNTRUSTED_SOURCE_COMMITS');
  const normalize=(response,expected)=>{
    if(!response||response.truncated!==false||
       response.sha!==expected||!Array.isArray(response.tree)||
       response.tree.length<EXPECTED_GAME_MODULES||
       response.tree.length>20000)return null;
    const dir=response.tree.filter(n=>n?.path==='game'&&
      n.type==='tree'&&n.mode==='040000'&&hex40(n.sha));
    if(dir.length!==1)return null;
    const gameEntries=response.tree.filter(n=>typeof n?.path==='string'&&
      n.path.startsWith('game/'));
    // No unknown symlinks, nested blobs, sidecar assets, unenumerated types,
    // duplicate module names, ignored JS or path traversal.
    if(gameEntries.length!==EXPECTED_GAME_MODULES)return null;
    const files=new Map();
    for(const item of gameEntries){
      if(!/^game\/[a-zA-Z0-9._-]+\.js$/.test(item.path)||
         item.type!=='blob'||item.mode!=='100644'||
         !hex40(item.sha)||!Number.isSafeInteger(item.size)||
         item.size<1||item.size>2_000_000||
         files.has(item.path))return null;
      files.set(item.path,item.sha);
    }
    if(!files.has('game/main.js')||!files.has('game/config.js')||
       !files.has('game/telemetry.journal.js'))return null;
    return {dirSha:dir[0].sha,files};
  };
  const original=normalize(oldTree,oldCommit);
  const current=normalize(currentTree,currentCommit);
  if(!original||!current)return invalid('UNBOUNDED_INCOMPLETE_OR_INVALID_GAME_TREE');
  const equivalent=original.dirSha===current.dirSha&&
    original.files.size===current.files.size&&
    [...original.files].every(([name,sha])=>current.files.get(name)===sha);
  return {
    result:equivalent?'HISTORIC_WORLD_GAME_BYTES_EQUAL_EXACT_MAIN':
      'HOLD_WORLD_ORIGINAL_GAME_BYTES_DIFFER',
    reason:equivalent?null:'GIT_BLOB_SHA_MISMATCH',
    originalSourceSha:oldCommit,
    predecessorMainSha:currentCommit,
    originalGameTreeSha:original.dirSha,
    currentGameTreeSha:current.dirSha,
    gameModuleCount:original.files.size,
    gameBytesIdentical:equivalent,
    originalWorldRunMatchesExactMain:false,
    exactMainWorldLive100tPass:false,
    releaseAuthorized:false,
    apiMutationsAttempted:0
  };
}
const base='https://api.github.com/repos/Riflex91/boringstuff/git/trees/';
export async function readTrustworthyGithubGameTree(sha,{
  token=process.env.GITHUB_TOKEN,read=getGitTree
}={}){
  if(![PREDECESSOR_MAIN,ORIGINAL_WORLD_RUN_SHA].includes(sha))
    throw Error('NONPINNED_GIT_TREE_DISALLOWED');
  return read(base+sha+'?recursive=1',token);
}
export async function getGitTree(uri,token){
  if(!token||typeof token!=='string')throw Error('GITHUB_ACTIONS_GET_TOKEN_REQUIRED');
  const u=new URL(uri);
  if(u.protocol!=='https:'||u.host!=='api.github.com'||
     ![PREDECESSOR_MAIN,ORIGINAL_WORLD_RUN_SHA].some(s=>
       u.pathname==='/repos/Riflex91/boringstuff/git/trees/'+s)||
     u.search!=='?recursive=1')throw Error('GITHUB_TREE_URI_NOT_PINNED');
  const res=await fetch(uri,{
    method:'GET',
    headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json'},
    signal:AbortSignal.timeout(20000)
  });
  if(!res.ok)throw Error('GITHUB_TREE_API_UNVERIFIED_'+res.status);
  const declared=Number(res.headers.get('content-length')||0);
  if(declared>4_000_000)throw Error('GITHUB_TREE_RESPONSE_UNBOUNDED');
  const text=await res.text();
  if(text.length>4_000_000)throw Error('GITHUB_TREE_RESPONSE_UNBOUNDED');
  return JSON.parse(text);
}
export async function inspectLiveGithubTrees(options={}){
  const [oldTree,currentTree]=await Promise.all([
    readTrustworthyGithubGameTree(ORIGINAL_WORLD_RUN_SHA,options),
    readTrustworthyGithubGameTree(PREDECESSOR_MAIN,options)
  ]);
  return assessIndependentGameTreeEquality({oldTree,currentTree});
}
async function main(){
  if(process.env.GITHUB_REPOSITORY!=='Riflex91/boringstuff'||
     !process.env.GITHUB_TOKEN)throw Error('TRUSTED_GITHUB_CONTEXT_REQUIRED');
  const status=await inspectLiveGithubTrees();
  console.log('O36_VERIFIED_HISTORICAL_GAME_TREE '+JSON.stringify(status));
  if(!status.gameBytesIdentical)process.exitCode=2;
  // A successful code comparison job is NOT a green World 100T release gate.
}
if(process.argv[1]&&
  path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(()=>{
    console.error('O36_GAME_TREE_COMPARISON_UNVERIFIED');
    process.exitCode=2;
  });
