import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);
const transit = require('../game/defense.transit.evidence.js');
const d2 = require('../game/defense.reinforcement.shadow.js');

globalThis.FIND_HOSTILE_CREEPS = 501;
globalThis.FIND_HOSTILE_STRUCTURES = 502;
const A = 'E0N0', B = 'E1N0', C = 'E2N0';
function room(name, hostile = false) {
  return { name, find(kind) {
    assert.ok(kind === 501 || kind === 502);
    return hostile && kind === 501 ? [{ id: 'observed-threat' }] : [];
  } };
}
function defender(id, roomName, x, y = 20) {
  return {
    id, my: true, name: id, spawning: false, ticksToLive: 500,
    memory: { role: 'defender', home: A },
    pos: { x, y, roomName },
    body: [{ type:'move', hits:100 }, { type:'attack', hits:100 }]
  };
}
const memory = {};
let game = { time:0, creeps:{}, rooms:{ [A]:room(A), [B]:room(B,true), [C]:room(C) } };
function observeAt(tick, creep) {
  game.time = tick;
  game.creeps = creep ? { [creep.id]: creep } : {};
  return transit.observe(game,memory);
}
function cross(id, start) {
  const positions = [];
  for(let x=44;x<=49;x++)positions.push([A,x]);
  for(let x=0;x<=5;x++)positions.push([B,x]);
  let last;
  for(let i=0;i<positions.length;i++){
    const [roomName,x]=positions[i];
    last=observeAt(start+i,defender(id,roomName,x));
  }
  return last;
}
assert.deepEqual(transit.snapshot(game,{}).routes,{});
let first = cross('defender-1',10);
assert.equal(first.summary.candidateRoutes,1);
assert.equal(first.summary.verifiedRoutes,0,
  'One observed crossing is insufficient for verified ETA');
assert.deepEqual(first.routes,{});
let second = cross('defender-2',30);
assert.equal(second.summary.candidateRoutes,1);
assert.equal(second.summary.verifiedRoutes,1);
const evidence = second.routes[A + '>' + B];
assert.deepEqual(evidence,{
  from:A,to:B,travelTicks:11,observedTick:41,status:'VERIFIED',
  risk:'CLEAR',source:'TRACKED_DEFENDER_TRANSIT'
});
assert.deepEqual(d2._test.routeFor(A,B,second.routes,41), {
  travelTicks:11,observedTick:41,source:'TRACKED_DEFENDER_TRANSIT'
});
assert.equal(d2._test.routeFor(A,B,second.routes,142),null,
  'D2 must reject stale observed ETA');
assert.equal(transit.snapshot({...game,time:142},memory).summary.verifiedRoutes,0);
assert.equal(transit.snapshot({...game,time:41},memory).summary.verifiedRoutes,1,
  'Snapshot must be read-only and deterministic');
const saved=JSON.stringify(memory);
assert.equal(transit.snapshot({...game,time:41},memory).summary.verifiedRoutes,1);
assert.equal(JSON.stringify(memory),saved,'Snapshot must not mutate persistent state');

// Unknown-room travel or a skipped tick must never create invented routes.
const gapMemory={};
for(let i=0;i<6;i++){
  const x=44+i;
  const testGame={time:200+i,creeps:{a:defender('a',A,x)},
    rooms:{[A]:room(A),[B]:room(B)}};
  transit.observe(testGame,gapMemory);
}
transit.observe({time:207,creeps:{a:defender('a',B,0)},
  rooms:{[A]:room(A),[B]:room(B)}},gapMemory);
for(let i=1;i<=5;i++)transit.observe({
  time:207+i,creeps:{a:defender('a',B,i)},
  rooms:{[A]:room(A),[B]:room(B)}},gapMemory);
assert.deepEqual(transit.snapshot({time:212},gapMemory).routes,{});
assert.equal(transit.snapshot({time:212},gapMemory).summary.candidateRoutes,0);

