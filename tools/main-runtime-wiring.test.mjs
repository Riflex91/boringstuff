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
assert.match(mainSource,/safeModeRemainingTicks:\s*controller/,
  'World live status must expose a bounded actual Controller Safe Mode counter');
assert.match(mainSource,/safeModeCooldownRemainingTicks:\s*controller/,
  'World live status must expose actual Controller cooldown, not inferred safety');
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

assert.ok(mainSource.includes("require('expansion.claim.launch.preflight')"),
  'I4 final claim-launch audit must load from active status runtime');
assert.ok(mainSource.includes('expansionClaimLaunchPreflight.audit('),
  'claim launcher audit must use real runtime proof rather than synthetic proposals');
assert.ok(mainSource.includes('    expansionLaunchAudit,'),
  'STATUS_SNAPSHOT must expose audit holds and measured travel constraints');
const claimLaunchAuditSource=fs.readFileSync(path.resolve(here,
  '../game/expansion.claim.launch.preflight.js'),'utf8');
for(const forbidden of ['.claimController(','.spawnCreep(',
  '.moveTo(','.attack(','.createConstructionSite('])
  assert.equal(claimLaunchAuditSource.includes(forbidden),false,
    'launcher AUDIT may not issue a gameplay intent: '+forbidden);

// I4 is live-authorized only as a paired, guarded claim/bootstrap pipeline.
const safeConfig=fs.readFileSync(path.resolve(here,'../game/config.js'),'utf8');
const claimExecutorSource=fs.readFileSync(path.resolve(here,
  '../game/expansion.claim.launch.executor.js'),'utf8');
assert.match(safeConfig,/AUTO_EXPANSION_CLAIM:\s*true\s*,/,
  'autonomous claim intent must be enabled as an explicit release choice');
assert.match(safeConfig,/AUTO_EXPANSION_BOOTSTRAP:\s*true\s*,/,
  'the first-spawn pioneer executor must be enabled with the claim');
assert.match(claimExecutorSource,
  /if\(config\.AUTO_EXPANSION_BOOTSTRAP!==true\)[\s\S]*?BOOTSTRAP_SUPPORT_NOT_AUTHORIZED/,
  'a disabled bootstrap executor must prevent irreversible claim orders');
assert.match(mainSource,
  /const\s+expansionClaimLaunchExecutor\s*=\s*require\(['"]expansion\.claim\.launch\.executor['"]\)/,
  'main imports only the existing exact-identity protected launcher');
assert.match(mainSource,
  /const\s+expansionPioneerProvisioner\s*=\s*require\(['"]expansion\.pioneer\.provisioner['"]\)/,
  'main imports the bounded pioneer order gate');
assert.match(mainSource,
  /if\s*\(config\.AUTO_EXPANSION_CLAIM\s*===\s*true\)\s*\{[\s\S]*?expansionClaimLaunchExecutor\.start\(/,
  'claim launch must be under explicit true flag, not merely a review candidate');
assert.match(mainSource,
  /if\s*\(config\.AUTO_EXPANSION_CLAIM\s*===\s*true\s*&&\s*config\.AUTO_EXPANSION_BOOTSTRAP\s*===\s*true\)\s*\{[\s\S]*?expansionPioneerProvisioner\.provision\(/,
  'pioneer launch requires BOTH explicit claim and bootstrap flags');
assert.match(mainSource,
  /Memory\.bot\?\.expansionClaim\?\.phase\s*===\s*['"]CLAIMING['"][\s\S]*?expansionClaimLaunchExecutor\.supervise\(Game,Memory\)/,
  'orphaned launch mission must be supervised on every game tick');
assert.ok(mainSource.includes('    expansionClaimLaunch,') &&
  mainSource.includes('    expansionPioneerProvision,'),
  'status logs must distinguish disabled, blocked and accepted actions');
assert.match(mainSource,
  /Memory\.bot\?\.expansionClaim\?\.phase\s*===\s*['"]CLAIMED['"][\s\S]*?expansionClaimLaunchExecutor\.superviseBootstrap\(Game,Memory\)/,
  'actual owned-spawn settlement must be supervised every tick after verified claim');
console.log('main runtime wiring tests passed');
