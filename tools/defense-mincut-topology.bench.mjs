// Compare this candidate against EXACT P3.1 (shadow.15) on deterministic
// synthetic topology. Node timings are NOT Screeps CPU or real cold deploys.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const P31_SHA = 'c5ef8c5a1fd2daa49793922771bf5d959c347fb8';
const require = createRequire(import.meta.url);
const source = execFileSync('git', ['show', P31_SHA + ':game/defense.mincut.shadow.js'],
  { cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024 });
const temp = mkdtempSync(path.join(os.tmpdir(), 'p3-topology-parity-'));
let prior;
try {
  const file = path.join(temp, 'mincut-p31.cjs');
  writeFileSync(file, source);
  prior = require(file);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
const candidate = require('../game/defense.mincut.shadow.js');
global.TERRAIN_MASK_WALL = 1;
global.TERRAIN_MASK_SWAMP = 2;
global.FIND_MINERALS = 117;

function fixture(name) {
  const roomName = 'E8N1';
  const pos = (x, y) => ({ x, y, roomName });
  let mineralFinds = 0;
  const terrain = { get(x, y) {
    if (name === 'corridor') return x >= 23 && x <= 27 ? 0 : 1;
    if (name === 'swamp') return (x + 2 * y) % 7 === 0 ? 2 : 0;
    if (name === 'walls') return x % 6 === 0 && y % 4 !== 0 ? 1
      : ((x + y) % 11 === 0 ? 2 : 0);
    return 0;
  } };
  const room = {
    name: roomName, controller: { my: true, pos: pos(25, 10) },
    getTerrain: () => terrain,
    find(type) {
      assert.equal(type, 117);
      mineralFinds++;
      return [{ id: 'mineral-one', pos: pos(20, 11) }];
    }
  };
  const plannedStructures = name === 'corridor'
    ? [{ type: 'spawn', x: 25, y: 24 }, { type: 'tower', x: 25, y: 27 }]
    : [{ type: 'spawn', x: 15, y: 15 }, { type: 'tower', x: 25, y: 25 },
      { type: 'storage', x: 35, y: 35 }];
  const state = {
    room, spawn: { pos: pos(plannedStructures[0].x, plannedStructures[0].y) },
    sources: [{ pos: pos(10, 10) }], structures: []
  };
  const plan = {
    authority: 'SHADOW', status: 'READY', planTick: 1000,
    selected: { plannedStructures, feasibility: { blocked: [] },
      routes: { routes: [{ path: Array.from({ length: 22 }, (_, i) => pos(14 + i, 14 + i)) }] } }
  };
  return {
    name, scene: { state, plan, memory: {}, game: { time: 1001 },
      options: { margin: 4, maxGridTiles: 900, maxAugmentations: 10000 } },
    mineralFindCount: () => mineralFinds, resetFindCount: () => { mineralFinds = 0; }
  };
}

function run(impl, s) {
  return impl.evaluate(s.state, s.plan, {}, s.game, s.options);
}
function identity(value) {
  const { phaseEvidence, ...stable } = value;
  return JSON.parse(JSON.stringify(stable));
}
function elapsed(impl, scene, iterations) {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) run(impl, scene);
  return Number(process.hrtime.bigint() - start) / 1e6 / iterations;
}
function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
function round(value) {
  return +value.toFixed(3);
}

const rows = [];
for (const name of ['open', 'swamp', 'walls', 'corridor']) {
  const input = fixture(name);
  // One pass per variant before any warmup, still NOT a real fresh VM sample.
  input.resetFindCount();
  const priorFirstMs = elapsed(prior, input.scene, 1);
  assert.equal(input.mineralFindCount(), 2, name + ' P3.1 rebuilds natural set twice');
  input.resetFindCount();
  const candidateFirstMs = elapsed(candidate, input.scene, 1);
  assert.equal(input.mineralFindCount(), 1, name + ' candidate shares natural set');
  const original = identity(run(prior, input.scene));
  const optimized = identity(run(candidate, input.scene));
  assert.deepEqual(optimized, original,
    name + ': full cut, graph, ramps, breach, scoring and SHADOW output parity');
  for (let i = 0; i < 12; i++) {
    run(prior, input.scene); run(candidate, input.scene);
  }
  const before = [], after = [];
  for (let i = 0; i < 9; i++) {
    if (i % 2 === 0) {
      before.push(elapsed(prior, input.scene, 20));
      after.push(elapsed(candidate, input.scene, 20));
    } else {
      after.push(elapsed(candidate, input.scene, 20));
      before.push(elapsed(prior, input.scene, 20));
    }
  }
  const a = median(before), b = median(after);
  rows.push({
    fixture: name, walkableTiles: optimized.graph?.walkableTiles,
    edgeCount: optimized.graph?.edgeCount,
    p31FirstCallMs: round(priorFirstMs),
    candidateFirstCallMs: round(candidateFirstMs),
    p31WarmMedianMs: round(a),
    candidateWarmMedianMs: round(b),
    warmSpeedup: +(a / b).toFixed(2),
    warmSamplesEach: 9,
    iterationsPerWarmSample: 20,
    exactOutputParity: true,
    mineralFindCallsP31: 2,
    mineralFindCallsCandidate: 1
  });
}
console.log('P3.1 vs P3.2 topology - synthetic Node timings only (NOT Screeps CPU):');
console.log(JSON.stringify({ node: process.version, baselineCommit: P31_SHA, results: rows }, null, 2));
if (rows.some(r => r.warmSpeedup < 1)) {
  console.warn('Candidate is not faster in all synthetic medians; DO NOT assert live CPU savings.');
}
