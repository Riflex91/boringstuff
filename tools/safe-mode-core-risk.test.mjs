import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../game/room.manager.js', import.meta.url), 'utf8');
const ctx = { module: { exports: {} }, STRUCTURE_SPAWN: 'spawn', STRUCTURE_STORAGE: 'storage',
  require(name) {
    if (name === 'config') return { AUTO_SAFE_MODE: true };
    if (name === 'logger') return { warn() {} };
    return {};
  } };
vm.runInNewContext(source, ctx);
const decide = ctx.module.exports._test.safeModeDecision;
const controller = { my: true, safeModeAvailable: 1, safeMode: 0 };
const spawn = { id: 'spawn', structureType: 'spawn', hits: 600, hitsMax: 1000,
  pos: { x: 10, y: 10 } };
const enemy = (parts, range) => ({ body: parts.map(type => ({ type, hits: 100 })),
  pos: { getRangeTo() { return range; } } });
const state = { room: { controller }, structures: [spawn],
  hostileCreeps: [enemy(['move'], 1)] };
assert.equal(decide(state), null, 'scout must not consume safe mode');
state.hostileCreeps = [enemy(['attack'], 4)];
assert.equal(decide(state), null, 'distant melee threat must not consume safe mode');
state.hostileCreeps = [enemy(['attack'], 1)];
assert.equal(decide(state).reason, 'IMMINENT_CORE_ATTACK');
state.hostileCreeps = [enemy(['ranged_attack'], 3)];
assert.equal(decide(state).reason, 'IMMINENT_CORE_ATTACK');
spawn.hits = 900;
assert.equal(decide(state), null, 'healthy core must not consume safe mode early');
spawn.hits = 300;
assert.equal(decide(state).reason, 'CRITICAL_CORE_DAMAGE');
controller.safeModeAvailable = 0;
assert.equal(decide(state), null, 'no safe mode availability');
console.log('D1 imminent core safe mode tests PASS');
