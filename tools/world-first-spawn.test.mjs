import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessPinnedFirstSpawnSafety,PLACEMENT_CONFIRM,RIVAL_CONFIRM} from './world-first-spawn.mjs';

assert.equal(PLACEMENT_CONFIRM,'PLACE_W37N11_12_13');
assert.equal(RIVAL_CONFIRM,'ACCEPT_W35N11_RCL8');
const target={shard:'shard0',room:'W37N11',x:12,y:13,spawnName:'Spawn1'};
const checks=['world-status-empty','room-status-normal','controller-exists',
'controller-unowned','controller-unreserved','spawn-tile-free-and-buildable',
'spawn-name-available','world-branch-present','world-code-ready'];
function dossier(){
 const observations=Array.from({length:24},(_,i)=>({
 room:i===0?'W35N11':'W37N'+(15+i),verified:true,
 foreignOwner:i===0,foreignReservation:false,controllerLevel:i===0?8:0
 }));
 return {target:{...target},evidenceSource:'LIVE_SCREEPS_WORLD_API',
 mode:'GET_ONLY',worldStatus:'empty',fixedTargetSitePassed:true,
 stagedCodeStatus:'EXACT_INACTIVE_CODE',exactInactiveCode:true,
 branchActive:false,ring:{mode:'GET_ONLY',requestedRooms:24,verifiedRooms:24,
 coverageComplete:true,unverifiedRooms:[],observations,
 foreignOwnedRooms:1,foreignReservedRooms:0}};
}
function final(){
 return {ok:true,room:target.room,x:12,y:13,name:'Spawn1',branch:'chatgpt',
 worldStatus:'empty',roomStatus:'normal',tile:{ok:true,terrain:'plain'},
 checks:checks.map(name=>({name,pass:true,severity:'error'})),
 evidence:{spawnNameCheckRaw:{ok:1},placementEndpointCalled:false}};
}
assert.equal(assessPinnedFirstSpawnSafety(dossier(),final()).ok,true);
const cases=[
 [r=>r.target.x=20,'PINNED_TARGET_MISMATCH'],
 [r=>r.worldStatus='normal','WORLD_NOT_EMPTY'],
 [r=>r.exactInactiveCode=false,'EXACT_INACTIVE_WORLD_CODE_UNVERIFIED'],
 [r=>r.branchActive=true,'EXACT_INACTIVE_WORLD_CODE_UNVERIFIED'],
 [r=>r.ring.verifiedRooms=23,'TWENTY_FOUR_ROOM_RISK_EVIDENCE_INCOMPLETE'],
 [r=>r.ring.unverifiedRooms=['W36N11'],'RIVAL_COVERAGE_GAPS'],
 [r=>{r.ring.observations[1].foreignOwner=true;r.ring.foreignOwnedRooms=2},
 'UNAPPROVED_ADDITIONAL_RIVAL_CONTROL'],
 [r=>r.ring.observations[0].controllerLevel=7,'KNOWN_RIVAL_LEVEL_CHANGED'],
 [r=>r.ring.observations[0].foreignReservation=true,
 'UNAPPROVED_ADDITIONAL_RIVAL_CONTROL']
];
for (const [change,reason] of cases){
 const r=dossier();change(r);
 const verdict=assessPinnedFirstSpawnSafety(r,final());
 assert.equal(verdict.ok,false,reason);
 assert.ok(verdict.failures.includes(reason),JSON.stringify(verdict.failures));
}
const wrong=final();wrong.x=11;
assert.equal(assessPinnedFirstSpawnSafety(dossier(),wrong).ok,false);
const nameMissing=final();nameMissing.checks=nameMissing.checks.filter(
 x=>x.name!=='spawn-name-available');
assert.equal(assessPinnedFirstSpawnSafety(dossier(),nameMissing).ok,false);
const nameFailed=final();nameFailed.evidence.spawnNameCheckRaw={ok:false};
assert.ok(assessPinnedFirstSpawnSafety(dossier(),nameFailed).failures
 .includes('SPAWN_NAME_API_REJECTED'));
const file=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),
 'world-first-spawn.mjs'),'utf8');
for(const denied of [/\.userSetActiveBranch\s*\(/,/\.userSetCode\s*\(/,
 /\._request\s*\(\s*['"]POST['"]/])
 assert.equal(denied.test(file),false,
 'World first spawn code may not activate or upload code');
console.log('World pinned W37N11 first-spawn policy tests: PASS');
