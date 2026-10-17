import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assessAutoDeployGate} from './world-next-auto-deploy-guard.mjs';
const base={me:{_id:'me',username:'riflex91'},branches:{list:[{branch:'chatgpt',activeWorld:true}]},
status:{status:'normal'},room:{objects:[
{type:'spawn',x:37,y:26,name:'Spawn1',user:'me'},
{type:'creep',user:'me',memory:{role:'harvester'}},
{type:'controller',user:'me',level:1}]},
code:{modules:Object.fromEntries(Array.from({length:8},(_,i)=>['module'+i,'code']))}};
assert.equal(assessAutoDeployGate(base).ok,true);
assert.equal(assessAutoDeployGate(base).uploadAuthorized,false);
assert.equal(assessAutoDeployGate(base).releaseEvidenceVerified,false);
assert.ok(assessAutoDeployGate({...base,me:{_id:'me'}}).failures.includes('WORLD_ACCOUNT_USERNAME_NOT_VERIFIED'));
assert.equal(assessAutoDeployGate({...base,room:{objects:[base.room.objects[0],base.room.objects[1],{type:'controller',level:1}]}}).ok,false);
assert.equal(assessAutoDeployGate({...base,room:{objects:[base.room.objects[0],base.room.objects[1],{type:'controller',user:'other',level:1}]}}).ok,false);
for(const patch of [
{me:{_id:'other'}},{status:{status:'empty'}},
{branches:{list:[{branch:'chatgpt-w37s79-stage',activeWorld:true}]}},
{room:{objects:[{type:'spawn',x:37,y:26,name:'Spawn1',user:'me'}]}},
{code:{modules:{}}}])
 assert.equal(assessAutoDeployGate({...base,...patch}).ok,false);
const wf=fs.readFileSync(new URL('../.github/workflows/screeps-world-next-auto-deploy.yml',import.meta.url),'utf8');
assert.match(wf,/SCREEPS_BRANCH: chatgpt\\n/);
assert.doesNotMatch(wf,/chatgpt-w37s79-stage/);
const hold=wf.indexOf('Block auto-upload until verified paired predecessor LIVE_100T_PASS');
const upload=wf.indexOf('Upload exact tested game modules');
assert.ok(hold>0&&upload>hold,'release HOLD must execute before World upload');
assert.match(wf.slice(hold,upload),/exit 1/);
assert.match(wf.slice(hold,upload),/WORLD_AUTO_DEPLOY_RELEASE_HOLD/);
console.log('W37S79 automatic deployment guard and fail-closed release workflow: PASS');
