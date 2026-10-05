import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);

global.Memory = {};
global.Game = {
  time: 25,
  cpu: {
    bucket: 10000,
    getUsed() { return 0; }
  }
};

const profiler = require('../game/profiler.js');

function cpuSequence(values) {
  let index = 0;
  Game.cpu.getUsed = () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}

{
  cpuSequence([1, 5, 8]);
  profiler.section('rooms', () => {});
  profiler.finishTick();

  const section = Memory.bot.cpu.sections.rooms;
  assert.equal(section.last, 4);
  assert.equal(section.lastTick, 25);

  const sample = Memory.bot.cpu.history.at(-1);
  assert.equal(sample.tick, 25);
  assert.equal(sample.used, 8);
  assert.equal(sample.bucket, 10000);
  assert.equal(sample.sections.rooms, 4);
  assert.equal(sample.attributed, 4);
  assert.equal(sample.unattributed, 4);
}

{
  // A section that did not run on this exact sample tick must not reuse stale
  // lastCpu data from a previous tick.
  Game.time = 50;
  cpuSequence([3]);
  profiler.finishTick();

  const sample = Memory.bot.cpu.history.at(-1);
  assert.equal(sample.tick, 50);
  assert.equal(sample.sections.rooms, 0);
  assert.equal(sample.attributed, 0);
  assert.equal(sample.unattributed, 3);
}

{
  Game.time = 75;
  cpuSequence([0.25, 1.25, 1.5, 2, 4]);
  profiler.section('rooms', () => {});
  profiler.section('creeps', () => {});
  profiler.finishTick();

  const sample = Memory.bot.cpu.history.at(-1);
  assert.equal(sample.sections.rooms, 1);
  assert.equal(sample.sections.creeps, 0.5);
  assert.equal(sample.attributed, 1.5);
  assert.equal(sample.unattributed, 2.5);
}

{
  // Nested/detail measurements are diagnostic only. They must be sampled on
  // the exact tick but must not be added to top-level attribution.
  Game.time = 100;
  cpuSequence([1, 3, 7]);
  profiler.detailSection('room.state', () => {});
  profiler.finishTick();

  const sample = Memory.bot.cpu.history.at(-1);
  assert.equal(sample.details['room.state'], 2);
  assert.equal(sample.sections.rooms, 0);
  assert.equal(sample.attributed, 0);
  assert.equal(sample.unattributed, 7);
}

{
  // Detail samples are subject to the same stale-tick protection.
  Game.time = 125;
  cpuSequence([5]);
  profiler.finishTick();

  const sample = Memory.bot.cpu.history.at(-1);
  assert.equal(sample.details['room.state'], 0);
  assert.equal(sample.attributed, 0);
  assert.equal(sample.unattributed, 5);
}

{
  // Detail instrumentation must not swallow errors; the enclosing top-level
  // section remains the error boundary.
  Game.time = 126;
  cpuSequence([0, 1]);
  assert.throws(() => profiler.detailSection('room.fail', () => {
    throw new Error('boom');
  }), /boom/);
  assert.equal(Memory.bot.cpu.details['room.fail'].last, 1);
  assert.equal(Memory.bot.cpu.details['room.fail'].lastTick, 126);
}

{
  Game.time = 125;
  const current = profiler.currentHistorySample();
  assert.ok(current);
  assert.equal(current.tick, 125);
  assert.equal(current.unattributed, 5);

  Game.time = 126;
  assert.equal(profiler.currentHistorySample(), null);
}

console.log('profiler tests passed');
