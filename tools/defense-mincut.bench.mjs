// Paired D0.6 vs current P3 benchmarks. Run in a full Git checkout.
// Timing is Node wall-clock, NOT Screeps in-game CPU evidence.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = '15f0de955167ea052b2ff65a74f04207fedc7ce0';
process.env.NODE_PATH = path.join(root, 'game');
const { default: Module } = await import('node:module');
Module._initPaths();
global.TERRAIN_MASK_WALL = 1;
global.TERRAIN_MASK_SWAMP = 2;

let baselineCode;
try {
  baselineCode = execFileSync('git', ['show', BASELINE + ':game/defense.mincut.shadow.js'], {
    cwd: root, encoding: 'utf8', maxBuffer: 1024 * 1024
  });
} catch (error) {
  throw new Error('P3 baseline git history unavailable. Use a full Git clone/fetch: ' + error.message);
}
const tmp = mkdtempSync(path.join(os.tmpdir(), 'p3-benchmark-'));
let baseline;
try {
  const file = path.join(tmp, 'defense-mincut-d0.6.cjs');
  writeFileSync(file, baselineCode);
  baseline = require(file);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
const current = require('../game/defense.mincut.shadow.js');

function fixture(name) {
  const masked = (x, y) => {
    if (name === 'corridor') return x >= 23 && x <= 27 ? 0 : 1;
    if (name === 'swamp') return (x + 2 * y) % 7 === 0 ? 2 : 0;
    if (name === 'walls') {
      if ([15, 25, 35].includes(x) && [15, 25, 35].includes(y)) return 0;
      return x % 6 === 0 && y % 4 !== 0 ? 1 : ((x + y) % 11 === 0 ? 2 : 0);
    }
    return 0;
  };
  const terrain = { get: masked };
  const room = {
    name: 'E8N1',
    controller: { my: true, pos: { x: 25, y: 10 } },
    getTerrain: () => terrain
  };
  const assets = name === 'corridor'
    ? [{ type: 'spawn', x: 25, y: 24 }, { type: 'tower', x: 25, y: 27 }]
    : [{ type: 'spawn', x: 15, y: 15 }, { type: 'tower', x: 25, y: 25 }, { type: 'storage', x: 35, y: 35 }];
  const state = {
    room,
    spawn: { pos: { x: assets[0].x, y: assets[0].y } },
    sources: [{ pos: { x: 10, y: 10 } }],
    structures: [{ structureType: 'rampart', pos: { x: 18, y: 19 } }]
  };
  const plan = {
    authority: 'SHADOW', status: 'READY', planTick: 1000,
    selected: {
      plannedStructures: assets,
      feasibility: { blocked: [] },
      routes: { routes: [{
        path: Array.from({ length: 22 }, (_, i) => ({ x: 14 + i, y: 14 + i }))
      }] }
    }
  };
  return { name, state, plan, game: { time: 1001 }, options: { margin: 4, maxGridTiles: 900, maxAugmentations: 10000 } };
}
function run(impl, fixture) {
  return impl.evaluate(fixture.state, fixture.plan, {}, fixture.game, fixture.options);
}
function identity(result) {
  // Exclude measurements that are environment-dependent, not gameplay output.
  const { phaseEvidence, ...stable } = result;
  return JSON.parse(JSON.stringify(stable));
}
function measure(impl, scene, repeats) {
  const before = process.hrtime.bigint();
  for (let i = 0; i < repeats; i++) run(impl, scene);
  return Number(process.hrtime.bigint() - before) / 1e6 / repeats;
}
function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}
const results = [];
for (const name of ['open', 'swamp', 'walls', 'corridor']) {
  const scene = fixture(name);
  const expected = identity(run(baseline, scene));
  const actual = identity(run(current, scene));
  assert.deepEqual(actual, expected, name + ': cut, breach, scoring and SHADOW output must match D0.6');
  for (let i = 0; i < 12; i++) { run(baseline, scene); run(current, scene); }
  const baseSamples = [], newSamples = [];
  for (let i = 0; i < 7; i++) {
    // Alternate order to reduce systematic drift from JIT/GC.
    if (i % 2 === 0) {
      baseSamples.push(measure(baseline, scene, 10));
      newSamples.push(measure(current, scene, 10));
    } else {
      newSamples.push(measure(current, scene, 10));
      baseSamples.push(measure(baseline, scene, 10));
    }
  }
  const baselineMedianMs = median(baseSamples);
  const candidateMedianMs = median(newSamples);
  results.push({
    fixture: name, walkableTiles: actual.graph?.walkableTiles,
    status: actual.status, edgeCount: actual.graph?.edgeCount,
    baselineMedianMs: +baselineMedianMs.toFixed(3),
    candidateMedianMs: +candidateMedianMs.toFixed(3),
    speedup: +(baselineMedianMs / candidateMedianMs).toFixed(2),
    samplesEach: baseSamples.length, iterationsPerSample: 10,
    identicalResult: true
  });
}
console.log('P3 paired Node benchmark (NOT Screeps CPU):');
console.log(JSON.stringify({ node: process.version, baselineCommit: BASELINE, results }, null, 2));
if (results.some(r => r.speedup <= 1)) {
  console.warn('Some cases did not improve in noisy Node timings; assess live CPU and repeated runs.');
}
