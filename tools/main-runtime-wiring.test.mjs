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

assert.match(mainSource,
  /const\s+expansionReadinessShadow\s*=\s*require\(['"]expansion\.readiness\.shadow['"]\)/,
  'main must load the passive expansion readiness observer');
assert.ok(mainSource.includes(
  'const expansionReadiness = expansionReadinessShadow.evaluate(capabilities,roomStates,tickCpu);'),
  'readiness must be evaluated once before bounded frontier screening');
assert.ok(mainSource.includes('    expansionReadiness,'),
  'STATUS_SNAPSHOT must preserve the expansion readiness payload');

const expansionSource=fs.readFileSync(path.resolve(here,'../game/expansion.readiness.shadow.js'),'utf8');
assert.doesNotMatch(expansionSource,/\.claimController\s*\(|\.spawnCreep\s*\(|\.createConstructionSite\s*\(/,
  'expansion readiness is strictly observational, without game actions');

assert.ok(mainSource.includes("require('expansion.candidates.shadow')"),
  'main must import bounded I0 expansion candidate observer');
assert.ok(mainSource.includes('expansionCandidatesShadow.evaluate('),
  'STATUS_SNAPSHOT must derive expansion candidates from readiness and stored intel');
assert.ok(mainSource.includes('    expansionCandidates,'),
  'STATUS_SNAPSHOT must publish the bounded advisory');
const candidateSource=fs.readFileSync(path.resolve(here,
  '../game/expansion.candidates.shadow.js'),'utf8');
for (const forbidden of ['.claimController(', '.spawnCreep(',
  '.createConstructionSite(', '.reserveController(']) {
  assert.equal(candidateSource.includes(forbidden),false,
    'Read-only expansion candidates must never issue gameplay intents');
}

assert.ok(mainSource.includes("require('expansion.operation.shadow')"),
  'I4 main must import the fail-closed preflight');
assert.ok(mainSource.includes('const expansionOperation = expansionOperationShadow.evaluate('),
  'Status snapshots must advance I4 only at the existing 100-tick cadence');
assert.ok(mainSource.includes('    expansionOperation,'),
  'Status snapshots must expose I4 operation state');
const operationSource=fs.readFileSync(path.resolve(here,
  '../game/expansion.operation.shadow.js'),'utf8');
for(const forbidden of ['.claimController(','.reserveController(',
  '.spawnCreep(','.createConstructionSite(']) {
  assert.equal(operationSource.includes(forbidden),false,
    'I4 operation remains entirely observation-only');
}

assert.match(
  fs.readFileSync(path.resolve(here,'../game/expansion.operation.shadow.js'),'utf8'),
  /require\(['"]expansion\.site\.shadow['"]\)/,
  'I4 operation must invoke path/site evidence before advertising tile verification'
);
const siteSource=fs.readFileSync(path.resolve(here,
  '../game/expansion.site.shadow.js'),'utf8');
for (const forbidden of ['.claimController(','.reserveController(',
  '.spawnCreep(','.createConstructionSite(','.createSpawn(']) {
  assert.equal(siteSource.includes(forbidden),false,
    'I4 site/path verification remains read-only');
}

console.log('main runtime wiring tests passed');
