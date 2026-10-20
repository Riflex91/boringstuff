import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const file = new URL('../game/spawn.job.stall.shadow.js', import.meta.url);
const src = fs.readFileSync(file,'utf8');
const mod = {exports:{}};
vm.runInNewContext(src,{module:mod,Number,Object,Math});
const {observe,summary,MAX_SPAWNS,MAX_SPAWN_TICKS} = mod.exports;
assert.equal(MAX_SPAWN_TICKS,150);
const logs=[];
const logger={warn(...args){logs.push(args);}};
const memory={bot:{}};
const spawn={id:'private-spawn-id',my:true,
  room:{name:'E8N1',controller:{my:true}},
  spawning:{name:'private-repairer-name',needTime:150,remainingTime:42},
  spawnCreep(){throw Error('observer cannot spawn');},
  cancel(){throw Error('observer cannot cancel');}
};
const game={time:100,spawns:{'private-spawn-name':spawn}};
let result=observe(game,memory,logger);
assert.equal(result.events.length,0);
assert.equal(summary('E8N1',memory).status,'OBSERVING');
assert.equal(summary('E8N1',memory).observedTicks,1);
assert.equal(memory.bot.spawnJobStallWatch.bySpawn['private-spawn-name'].jobName,
  'private-repairer-name','private correlation stored but never published');
assert.ok(!JSON.stringify(summary('E8N1',memory)).includes('private'));
assert.equal(summary('OTHER',memory).status,'UNOBSERVED');
assert.equal(logs.length,0);

// Normal observed timer progress does NOT create a warning.
for(let i=1;i<=8;i++){
 game.time=100+i;spawn.spawning.remainingTime=42-i;
 observe(game,memory,logger);
}
assert.equal(summary('E8N1',memory).observedTicks,9);
assert.equal(summary('E8N1',memory).timerAnomalies,0);
// A tick gap destroys continuity. Real elapsed game time is not a
// substitute for actual consecutive sample coverage.
game.time=111;
result=observe(game,memory,logger);
assert.equal(summary('E8N1',memory).observedTicks,1);
assert.equal(result.events.length,0);

// Persistent unchanged same-job data over >150 ACTUALLY OBSERVED ticks
// emits exactly one advisory, without invoking spawnCreep or cancel.
spawn.spawning.remainingTime=20;
for(let n=1;n<=MAX_SPAWN_TICKS;n++){
 game.time=111+n;
 const result=observe(game,memory,logger);
 if(n<MAX_SPAWN_TICKS-1)
  assert.equal(result.events.length,0);
}
assert.equal(summary('E8N1',memory).status,'SUSPECT_STALLED');
assert.equal(summary('E8N1',memory).observedTicks,151);
assert.equal(logs.length,1);
assert.equal(logs[0][0],'SPAWN_JOB_STALL_SUSPECT');
assert.equal(logs[0][2].evidence,'CONTIGUOUS_IN_GAME_TICKS');
assert.equal(logs[0][2].resolution,'MANUAL_REVIEW_ONLY');
assert.equal(logs[0][2].actionAuthority,'NONE');
assert.ok(logs[0][2].timerAnomalies>0);
assert.equal(logs[0][3].persist,true);
for(const privateText of ['private-repairer-name','private-spawn-name','private-spawn-id']){
 assert.ok(!JSON.stringify(logs).includes(privateText),
  'private job/spawn IDs must never be journaled');
}
game.time++;
observe(game,memory,logger);
assert.equal(logs.length,1,'do not repeat the transition warning each tick');

// Serialization/rehydration must preserve bounded actual game-tick state.
const restored=JSON.parse(JSON.stringify(memory));
game.time++;
observe(game,restored,logger);
assert.equal(logs.length,1);
assert.equal(summary('E8N1',restored).status,'SUSPECT_STALLED');

// Replaced spawning job is NEVER inferred from a stale Memory.creeps.born.
spawn.spawning={name:'new-private-job',needTime:90,remainingTime:90};
game.time++;result=observe(game,restored,logger);
assert.equal(result.events.length,0);
assert.equal(summary('E8N1',restored).observedTicks,1);
assert.equal(summary('E8N1',restored).status,'OBSERVING');

