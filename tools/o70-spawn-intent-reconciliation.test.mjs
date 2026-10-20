import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import Module from 'node:module';

const here=path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH=path.resolve(here,'../game');
Module._initPaths();
const require=createRequire(import.meta.url);
const reconcile=require('../game/spawn.parallel.reconcile.js');

const room='E8N1';
function fixture(tick=100) {
 const r={name:room,controller:{my:true}};
 const spawn={name:'Spawn1',id:'s1',my:true,room:r,
   spawning:null};
 const game={time:tick,spawns:{Spawn1:spawn},creeps:{}};
 const memory={bot:{},creeps:{}};
 function write(creepName,status='SUBMITTED',s='Spawn1',id='s1'){
  return reconcile.receipt(memory,game,room,{
    spawnName:s,spawnId:id,creepName,role:'harvester',status
  });
 }
 return {spawn,game,memory,write};
}
{
 const f=fixture();
 assert.equal(f.write('har-E8N1-100-0'),true);
 assert.equal(f.write('har-E8N1-100-0'),false,'cannot duplicate a submitted intent');
 assert.equal(f.write('har-E8N1-100-0','ACCEPTED'),true);
 assert.equal(reconcile.observe(f.game,f.memory).reconciledRooms,0,
   'same tick is not a next-tick witness');
 assert.equal(reconcile.summary(room,f.memory).status,'UNOBSERVED');
 // Simulate global reset / serialization. The observer must rely on the
 // stored primitive receipt, not the old module's object references.
 const persistent=JSON.parse(JSON.stringify(f.memory));
 const game={time:101,spawns:{
  Spawn1:{...f.spawn,spawning:{name:'har-E8N1-100-0'}}
 },creeps:{}};
 assert.equal(reconcile.observe(game,persistent).status,'OBSERVED');
 const s=reconcile.summary(room,persistent);
 assert.equal(s.status,'VERIFIED');
 assert.equal(s.predecessorTick,100);
 assert.equal(s.observedJobs,1);
 assert.equal(s.observedCreeps,0);
 assert.equal(s.actionAuthority,'NONE');
 assert.equal(JSON.stringify(s).includes('har-E8N1'),false);
 assert.equal(JSON.stringify(s).includes('Spawn1'),false);
 assert.equal(Object.keys(persistent.bot.spawnParallelReconcile.rooms).length,0,
   'processed private receipts are retired atomically');
}
{
 const f=fixture();
 assert.equal(f.write('har-E8N1-100-0'),true);
 assert.equal(f.write('har-E8N1-100-0','ACCEPTED'),true);
 f.memory.creeps['har-E8N1-100-0']={role:'harvester',home:room};
 f.game.time=101;
 // Memory.creeps alone MUST NOT satisfy the in-game evidence standard.
 assert.equal(reconcile.observe(f.game,f.memory).status,'OBSERVED');
 const s=reconcile.summary(room,f.memory);
 assert.equal(s.status,'UNVERIFIED');
 assert.equal(s.notObserved,1);
 assert.equal(s.observedJobs,0);
}
{
 const f=fixture();
 assert.equal(f.write('har-E8N1-100-0'),true);
 assert.equal(f.write('har-E8N1-100-0','UNCERTAIN'),true);
 assert.equal(f.write('har-E8N1-100-0','ACCEPTED'),false);
 assert.equal(f.write('har-E8N1-100-1','SUBMITTED','Spawn2','s2'),true);
 assert.equal(f.write('har-E8N1-100-1','REJECTED','Spawn2','s2'),true);
 f.game.time=101;
 const s1=reconcile.observe(f.game,f.memory);
 const s2=reconcile.summary(room,f.memory);
 assert.equal(s1.status,'OBSERVED');
 assert.equal(s2.unknown,1);
 assert.equal(s2.rejected,1);
 assert.equal(s2.status,'UNVERIFIED',
   'ambiguous return is not promoted to successful spawn');
}
{
 const f=fixture();
 f.write('har-E8N1-100-0');
 f.write('har-E8N1-100-0','ACCEPTED');
 f.game.time=103;
 assert.equal(reconcile.observe(f.game,f.memory).status,'OBSERVED');
 assert.equal(reconcile.summary(room,f.memory).status,'GAP_UNKNOWN',
   'missing game ticks are explicitly inconclusive');
}
{
 const f=fixture();
 f.write('har-E8N1-100-0');
 f.write('har-E8N1-100-0','ACCEPTED');
 f.game.time++;
 f.game.creeps['har-E8N1-100-0']={
  my:true,memory:{role:'harvester',home:room}
 };
 const observed=reconcile.observe(f.game,f.memory);
 assert.equal(observed.status,'OBSERVED');
 assert.equal(reconcile.summary(room,f.memory).observedCreeps,1);
}
{
 const f=fixture();
 assert.equal(f.write('har-E8N1-100-0'),true);
 assert.equal(f.write('har-E8N1-100-1','SUBMITTED','Spawn2','s2'),true);
 assert.equal(f.write('har-E8N1-100-2','SUBMITTED','Spawn3','s3'),true);
 assert.equal(f.write('har-E8N1-100-3','SUBMITTED','Spawn4','s4'),false,
   'never retain an unbounded room queue');
 f.game.time++;
 assert.equal(f.write('har-E8N1-101-0'),false,
   'unobserved previous receipts cannot be silently overwritten');
 assert.equal(reconcile.observe(f.game,f.memory).status,'OBSERVED');
 assert.equal(f.write('har-E8N1-101-0'),true);
}
{
 const f=fixture();
 f.memory.bot.spawnParallelReconcile={modelVersion:1,rooms:{E8N1:{
  tick:100,intents:'corrupt'
 }},last:{}};
 const before=JSON.stringify(f.memory);
 f.game.time=101;
 assert.equal(reconcile.observe(f.game,f.memory).status,'HOLD');
 assert.equal(JSON.stringify(f.memory),before,
   'corrupt ledger must not be erased as if verified');
}
{
 const f=fixture();
 for(let i=0;i<16;i++) {
  const name='E'+i+'N1';
  const ok=reconcile.receipt(f.memory,f.game,name,{
   spawnName:'S'+i,spawnId:'id'+i,
   creepName:'c'+i,role:'worker',status:'SUBMITTED'
  });
  assert.equal(ok,true);
 }
 assert.equal(reconcile.receipt(f.memory,f.game,'E20N1',{
  spawnName:'S20',spawnId:'id20',creepName:'c20',
  role:'worker',status:'SUBMITTED'
 }),false,'global room receipt count must be bounded');
}
{
 // No prototype pollution, private names or forged telemetry leaks.
 const f=fixture();
 assert.equal(reconcile.receipt(f.memory,f.game,'__proto__',{
   spawnName:'x',spawnId:'y',creepName:'z',role:'worker',status:'SUBMITTED'
 }),false);
 assert.equal(Object.getPrototypeOf(f.memory.bot),Object.prototype);
 f.write('har-E8N1-100-0');
 f.write('har-E8N1-100-0','ACCEPTED');
 f.game.time++;
 reconcile.observe(f.game,f.memory);
 f.memory.bot.spawnParallelReconcile.last[room].creepName='PRIVATE_CREEP';
 f.memory.bot.spawnParallelReconcile.last[room].spawnName='PRIVATE_SPAWN';
 const safe=JSON.stringify(reconcile.summary(room,f.memory));
 assert.equal(safe.includes('PRIVATE_'),false,
   'telemetry must whitelist only aggregate fields');
}
{
 // Evaluate the actual production cleanup implementation, without
 // executing the main loop or any game API action.
 const source=fs.readFileSync(new URL('../game/main.js',import.meta.url),'utf8');
 const fn=source.match(/function cleanupMemory\(\) \{[\s\S]*?\n\}/)?.[0];
 assert.ok(fn,'cleanup is present in main runtime');
 const game={spawns:{
   Spawn1:{my:true,spawning:{name:'pending-creep'}},
   EnemySpawn:{my:false,spawning:{name:'hostile-fake'}}
  },creeps:{'existing-creep':{}} ,time:100};
 const memory={creeps:{
   'pending-creep':{role:'hauler',home:room},
   'existing-creep':{role:'worker'},
   'orphan-creep':{role:'upgrader'},
   'hostile-fake':{role:'harvester'}
 }};
 const before=memory.creeps['pending-creep'];
 new Function('Game','Memory',fn+';cleanupMemory();')(game,memory);
 assert.equal(memory.creeps['pending-creep'],before,
  'active owned spawning Creep must retain its role/home memory');
 assert.ok(memory.creeps['existing-creep']);
 assert.equal(memory.creeps['orphan-creep'],undefined);
 assert.equal(memory.creeps['hostile-fake'],undefined);
 assert.match(source,/spawnParallelReconcile\.observe\(Game, Memory\)/);
 assert.ok(source.indexOf('spawnParallelReconcile.observe(Game, Memory)') <
   source.indexOf("measureMainDetail('main.cleanup'"),
   'actual receipt inspection must run before memory cleanup');
}
const code=fs.readFileSync(new URL('../game/spawn.parallel.reconcile.js',import.meta.url),'utf8');
for(const forbidden of [/\.spawnCreep\s*\(/,/\.cancel\s*\(/,
  /\.renewCreep\s*\(/,/\.createConstructionSite\s*\(/,
  /\.suicide\s*\(/]) assert.doesNotMatch(code,forbidden,
    'reconciler may not issue gameplay actions');
console.log('O70 private bounded spawn receipts, real next-tick verification, gaps/unknown and in-progress memory retention PASS');
