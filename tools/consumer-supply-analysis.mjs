// Local-only analysis. Reads collector files; never starts a collector,
// calls Screeps, merges, deploys, or mutates any local telemetry.
import fs from 'node:fs';
import path from 'node:path';
import { readDeploymentReceipt, DEFAULT_VERIFICATION_LOG_DIR } from './deployment-receipt.mjs';
import { analyzeSupplyEvidence } from './consumer-supply-analysis-core.mjs';

const args = {
  logDir: process.env.SCREEPS_LOG_DIR || DEFAULT_VERIFICATION_LOG_DIR,
  server: process.env.SCREEPS_SERVER || 'newbieland',
  branch: process.env.SCREEPS_BRANCH || 'chatgpt',
  room: process.env.SCREEPS_ROOM || 'E8N1',
  json: false
};
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i];
  if (flag === '--log-dir') args.logDir = process.argv[++i];
  else if (flag === '--server') args.server = process.argv[++i];
  else if (flag === '--branch') args.branch = process.argv[++i];
  else if (flag === '--room') args.room = String(process.argv[++i]).toUpperCase();
  else if (flag === '--json') args.json = true;
  else if (flag === '--help' || flag === '-h') {
    console.log('node consumer-supply-analysis.mjs [--log-dir PATH] [--server NAME] [--branch NAME] [--room E8N1] [--json]');
    process.exit(0);
  } else throw new Error('Unknown argument: ' + flag);
}
const pinned = readDeploymentReceipt({
  logDir: args.logDir, server: args.server, branch: args.branch
});
if (!pinned) throw new Error('Missing or invalid exact deployment receipt; refusing unpinned comparison');
if (!fs.existsSync(args.logDir)) throw new Error('Missing log directory: ' + args.logDir);

const events = [];
let unparseableLines = 0;
for (const name of fs.readdirSync(args.logDir).filter(n => /^bot-events-.*\.ndjson$/.test(n)).sort()) {
  for (const line of fs.readFileSync(path.join(args.logDir, name), 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); }
    catch { unparseableLines++; }
  }
}
const report = analyzeSupplyEvidence({
  events, receipt: pinned.receipt, roomName: args.room
});
report.input = {
  version: pinned.receipt.version,
  deploymentId: pinned.receipt.deploymentId,
  room: args.room,
  logRows: events.length,
  unparseableLines
};
if (args.json) console.log(JSON.stringify(report, null, 2));
else {
  console.log('CONSUMER SUPPLY OFFLINE ANALYSIS (READ-ONLY)');
  console.log('Release:', report.input.version, 'deployment:', report.input.deploymentId);
  console.log('State:', report.state, report.reason,
    'marker:', report.markerTick, 'latest:', report.latestTick);
  console.log('Valid post-handler samples:', report.samples.length,
    'invalid samples:', report.invalidTicks?.length ?? 0,
    'unparseable collector lines:', unparseableLines);
  if (report.integrity) console.log('Continuity:', JSON.stringify(report.integrity));
  for (const s of report.samples) {
    const pre = s.heartbeat;
    console.log('tick=' + s.tick +
      ' fallback(post)=' + s.consumers.fallback +
      ' waiting(post)=' + s.consumers.waiting +
      ' haulersReady(post)=' + s.haulers.readyByGuardRule +
      ' energyCarried(post)=' + s.haulers.totalCarriedEnergy +
      ' acceptedIntents=' + s.consumerTransfers.accepted +
      ' noRange=' + s.consumerTransfers.notInRange +
      ' roomEnergy(pre)=' + (pre?.roomEnergy ?? 'UNKNOWN') +
      ' roomFallback(pre)=' + (pre?.fallbackConsumers ?? 'UNKNOWN'));
  }
  for (const w of report.windows) {
    console.log('window=' + w.startTick + '-' + w.endTick +
      ' fallbackConsumerTicks=' + (w.fallbackConsumerTicks ?? 'UNKNOWN') +
      ' observedDiagnosticTicks=' + w.diagnosticSampleTicks.join(','));
  }
  for (const note of report.notes || []) console.log('NOTE:', note);
}
if (report.state === 'BLOCKED' || report.state === 'REVIEW_REQUIRED') process.exitCode = 3;
