import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  PREDECESSOR_MAIN,ORIGINAL_WORLD_RUN_SHA,EXPECTED_GAME_MODULES,
  assessIndependentGameTreeEquality,readTrustworthyGithubGameTree,
  inspectLiveGithubTrees
} from './o36-world-git-tree-equivalence.mjs';

const sha=s=>createHash('sha1').update(s).digest('hex');
const gameNames=['main.js','config.js','telemetry.journal.js',
  ...Array.from({length:79},(_,i)=>'module'+String(i).padStart(2,'0')+'.js')];
assert.equal(gameNames.length,EXPECTED_GAME_MODULES);
const treeSha=sha('original World and exact Main game tree');
const files=gameNames.map(name=>({
  path:'game/'+name,mode:'100644',type:'blob',
  sha:sha('contents of '+name),size:1000
}));
const tree=(commit)=>({
  sha:commit,truncated:false,
  tree:[{path:'game',mode:'040000',type:'tree',sha:treeSha},
    ...files,{path:'tools/README.md',mode:'100644',type:'blob',
      sha:sha(commit),size:200}]
});
const older=tree(ORIGINAL_WORLD_RUN_SHA),now=tree(PREDECESSOR_MAIN);
const good=assessIndependentGameTreeEquality({
  oldTree:older,currentTree:now
});
assert.equal(good.result,'HISTORIC_WORLD_GAME_BYTES_EQUAL_EXACT_MAIN');
assert.equal(good.gameBytesIdentical,true);
assert.equal(good.originalGameTreeSha,treeSha);
assert.equal(good.currentGameTreeSha,treeSha);
assert.equal(good.gameModuleCount,82);
assert.equal(good.originalWorldRunMatchesExactMain,false);
assert.equal(good.exactMainWorldLive100tPass,false);
assert.equal(good.releaseAuthorized,false);
assert.equal(good.apiMutationsAttempted,0);
assert.ok(!JSON.stringify(good).includes('contents of'));

const withEdit=(t,fn)=>{const v=JSON.parse(JSON.stringify(t));fn(v);return v;};
const failures=[
  withEdit(now,x=>{x.tree[3].sha=sha('changed module');}),
  withEdit(now,x=>{x.tree[0].sha=sha('different root tree');}),
  withEdit(now,x=>{x.truncated=true;}),
  withEdit(now,x=>{x.sha=ORIGINAL_WORLD_RUN_SHA;}),
  withEdit(now,x=>{x.tree.pop();x.tree.pop();}),
  withEdit(now,x=>{x.tree[2].path=x.tree[1].path;}),
  withEdit(now,x=>{x.tree[2].mode='120000';}),
  withEdit(now,x=>{x.tree[2].type='tree';}),
  withEdit(now,x=>{x.tree[2].size=2000001;}),
  withEdit(now,x=>{x.tree[2].sha='not-sha';}),
  withEdit(now,x=>{x.tree[2].path='game/../evil.js';}),
  withEdit(now,x=>{x.tree[2].path='game/nested/other.js';}),
  withEdit(now,x=>{x.tree[2].path='game/note.txt';}),
  withEdit(now,x=>{x.tree[0].path='not-game';}),
  withEdit(now,x=>{x.tree.push({...x.tree[1]});}),
  withEdit(now,x=>{x.tree=x.tree.filter(e=>e.path!=='game/main.js');}),
  withEdit(now,x=>{x.tree=x.tree.filter(e=>e.path!=='game/config.js');}),
  withEdit(now,x=>{x.tree=x.tree.filter(e=>e.path!=='game/telemetry.journal.js');})
];
for(let i=0;i<failures.length;i++){
  const proof=assessIndependentGameTreeEquality({
    oldTree:older,currentTree:failures[i]});
  assert.equal(proof.gameBytesIdentical,false,'failure case '+i);
  assert.equal(proof.releaseAuthorized,false);
  assert.equal(proof.exactMainWorldLive100tPass,false);
}
assert.equal(assessIndependentGameTreeEquality({
  oldTree:older,currentTree:now,oldCommit:PREDECESSOR_MAIN
}).gameBytesIdentical,false);
assert.equal(assessIndependentGameTreeEquality({
  oldTree:older,currentTree:now,currentCommit:ORIGINAL_WORLD_RUN_SHA
}).gameBytesIdentical,false);

const calls=[];
const read=async(uri,token)=>{
 assert.equal(token,'TEST_TOKEN');
 calls.push(uri);
 assert.equal(new URL(uri).search,'?recursive=1');
 if(uri.includes(ORIGINAL_WORLD_RUN_SHA))return older;
 if(uri.includes(PREDECESSOR_MAIN))return now;
 throw Error('UNEXPECTED_GITHUB_URL');
};
const result=await inspectLiveGithubTrees({token:'TEST_TOKEN',read});
assert.equal(result.gameBytesIdentical,true);
assert.equal(calls.length,2);
assert.ok(calls.every(uri=>uri.startsWith(
 'https://api.github.com/repos/Riflex91/boringstuff/git/trees/')));
await assert.rejects(
 ()=>readTrustworthyGithubGameTree('a'.repeat(40),{token:'TEST_TOKEN',read}),
 /NONPINNED_GIT_TREE_DISALLOWED/);
assert.equal(result.releaseAuthorized,false);
console.log('O36 82 immutable Git game blobs equal across World/Current Main; strict World SHA HOLD: PASS');
