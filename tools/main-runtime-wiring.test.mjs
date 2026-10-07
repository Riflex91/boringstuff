import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mainSource = fs.readFileSync(path.resolve(here, '../game/main.js'), 'utf8');

assert.match(
  mainSource,
  /const\s+colonyState\s*=\s*require\(['"]colony\.state['"]\);/,
  'main.js must import colony.state before STATUS_SNAPSHOT uses colonyState.telemetrySummary()'
);
assert.match(
  mainSource,
  /colonyState\.telemetrySummary\(state\.colonyState\)/,
  'STATUS_SNAPSHOT must use the compact colonyState telemetry summary'
);


assert.match(
  mainSource,
  /const\s+plannerVNextShadow\s*=\s*require\(['"]planner\.vnext\.shadow['"]\);/,
  'main.js must import planner.vnext.shadow for P2 SHADOW'
);
assert.match(
  mainSource,
  /id:\s*['"]planner-vnext-shadow['"][\s\S]*?priorityClass:\s*processScheduler\.PRIORITY\.OVERFLOW/,
  'P2 planner must run only on the OVERFLOW scheduler budget'
);
assert.match(
  mainSource,
  /plannerVNext:\s*plannerVNextShadow\.telemetrySummary\(state\.plannerVNextShadow\)/,
  'STATUS_SNAPSHOT must expose compact P2 SHADOW telemetry'
);


assert.match(
  mainSource,
  /const\s+defenseMinCutShadow\s*=\s*require\(['"]defense\.mincut\.shadow['"]\);/,
  'main.js must import defense.mincut.shadow for P3 SHADOW'
);
assert.match(
  mainSource,
  /id:\s*['"]defense-mincut-shadow['"][\s\S]*?priorityClass:\s*processScheduler\.PRIORITY\.OVERFLOW/,
  'P3 min-cut must run only on the OVERFLOW scheduler budget'
);
assert.match(
  mainSource,
  /state\.plannerVNextShadow\.planTick\s*<\s*Game\.time/,
  'P3 must not run in the same tick as a freshly computed P2 plan'
);
assert.match(
  mainSource,
  /defenseMinCut:\s*defenseMinCutShadow\.telemetrySummary\(state\.defenseMinCutShadow\)/,
  'STATUS_SNAPSHOT must expose compact P3 SHADOW telemetry'
);


assert.match(
  mainSource,
  /const\s+remoteRoiShadow\s*=\s*require\(['"]remote\.roi\.shadow['"]\);/,
  'main.js must import remote.roi.shadow for I2 SHADOW'
);
assert.match(
  mainSource,
  /id:\s*['"]remote-roi-shadow['"][\s\S]*?priorityClass:\s*processScheduler\.PRIORITY\.OVERFLOW/,
  'I2 remote ROI must run only on the OVERFLOW scheduler budget'
);
assert.match(
  mainSource,
  /const\s+i2CanRun\s*=\s*!plannerVNextRun\.ran\s*&&\s*!defenseMinCutRun\.ran/,
  'I2 must not stack on the same tick as an actual P2 or P3 run'
);
assert.match(
  mainSource,
  /remoteRoi:\s*remoteRoiShadow\.telemetrySummary\(state\.remoteRoiShadow\)/,
  'STATUS_SNAPSHOT must expose compact I2 SHADOW telemetry'
);


assert.match(
  mainSource,
  /memoryFootprint:\s*memoryFootprintSnapshot\(\)/,
  'STATUS_SNAPSHOT must expose compact persistent-memory footprint telemetry'
);
assert.match(
  mainSource,
  /RawMemory\.get\(\)/,
  'memory-footprint telemetry must measure the serialized RawMemory payload'
);
assert.match(
  mainSource,
  /journalApproxBytes:/,
  'memory-footprint telemetry must expose the journal byte estimate without sorting the journal'
);

console.log('main runtime wiring tests passed');
