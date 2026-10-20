import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function moduleAt(url) {
 const script=fs.readFileSync(new URL(url,import.meta.url),'utf8');
 const scope={module:{exports:{}}};
 vm.runInNewContext(script,scope);
 return scope.module.exports;
}
const fleet=moduleAt('../game/spawn.fleet.telemetry.js');
const stall=moduleAt('../game/spawn.job.stall.shadow.js');
const privateStrings=['private-repairer-job','spawn-private-one',
 'spawn-private-two','private-spawn-id'];
const room={name:'E8N1',controller:{my:true}};
function makeSpawn(name,id,busy){
 return {
  name,id,my:true,room,spawning:busy
    ? {name:'private-repairer-job',needTime:30,remainingTime:10}
    : null,
  isActive(){return true;},
  spawnCreep(){throw Error('Fleet telemetry must never spawn');},
  cancel(){throw Error('Fleet telemetry must never cancel');}
 };
}
const first=makeSpawn('spawn-private-one','private-spawn-id',true);
const second=makeSpawn('spawn-private-two','private-other-id',false);
let state={room,spawn:first,spawns:[first,second]};
let game={time:3000,spawns:{
 'spawn-private-one':first,'spawn-private-two':second
}};
const memory={bot:{}};
const logs=[];
const logger={warn(...args){logs.push(args);}};
const noObserver=fleet.summary(state,memory,game);
assert.equal(noObserver.status,'OBSERVED');
assert.equal(noObserver.fleetSize,2);
assert.equal(noObserver.busy,1);
assert.equal(noObserver.idleAvailable,1);
assert.equal(noObserver.allBusy,false);
assert.equal(noObserver.hasIdleCapacity,true);
assert.equal(noObserver.suspectStalled,null);
assert.equal(noObserver.evidenceFresh,false);
assert.equal(noObserver.trackedBusyJobs,null);
assert.equal(noObserver.actionAuthority,'NONE');

stall.observe(game,memory,logger);
let result=fleet.summary(state,memory,game);
assert.equal(result.evidenceFresh,true);
assert.equal(result.trackedBusyJobs,1);
assert.equal(result.untrackedBusyJobs,0);
assert.equal(result.maxContinuousJobTicks,1);
assert.equal(result.suspectStalled,0);
assert.equal(result.timerUnknown,0);
assert.equal(result.idleAvailable,1);
assert.equal(result.busy,1);
assert.equal(result.fleetSize,2);
for(const str of privateStrings)
 assert.equal(JSON.stringify(result).includes(str),false,
  'No spawn name, ID, or job name may leak in fleet telemetry');

// Persisted monitoring on a different tick is stale, not positive proof.
game.time++;
const stale=fleet.summary(state,memory,game);
assert.equal(stale.evidenceFresh,false);
assert.equal(stale.trackedBusyJobs,null);
assert.equal(stale.suspectStalled,null);
// Fresh observations from the same exact current game tick.
stall.observe(game,memory,logger);
result=fleet.summary(state,memory,game);
assert.equal(result.maxContinuousJobTicks,2);

// A different job in the current room in the SAME tick as old witness
// cannot reuse its old job identity, nor falsely claim no stall.
first.spawning.name='different-new-job';
result=fleet.summary(state,memory,game);
assert.equal(result.trackedBusyJobs,0);
assert.equal(result.untrackedBusyJobs,1);
assert.equal(result.suspectStalled,0);
first.spawning.name='private-repairer-job';

// A true 151 observed game-tick stall on primary remains visible even
// when an idle secondary means the room has productive spare capacity.
for(let n=1;n<=149;n++){
 game.time++;stall.observe(game,memory,logger);
}
assert.equal(game.time,3150);
result=fleet.summary(state,memory,game);
assert.equal(result.maxContinuousJobTicks,151);
assert.equal(result.suspectStalled,1);
assert.equal(result.idleAvailable,1);
assert.equal(result.allBusy,false);
assert.equal(logs.length,1);
assert.equal(logs[0][0],'SPAWN_JOB_STALL_SUSPECT');
// A room-wide stall status cannot be obscured by the first idle Spawn.
state.spawns=[second,first];
result=fleet.summary(state,memory,game);
assert.equal(result.suspectStalled,1);
assert.equal(result.hasIdleCapacity,true);
// A fresh observer does NOT imply live same-tick evidence if the job
// was replaced after observer ran.
first.spawning={name:'changed-replacement',needTime:20,remainingTime:8};
result=fleet.summary(state,memory,game);
assert.equal(result.suspectStalled,0);
assert.equal(result.untrackedBusyJobs,1);

// Restoring original job and then invalid timer yields UNKNOWN, not
// falsely healthy, on the same tick after observing it.
first.spawning={name:'unknown-job',needTime:null,remainingTime:null};
game.time++;stall.observe(game,memory,logger);
result=fleet.summary(state,memory,game);
assert.equal(result.timerUnknown,1);
assert.equal(result.trackedBusyJobs,1);
assert.equal(result.suspectStalled,0);
assert.equal(result.maxContinuousJobTicks,0);

