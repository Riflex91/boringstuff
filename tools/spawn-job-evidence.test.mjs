import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code=fs.readFileSync(new URL('../game/spawn.job.evidence.js',import.meta.url),'utf8');
const context={module:{exports:{}}};
vm.runInNewContext(code,context);
const {snapshot,MAX_SPAWN_TICKS}=context.module.exports;
assert.equal(MAX_SPAWN_TICKS,150);
const me={creeps:{'private-repairer':{role:'repairer',born:480}}};
const activeSpawn={spawning:{
  name:'private-repairer',needTime:60,remainingTime:40,
  cancel(){throw Error('Diagnostic must NEVER cancel');},
  setDirections(){throw Error('Diagnostic must NEVER alter spawn directions');}
}};
const state={spawn:activeSpawn};
const game={time:500,creeps:{
  'private-repairer':{spawning:true,memory:{role:'repairer',born:480}}
}};
const result=snapshot(state,game,me);
assert.equal(result.status,'ACTIVE_JOB_TIMING_OBSERVED');
assert.equal(result.authority,'IN_GAME_DIAGNOSTIC_ONLY');
assert.equal(result.currentGameTickVerified,true);
assert.equal(result.actionsTaken,0);
assert.equal(result.canAuthorizeCancel,false);
assert.equal(result.canAuthorizeClaim,false);
assert.equal(result.tick,500);
assert.equal(result.jobNameVerified,true);
assert.equal(result.memoryRole,'repairer');
assert.equal(result.gameCreepPresent,true);
assert.equal(result.gameCreepSpawning,true);
assert.equal(result.jobBornTick,480);
assert.equal(result.elapsedSinceSpawnIntentTicks,20);
assert.equal(result.needTime,60);
assert.equal(result.remainingTime,40);
assert.equal(result.timingFieldsConsistent,true);
assert.equal(result.ageExceeds150Ticks,false);
assert.equal(result.ageVsRemainingMismatch,false);
assert.equal(result.sameJobAcrossSnapshotsVerified,false);
assert.ok(!JSON.stringify(result).includes('private-'),'never emit identifiers');
assert.equal(snapshot({spawn:{spawning:null}},game,me).status,'IDLE');
assert.equal(snapshot({spawn:null},game,me).status,'NO_OWN_SPAWN');
assert.equal(snapshot({spawn:{}},game,me).status,'UNVERIFIED');
assert.equal(snapshot(state,{time:'invalid',creeps:{}},me).status,'UNVERIFIED');

const tooOld=snapshot(state,{...game,time:11000},me);
assert.equal(tooOld.memoryRole,'repairer');
assert.equal(tooOld.elapsedSinceSpawnIntentTicks,10520);
assert.equal(tooOld.ageExceeds150Ticks,true);
assert.equal(tooOld.ageVsRemainingMismatch,true);
assert.equal(tooOld.canAuthorizeCancel,false);
assert.ok(!JSON.stringify(tooOld).includes('private'));

const absentMemory=snapshot(state,{time:500,creeps:{}},{creeps:{}});
assert.equal(absentMemory.status,'ACTIVE_JOB_TIMING_OBSERVED');
assert.equal(absentMemory.memoryRole,null);
assert.equal(absentMemory.jobBornTick,null);
assert.equal(absentMemory.ageExceeds150Ticks,null);
assert.equal(absentMemory.gameCreepPresent,false);

const partial=snapshot({spawn:{spawning:{
  name:'private-repairer',needTime:undefined,remainingTime:undefined
}}},game,me);
assert.equal(partial.status,'ACTIVE_JOB_PARTIAL');
assert.equal(partial.needTime,null);
assert.equal(partial.remainingTime,null);
assert.equal(partial.timingFieldsConsistent,null);
assert.equal(partial.ageVsRemainingMismatch,null);
const incoherent=snapshot({spawn:{spawning:{
  name:'private-repairer',needTime:30,remainingTime:40
}}},game,me);
assert.equal(incoherent.status,'ACTIVE_JOB_PARTIAL');
assert.equal(incoherent.timingFieldsConsistent,false);
assert.equal(incoherent.ageVsRemainingMismatch,null);
const unknownRole=snapshot(state,game,{
  creeps:{'private-repairer':{role:'<secret>',born:-1}}
});
assert.equal(unknownRole.memoryRole,null);
assert.equal(unknownRole.jobBornTick,null);
assert.equal(unknownRole.elapsedSinceSpawnIntentTicks,null);
assert.equal(unknownRole.ageExceeds150Ticks,null);
assert.ok(!JSON.stringify(unknownRole).includes('<secret>'));
const badName=snapshot({spawn:{spawning:{
  name:'',needTime:6,remainingTime:3
}}},game,me);
assert.equal(badName.jobNameVerified,false);
assert.equal(badName.status,'ACTIVE_JOB_PARTIAL');
assert.equal(badName.memoryRole,null);
assert.equal(badName.actionsTaken,0);
console.log('O20 in-game spawn-job evidence (read-only) regression PASS');
