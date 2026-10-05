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
let cpuValues = [0, 1, 1, 3];
let cpuIndex = 0;
global.Game = {
  time: 25,
  creeps: {
    h: { spawning: true, memory: { role: 'harvester' } },
    l: { spawning: true, memory: { role: 'hauler' } }
  },
  cpu: {
    bucket: 10000,
    getUsed() {
      const value = cpuValues[Math.min(cpuIndex, cpuValues.length - 1)];
      cpuIndex += 1;
      return value;
    }
  }
};

const creepManager = require('../game/creep.manager.js');

const result = creepManager.runAll();

assert.equal(result.harvester, 1);
assert.equal(result.hauler, 2);
assert.equal(Memory.bot.cpu.details['creep.harvester'].last, 1);
assert.equal(Memory.bot.cpu.details['creep.harvester'].lastTick, 25);
assert.equal(Memory.bot.cpu.details['creep.hauler'].last, 2);
assert.equal(Memory.bot.cpu.details['creep.hauler'].lastTick, 25);

console.log('creep manager tests passed');