// A portal-like jump from a room edge is not a verifiable room exit.
const portalMemory={};
transit.observe({time:300,creeps:{a:defender('a',A,44)},rooms:{[A]:room(A)}},portalMemory);
for(let x=45;x<=49;x++)transit.observe({time:300+x-44,
  creeps:{a:defender('a',A,x)},rooms:{[A]:room(A)}},portalMemory);
transit.observe({time:306,creeps:{a:defender('a','E9N9',0)},
  rooms:{[A]:room(A),'E9N9':room('E9N9')}},portalMemory);
assert.equal(transit.snapshot({time:306},portalMemory).summary.candidateRoutes,0);

// Three-room transit with a hostile intermediate room fails closed,
// even when the final destination is clear.
const riskyMemory={}, riskyRooms={ [A]:room(A),[B]:room(B,true),[C]:room(C) };
const pathPositions=[];
for(let x=44;x<=49;x++)pathPositions.push([A,x]);
for(let x=0;x<=49;x++)pathPositions.push([B,x]);
for(let x=0;x<=5;x++)pathPositions.push([C,x]);
for(let i=0;i<pathPositions.length;i++){
  const [roomName,x]=pathPositions[i];
  transit.observe({time:400+i,creeps:{z:defender('z',roomName,x)},
    rooms:riskyRooms},riskyMemory);
}
assert.equal(transit.snapshot({time:461},riskyMemory).summary.candidateRoutes,0,
  'Observed hostile intermediate must not become CLEAR route evidence');

// Unknown hostile-structure API also fails closed.
const x=globalThis.FIND_HOSTILE_STRUCTURES;
delete globalThis.FIND_HOSTILE_STRUCTURES;
assert.equal(transit._test.roomSafe(A,game),false);
globalThis.FIND_HOSTILE_STRUCTURES=x;

// Per-room telemetry must be bounded and lifecycle-managed.
const state=memory.bot.regionalTransitShadow;
assert.equal(state.schemaVersion,1);
assert.ok(Object.keys(state.tracks).length<=transit.MAX_TRACKS);
assert.ok(Object.keys(state.routes).length<=transit.MAX_ROUTES);
const pruned=transit.observe({time:300,creeps:{},rooms:{}},memory);
assert.equal(pruned.summary.verifiedRoutes,0);
assert.equal(pruned.summary.candidateRoutes,0);
assert.equal(Object.keys(memory.bot.regionalTransitShadow.routes).length,0);

// Schema mismatch is invalidated without touching unrelated memory.
const migrate={bot:{regionalTransitShadow:{schemaVersion:999},
  requestRegistry:{marker:'untouched'}}};
const reset=transit.observe({time:0,creeps:{},rooms:{}},migrate);
assert.equal(reset.summary.verifiedRoutes,0);
assert.equal(migrate.bot.regionalTransitShadow.schemaVersion,1);
assert.deepEqual(migrate.bot.requestRegistry,{marker:'untouched'});

const code=fs.readFileSync(path.join(here,'../game/defense.transit.evidence.js'),'utf8');
for(const forbidden of [
  /\.moveTo\s*\(/, /\.spawnCreep\s*\(/, /\.attack\s*\(/,
  /\.heal\s*\(/, /\.activateSafeMode\s*\(/, /\.transfer\s*\(/,
  /\.reserve\s*\(/, /Memory\.creeps\s*=/, /require\(['"]role\.defender/
]) assert.equal(forbidden.test(code),false,
  'Passive transit observation must never issue gameplay intents');
const main=fs.readFileSync(path.join(here,'../game/main.js'),'utf8');
assert.ok(main.includes("const defenseTransitEvidence = require('defense.transit.evidence');"));
assert.ok(main.includes('defenseTransitEvidence.observe(Game, Memory)'));
assert.ok(main.includes('defenseTransitEvidence.snapshot(Game, Memory)'));
assert.ok(main.includes('regionalDefenseShadow.evaluate(roomStates, transitEvidence.routes, Game)'));
console.log('U7/D2: observed multi-sample ETA, corridor risk, freshness, GC, no intents PASS');