// All owned spawns busy means zero idle slots; do not conflate with
// one primary busy and one idle.
second.spawning={name:'another-private-job',needTime:35,remainingTime:9};
game.time++;stall.observe(game,memory,logger);
result=fleet.summary(state,memory,game);
assert.equal(result.busy,2);
assert.equal(result.idleAvailable,0);
assert.equal(result.allBusy,true);
assert.equal(result.hasIdleCapacity,false);
assert.equal(result.timerUnknown,1);

// When O65 watches only one busy spawn after a job appeared in the
// same tick, counts are live but evidence coverage is partial.
second.spawning.name='replaced-after-observe';
result=fleet.summary(state,memory,game);
assert.equal(result.busy,2);
assert.equal(result.trackedBusyJobs,1);
assert.equal(result.untrackedBusyJobs,1);
assert.equal(result.hasIdleCapacity,false);

// An inactive spawn is NOT available, and is never falsely counted busy.
second.spawning=null;
second.isActive=()=>false;
result=fleet.summary(state,memory,game);
assert.equal(result.busy,1);
assert.equal(result.inactive,1);
assert.equal(result.idleAvailable,0);
assert.equal(result.allBusy,false);
second.isActive=()=>{throw Error('bad runtime');};
result=fleet.summary(state,memory,game);
assert.equal(result.unknown,1);
assert.equal(result.inactive,0);
second.isActive=()=>true;
// Cross-room or explicitly foreign objects cannot count as free.
second.room={name:'W10N10'};
result=fleet.summary(state,memory,game);
assert.equal(result.unknown,1);
assert.equal(result.idleAvailable,0);
second.room=room;
second.my=false;
result=fleet.summary(state,memory,game);
assert.equal(result.unknown,1);
second.my=true;
second.spawnCreep=undefined;
result=fleet.summary(state,memory,game);
assert.equal(result.unknown,1,'no authorized method -> no free capacity');

// Stale names duplicate in the supplied list are held unknown, not double counted.
second.spawnCreep=()=>{throw Error('observer must not execute');};
state.spawns=[first,first];
result=fleet.summary(state,memory,game);
assert.equal(result.unknown,1);
assert.equal(result.busy,1);
assert.equal(result.fleetSize,2);
// Fail closed on cap and invalid input, without reading all candidates.
state.spawns=Array.from({length:fleet.MAX_SPAWNS+1},()=>first);
result=fleet.summary(state,memory,game);
assert.equal(result.status,'HOLD');
assert.equal(result.reason,'FLEET_BUDGET_EXCEEDED');
assert.equal(result.fleetSize,null);
assert.equal(result.hasIdleCapacity,null);
assert.equal(result.evidenceFresh,false);
assert.equal(fleet.summary(null,memory,game).status,'HOLD');
assert.equal(fleet.summary({room,spawns:[]},memory,game).status,'NO_SPAWNS');
assert.equal(fleet.summary({room,spawns:[]},memory,game).hasIdleCapacity,false);
assert.equal(fleet.summary({room,spawns:[]},memory,{time:NaN}).status,'HOLD');
assert.equal(fleet.summary({room,spawns:[first]},memory,{time:3151})
 .evidenceFresh,false);
assert.equal(logs.length,1);

const main=fs.readFileSync(new URL('../game/main.js',import.meta.url),'utf8');
const spawnManager=fs.readFileSync(new URL('../game/spawn.manager.js',import.meta.url),'utf8');
assert.match(main,/const spawnFleetTelemetry = require\('spawn\.fleet\.telemetry'\)/);
assert.match(main,/spawnFleet:\s*spawnFleetTelemetry\.summary\(state, Memory, Game\)/);
assert.match(main,/spawnBusy:\s*!!\(state\.spawn && state\.spawn\.spawning\)/,
 'O67 explicitly preserves old primary-only field for consumers');
assert.match(main,/spawnJobStallShadow\.observe\(Game, Memory, logger\)/);
assert.match(spawnManager,/const spawn = selectIdleSpawn\(state\)/);
const fleetSource=fs.readFileSync(new URL(
 '../game/spawn.fleet.telemetry.js',import.meta.url),'utf8');
for(const forbidden of [/\.spawnCreep\s*\(/,/\.cancel\s*\(/,
 /\.createConstructionSite\s*\(/,/\.renewCreep\s*\(/,
 /delete\s+Memory\.creeps/,/\.setActive\s*\(/,
 /\bfetch\s*\(/])
 assert.doesNotMatch(fleetSource,forbidden);
console.log('O67 same-room busy/free/inactive fleet telemetry, fresh actual-tick stall correlation, identity-safe diagnostics PASS');
