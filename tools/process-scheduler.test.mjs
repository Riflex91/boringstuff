import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);
const scheduler = require('../game/process.scheduler.js');

const thresholds = { critical: 1000, low: 3000, healthy: 7000 };

function context(tick, bucket, cpuValues) {
  let index = 0;
  const values = cpuValues || [0, 0];
  return {
    tick,
    bucket,
    thresholds,
    game: {
      time: tick,
      cpu: {
        bucket,
        getUsed() {
          const value = values[Math.min(index, values.length - 1)];
          index += 1;
          return value;
        }
      }
    }
  };
}

{
  const memory = {};
  let calls = 0;
  const result = scheduler.run({
    id: 'survival',
    priorityClass: scheduler.PRIORITY.CRITICAL,
    minimumInterval: 999
  }, () => { calls++; }, context(10, 0), memory);
  assert.equal(result.ran, true);
  assert.equal(result.reason, 'CRITICAL');
  assert.equal(calls, 1);
}

{
  const memory = {};
  let calls = 0;
  const result = scheduler.run({
    id: 'background',
    priorityClass: scheduler.PRIORITY.BACKGROUND
  }, () => { calls++; }, context(10, 2999), memory);
  assert.equal(result.ran, false);
  assert.equal(result.reason, 'BUCKET_BELOW_FLOOR');
  assert.equal(calls, 0);
}

{
  const memory = {};
  let calls = 0;
  const result = scheduler.run({
    id: 'deadline',
    priorityClass: scheduler.PRIORITY.DEADLINE,
    deadlineTick: 50
  }, () => { calls++; }, context(50, 0), memory);
  assert.equal(result.ran, true);
  assert.equal(result.reason, 'DEADLINE_OVERDUE');
  assert.equal(calls, 1);
}

{
  const memory = {};
  let calls = 0;
  const descriptor = {
    id: 'planner',
    priorityClass: scheduler.PRIORITY.BACKGROUND,
    minimumInterval: 5
  };
  assert.equal(scheduler.run(descriptor, () => { calls++; }, context(1, 8000), memory).ran, true);
  assert.equal(scheduler.run(descriptor, () => { calls++; }, context(2, 8000), memory).reason, 'MINIMUM_INTERVAL');
  assert.equal(scheduler.run(descriptor, () => { calls++; }, context(5, 8000), memory).reason, 'MINIMUM_INTERVAL');
  assert.equal(scheduler.run(descriptor, () => { calls++; }, context(6, 8000), memory).ran, true);
  assert.equal(calls, 2);
}

{
  const memory = {};
  let calls = 0;
  const descriptor = {
    id: 'fresh-background',
    priorityClass: scheduler.PRIORITY.BACKGROUND,
    freshnessRequirement: 10
  };
  assert.equal(scheduler.run(descriptor, () => { calls++; }, context(1, 8000), memory).ran, true);
  const deferred = scheduler.run(descriptor, () => { calls++; }, context(5, 2000), memory);
  assert.equal(deferred.ran, false);
  assert.equal(deferred.reason, 'BUCKET_BELOW_FLOOR');
  const forced = scheduler.run(descriptor, () => { calls++; }, context(11, 2000), memory);
  assert.equal(forced.ran, true);
  assert.equal(forced.reason, 'FRESHNESS_DUE');
  assert.equal(calls, 2);
}

{
  const memory = {};
  const descriptor = { id: 'measured', priorityClass: scheduler.PRIORITY.STANDARD };
  const result = scheduler.run(descriptor, () => 42, context(100, 5000, [1.25, 1.75]), memory);
  assert.equal(result.ran, true);
  assert.equal(result.result, 42);
  assert.equal(result.cpuUsed, 0.5);
  const snap = scheduler.snapshot(memory);
  assert.equal(snap.schemaVersion, 1);
  assert.equal(snap.processes.measured.lastRunTick, 100);
  assert.equal(snap.processes.measured.lastCpu, 0.5);
  assert.equal(snap.processes.measured.cpuEMA, 0.5);
  assert.equal(snap.processes.measured.runCount, 1);
  assert.equal(snap.processes.measured.skippedCount, 0);
}

{
  const memory = {};
  const standard = { id: 'legacy-stats', priorityClass: scheduler.PRIORITY.STANDARD };
  const background = { id: 'legacy-visuals', priorityClass: scheduler.PRIORITY.BACKGROUND };
  assert.equal(scheduler.run(standard, () => {}, context(1, 999), memory).ran, false);
  assert.equal(scheduler.run(standard, () => {}, context(2, 1000), memory).ran, true);
  assert.equal(scheduler.run(background, () => {}, context(3, 2999), memory).ran, false);
  assert.equal(scheduler.run(background, () => {}, context(4, 3000), memory).ran, true);
}

console.log('process scheduler tests passed');