// Incomplete or nonsensical in-game timing is UNKNOWN, not stalled.
for(const wrong of [
 {name:'new-private-job',needTime:undefined,remainingTime:1},
 {name:'new-private-job',needTime:151,remainingTime:1},
 {name:'new-private-job',needTime:90,remainingTime:null},
 {name:'new-private-job',needTime:90,remainingTime:-1},
 {name:'new-private-job',needTime:90,remainingTime:91},
 {name:123,needTime:90,remainingTime:25}
]){
 spawn.spawning=wrong;game.time++;
 result=observe(game,restored,logger);
 assert.equal(result.events.length,0);
 assert.equal(summary('E8N1',restored).status,'TIMER_UNKNOWN');
 assert.equal(summary('E8N1',restored).warning,false);
}
spawn.spawning={name:'new-private-job',needTime:60,remainingTime:40};
game.time++;
observe(game,restored,logger);
assert.equal(summary('E8N1',restored).observedTicks,1,
 'Unknown timer chain must not borrow previous valid observations');
// A new spawn ID at the same name is a new observed job.
spawn.id='replacement-spawn';game.time++;
observe(game,restored,logger);
assert.equal(summary('E8N1',restored).observedTicks,1);
// Same-tick re-entry cannot count as next game tick.
observe(game,restored,logger);
assert.equal(summary('E8N1',restored).observedTicks,1);
// Backward clock cannot launder observed durations.
game.time=2;observe(game,restored,logger);
assert.equal(summary('E8N1',restored).observedTicks,1);
spawn.spawning=null;game.time++;
observe(game,restored,logger);
assert.equal(summary('E8N1',restored).status,'IDLE');
assert.equal(summary('E8N1',restored).warning,false);
// A destroyed spawn or room must remove stale ledger entries.
game.spawns={};game.time++;
observe(game,restored,logger);
assert.equal(Object.keys(restored.bot.spawnJobStallWatch.bySpawn).length,0);
assert.equal(summary('E8N1',restored).status,'UNOBSERVED');
// Unowned spawns are excluded even when an old world record exists.
spawn.my=false;
game.spawns={alien:spawn};game.time++;
observe(game,restored,logger);
assert.equal(summary('E8N1',restored).status,'UNOBSERVED');
// Over-budget inputs cannot mutate memory or call game actions.
const prior=JSON.stringify(restored.bot.spawnJobStallWatch);
game.spawns={};
for(let n=0;n<MAX_SPAWNS+1;n++)
 game.spawns['spawn'+n]=spawn;
game.time++;
assert.equal(observe(game,restored,logger).reason,'SPAWN_BUDGET_EXCEEDED');
assert.equal(JSON.stringify(restored.bot.spawnJobStallWatch),prior);
assert.equal(observe({time:NaN,spawns:{}},restored,logger).reason,
 'INVALID_GAME_CONTEXT');
assert.equal(logs.length,1);

// Actual wiring must never bypass normal defender priority or change
// spawn.manager's single authoritative spawnCreep path.
const main=fs.readFileSync(new URL('../game/main.js',import.meta.url),'utf8');
const manager=fs.readFileSync(new URL('../game/spawn.manager.js',import.meta.url),'utf8');
assert.match(main,/require\('spawn\.job\.stall\.shadow'\)/);
assert.match(main,/spawnJobStallShadow\.observe\(Game, Memory, logger\)/);
assert.match(main,/spawnJobStall:\s*spawnJobStallShadow\.summary\(state\.room\.name, Memory\)/);
assert.match(manager,/const spawn = selectIdleSpawn\(state\);/,
 'O66 still uses exactly one eligible idle in-room spawn');
assert.match(manager,/if \(!spawn\) return false/,
 'if all owned spawns are busy, no spawn request is issued');
assert.match(manager,/spawn\.spawning \|\|/,
 'busy jobs remain ineligible without forced cancellation');
assert.match(manager,/if \(countRole\(state\.room, 'defender'\) < want\.defender\)/);
for(const forbidden of [
 /(?:spawn|spawning)\.cancel\s*\(/,
 /\.spawnCreep\s*\(/,
 /\.createConstructionSite\s*\(/,
 /\.renewCreep\s*\(/,
 /delete\s+Memory\.creeps/,
 /\.setActive\s*\(/,
 /\brequire\s*\(/
]) assert.doesNotMatch(src,forbidden);
console.log('O65 passive real-tick spawn stall observer, bounded state and privacy, manual alert without gameplay intents: PASS');
