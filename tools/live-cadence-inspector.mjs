// Local-only, read-only telemetry-window inspector. Does not start a
// collector, change runtime flags, upload modules or alter game state.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverLiveWindows } from './live-cadence-inspector-core.mjs';
import { deploymentReceiptPath } from './deployment-receipt.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = {
  logDir: process.env.SCREEPS_LOG_DIR || path.resolve(here, '..', 'logs'),
  server: process.env.SCREEPS_SERVER || 'newbieland',
  branch: process.env.SCREEPS_BRANCH || 'chatgpt',
  room: process.env.SCREEPS_ROOM || 'E8N1',
  limit: 4, json: false
};
for (let i = 0, a = process.argv.slice(2); i < a.length; i++) {
  if (a[i] === '--log-dir') args.logDir = a[++i];
  else if (a[i] === '--server') args.server = a[++i];
  else if (a[i] === '--branch') args.branch = a[++i];
  else if (a[i] === '--room') args.room = a[++i].toUpperCase();
  else if (a[i] === '--limit') args.limit = Number(a[++i]);
  else if (a[i] === '--json') args.json = true;
  else if (a[i] === '--help' || a[i] === '-h') {
    console.log('node live-cadence-inspector.mjs [--log-dir PATH] [--server newbieland] [--branch chatgpt] [--room E8N1] [--limit 4] [--json]');
    process.exit(0);
  } else throw new Error('Unknown argument: ' + a[i]);
}
const receiptFile = deploymentReceiptPath(args.logDir, args.server, args.branch);
if (!fs.existsSync(receiptFile)) throw new Error('Exact deployment receipt missing: ' + receiptFile);
const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
if (receipt.server !== args.server || receipt.branch !== args.branch ||
    !receipt.version || !receipt.deploymentId) {
  throw new Error('Unexpected deployment receipt: fail closed');
}
const events = [];
if (!fs.existsSync(args.logDir)) throw new Error('Log directory missing: ' + args.logDir);
const seen = new Set();
for (const name of fs.readdirSync(args.logDir).filter(n => /^bot-events-.*\.ndjson$/.test(n)).sort()) {
  for (const row of fs.readFileSync(path.join(args.logDir, name), 'utf8').split(/\r?\n/)) {
    if (!row.trim()) continue;
    try {
      const e = JSON.parse(row);
      const key = JSON.stringify(e);
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(e);
    } catch { /* Interrupted last line is not evidence. */ }
  }
}
const result = discoverLiveWindows({ events, receipt, roomName: args.room, limit: args.limit });
if (args.json) console.log(JSON.stringify(result, null, 2));
else {
  console.log('LIVE CADENCE INSPECTOR (READ-ONLY)');
  console.log('Version:', receipt.version, 'deployment ID:', receipt.deploymentId);
  console.log('State:', result.state, result.reason,
    'markerTick:', result.markerTick, 'latestEvidenceTick:', result.latestTick);
  if (result.state === 'READY') {
    const lines = [
      ['P2 scheduler+plan', result.p2Runs, 'p2-live-verification.mjs'],
      ['I2 ROI+CPU', result.i2Runs, 'i2-live-verification.mjs'],
      ['Productive economy exact window', result.economyWindows, 'live-verification.mjs live'],
      ['E4 completed evidence window', result.e4Windows, 'live-verification.mjs live']
    ];
    for (const [name, windows, cmd] of lines) {
      console.log('\n' + name + ':');
      if (!windows.length) console.log('  No exact complete candidate found in retained snapshots.');
      else for (const w of windows) {
        console.log('  start=' + w.startTick + ' end=' + w.endTick +
          ' carrier=' + w.carrierTick +
          ' runTick=' + (w.runTick ?? 'N/A') +
          ' cpu=' + (w.cpu ?? 'N/A') +
          ' duplicateReservationTicks=' + (w.duplicateReservationTicks ?? 'UNKNOWN'));
        if (name.startsWith('E4')) {
          console.log('    criticalRequestTicks=' + (w.criticalRequestTicks ?? 'UNKNOWN') +
            ' matched=' + (w.criticalMatchedTicks ?? 'UNKNOWN') +
            ' unmatched=' + (w.unmatchedCriticalTicks ?? 'UNKNOWN') +
            ' coverage=' + (w.criticalCoverageRatio ?? 'UNKNOWN') +
            ' noCandidate=' + (w.criticalNoCandidateTicks ?? 'UNKNOWN') +
            ' candidateUnmatched=' + (w.criticalCandidateUnmatchedTicks ?? 'UNKNOWN') +
            ' candidateRequest=' + (w.criticalCandidateRequestTicks ?? 'UNKNOWN') +
            ' slotCapacity=' + (w.criticalSlotCapacityTicks ?? 'UNKNOWN'));
          console.log('    haulers(avg)=' + (w.averageHaulers ?? 'UNKNOWN') +
            ' matchedHaulers(avg)=' + (w.averageMatchedHaulers ?? 'UNKNOWN') +
            ' consumerFallback(avg)=' + (w.averageConsumerFallback ?? 'UNKNOWN'));
          console.log('    SLOT ACCOUNTING (SHADOW, not physical throughput):',
            JSON.stringify(w.slotAccounting));
          if (!w.spawnStarts?.length) {
            console.log('    SPAWN_OK: no matching recorded starts in this E4 window (absence is inconclusive)');
          } else for (const spawn of w.spawnStarts) {
            console.log('    SPAWN START (logged, not completion): ' +
              'tick=' + spawn.startTick + ' role=' + (spawn.role ?? 'UNKNOWN') +
              ' cost=' + (spawn.cost ?? 'UNKNOWN') +
              ' bodyParts=' + (spawn.bodyParts ?? 'UNKNOWN') +
              ' projectedReadyTick=' + (spawn.projectedReadyTick ?? 'UNKNOWN'));
          }
          if (!w.roomHeartbeatHints?.length) {
            console.log('    ROOM_HEARTBEAT: no matching logged samples; source of critical surge UNKNOWN');
          } else for (const hint of w.roomHeartbeatHints) {
            console.log('    ROOM_HEARTBEAT (sampled): ' +
              'tick=' + hint.tick +
              ' energy=' + (hint.energyAvailable ?? 'UNKNOWN') +
              '/' + (hint.energyCapacity ?? 'UNKNOWN') +
              ' below300reserve=' + (hint.belowInfrastructureReserve ?? 'UNKNOWN') +
              ' E3-emergency=' + (hint.emergencyDeliverSpecs ?? 'UNKNOWN') +
              ' E4-critical=' + (hint.shadowCriticalRequestCount ?? 'UNKNOWN') +
              ' haulers=' + (hint.shadowHaulerCount ?? 'UNKNOWN'));
          }
        }
        if (name.startsWith('Productive')) {
          console.log('    consumerTicks=' + (w.consumerTicks ?? 'UNKNOWN') +
            ' waitingConsumerTicks=' + (w.waitingConsumerTicks ?? 'UNKNOWN') +
            ' criticalConsumerTicks=' + (w.criticalConsumerTicks ?? 'UNKNOWN') +
            ' fallbackConsumerTicks=' + (w.fallbackConsumerTicks ?? 'UNKNOWN') +
            ' controllerProgress=' + (w.controllerProgress ?? 'UNKNOWN') +
            ' constructionProgress=' + (w.constructionProgress ?? 'UNKNOWN'));
        }
      }
      if (windows.length) console.log('  Probe: node .\\' + cmd + ' --start-tick ' + windows[0].startTick);
    }
    console.log('\nEconomy+E4 shared window starts:',
      result.overlappingEconomyE4Windows.map(x => x.startTick).join(', ') || '(none observed)');
    console.log('Latest efficiency:', JSON.stringify(result.latestEfficiency));
    console.log('Latest productive/spawn context:',
      JSON.stringify(result.latestProductiveContext));
    console.log('Recent spawn events (500 ticks, logged only):',
      JSON.stringify(result.recentSpawnEvents));
    console.log('CANDIDATES ONLY: run the original verifier. No WATCH is promoted to PASS.');
    console.log('E4 may require an exact later snapshot carrier; the original verifier can still WATCH.');
  }
}
if (result.state !== 'READY') process.exitCode = 3;
