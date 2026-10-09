// Read-only P3 release witness: no collector start, upload, telemetry writes,
// gameplay actions, or merge. Uses only existing collector evidence.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assessP3Release } from './p3-release-evidence-core.mjs';
import { evaluateP3Shadow } from './p3-live-verification-core.mjs';
import { deploymentReceiptPath } from './deployment-receipt.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = {
  logDir: process.env.SCREEPS_LOG_DIR || path.resolve(here, '..', 'logs'),
  server: process.env.SCREEPS_SERVER || 'newbieland',
  branch: process.env.SCREEPS_BRANCH || 'chatgpt',
  roomName: process.env.SCREEPS_ROOM || 'E8N1',
  wait: false, timeoutSeconds: 1800, pollSeconds: 10, minRuns: 1, observeRuns: null, json: false
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--log-dir') args.logDir = String(argv[++i] || '');
  else if (a === '--server') args.server = String(argv[++i] || '');
  else if (a === '--branch') args.branch = String(argv[++i] || '');
  else if (a === '--room') args.roomName = String(argv[++i] || '').toUpperCase();
  else if (a === '--wait') args.wait = true;
  else if (a === '--min-runs') args.minRuns = Number(argv[++i]);
  else if (a === '--observe-runs') args.observeRuns = Number(argv[++i]);
  else if (a === '--timeout-seconds') args.timeoutSeconds = Number(argv[++i]);
  else if (a === '--poll-seconds') args.pollSeconds = Number(argv[++i]);
  else if (a === '--json') args.json = true;
  else if (a === '--help' || a === '-h') {
    console.log('Read-only P3 release witness\n  node p3-release-evidence.mjs [--wait] [--min-runs 2] [--observe-runs 2] [--timeout-seconds 1800] [--poll-seconds 10] [--log-dir PATH] [--server newbieland] [--branch chatgpt] [--room E8N1] [--json]');
    process.exit(0);
  } else throw new Error('Unknown argument: ' + a);
}
for (const [k, min, max] of [['minRuns', 1, 100], ['timeoutSeconds', 1, 86400], ['pollSeconds', 1, 3600]]) {
  if (!Number.isInteger(args[k]) || args[k] < min || args[k] > max) throw new Error('Invalid ' + k);
}

const receiptFile = deploymentReceiptPath(args.logDir, args.server, args.branch);
if (!fs.existsSync(receiptFile)) throw new Error('Exact deployment receipt missing: ' + receiptFile);
const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
if (receipt.server !== args.server || receipt.branch !== args.branch ||
    !receipt.version || !receipt.deploymentId) {
  throw new Error('Deployment receipt server/branch/id mismatch. Refusing inference.');
}
console.log('P3 RELEASE WITNESS (READ-ONLY)');
console.log('Server/branch:', args.server + '/' + args.branch);
console.log('Version:', receipt.version);
console.log('Deployment ID:', receipt.deploymentId);
if (args.observeRuns !== null && (!Number.isInteger(args.observeRuns) || args.observeRuns < 1 || args.observeRuns > 100)) {
  throw new Error('Invalid observeRuns');
}
// An observation quorum also raises the PASS quorum: a single PASS alongside
// an earlier WATCH is never a two-run all-PASS acceptance result.
if (args.observeRuns !== null) args.minRuns = Math.max(args.minRuns, args.observeRuns);
console.log('Room:', args.roomName, 'minimum distinct PASS runs:', args.minRuns,
  'observation quorum:', args.observeRuns ?? 'disabled');
console.log('Log directory:', args.logDir);

function loadEvents() {
  if (!fs.existsSync(args.logDir)) throw new Error('Collector log directory does not exist');
  const rows = [];
  const names = fs.readdirSync(args.logDir).filter(n => /^bot-events-.*\.ndjson$/.test(n)).sort();
  for (const name of names) {
    const data = fs.readFileSync(path.join(args.logDir, name), 'utf8');
    for (const line of data.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { rows.push(JSON.parse(line)); } catch { /* Ignore interrupted trailing line. */ }
    }
  }
  const seen = new Set();
  return rows.filter(e => {
    // Journal replay may duplicate console events; never inflate samples.
    const key = JSON.stringify(e);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inspect() {
  const events = loadEvents();
  const witness = assessP3Release({ events, receipt, roomName: args.roomName });
  const versionEvents = events.filter(e => e.v === receipt.version &&
    Number(e.tick) >= witness.markerTick);
  const results = witness.samples.map(sample => {
    const result = evaluateP3Shadow({
      events: versionEvents, startTick: sample.startTick,
      tickCount: 100, roomName: args.roomName
    });
    return { sample, outcome: result.outcome, complete: result.complete,
      counts: result.counts, checks: result.checks };
  });
  return { witness, results };
}

const deadline = Date.now() + args.timeoutSeconds * 1000;
let lastSignature = '';
let lastStatusAt = 0;
for (;;) {
  const outcome = inspect();
  const { witness, results } = outcome;
  const signature = [witness.state, witness.reason, witness.markerTick,
    witness.samples.map(s => s.runTick).join(','),
    results.map(r => r.outcome).join(',')].join(':');
  if (signature !== lastSignature || Date.now() - lastStatusAt >= 60000) {
    if (args.json) console.log(JSON.stringify(outcome, null, 2));
    else console.log('State:', witness.state, witness.reason,
      'markerTick:', witness.markerTick, 'latestEvidenceTick:', witness.latestTick,
      'distinctReleaseRuns:', witness.samples.length);
    for (const r of results) {
      console.log('OBSERVED: runTick=' + r.sample.runTick +
        ' snapshot=' + r.sample.snapshotTick +
        ' window=' + r.sample.startTick + '-' + r.sample.endTick +
        ' schedulerCPU=' + r.sample.schedulerCpu +
        ' MINCUTphaseCPU=' + r.sample.mincutPhaseCpu +
        ' topologyCPU=' + (r.sample.phases?.PROTECTED_TOPOLOGY ?? 'UNKNOWN') +
        ' scoringCPU=' + (r.sample.phases?.DEFENSE_SCORE ?? 'UNKNOWN') +
        ' phaseSumCPU=' + (r.sample.accountedCpu ?? 'UNKNOWN') +
        ' outsidePhasesCPU=' + (r.sample.cpuOutsidePhases ?? 'UNKNOWN') +
        ' outcome=' + r.outcome + ' complete=' + r.complete +
        ' checks=' + JSON.stringify(r.counts));
      for (const c of r.checks.filter(c => c.status !== 'PASS')) {
        console.log('  ' + c.status + ' ' + c.id + ': ' + c.message);
      }
    }
    lastSignature = signature;
    lastStatusAt = Date.now();
  }
  if (witness.state === 'BLOCKED') {
    console.error('BLOCKED: Another deployment marker occurred after this receipt. No release PASS.');
    process.exitCode = 2;
    break;
  }
  const final = results.filter(r => r.complete);
  if (final.some(r => r.outcome === 'FAIL')) {
    console.error('FAIL: Complete P3 verification has hard failures.');
    for (const r of final.filter(r => r.outcome === 'FAIL')) {
      console.error('Tick', r.sample.runTick, JSON.stringify(r.checks.filter(c => c.status === 'FAIL')));
    }
    process.exitCode = 2;
    break;
  }
  const accepted = final.filter(r => r.outcome === 'PASS');
  if (accepted.length >= args.minRuns) {
    for (const r of accepted) {
      console.log('PASS: runTick=' + r.sample.runTick +
        ' snapshot=' + r.sample.snapshotTick +
        ' window=' + r.sample.startTick + '-' + r.sample.endTick +
        ' schedulerCPU=' + r.sample.schedulerCpu +
        ' MINCUTphaseCPU=' + r.sample.mincutPhaseCpu +
        ' phaseSumCPU=' + (r.sample.accountedCpu ?? 'UNKNOWN') +
        ' outsidePhasesCPU=' + (r.sample.cpuOutsidePhases ?? 'UNKNOWN') +
        ' checks=' + r.counts.pass + ' PASS/' + r.counts.watch + ' WATCH/' + r.counts.fail + ' FAIL');
    }
    console.log('RELEASE CPU OBSERVED: ' + accepted.length + ' distinct post-deploy P3 execution(s).');
    console.log('NOTE: A reduction vs D0.6 requires comparisons across representative workloads, not one sample.');
    process.exitCode = 0;
    break;
  }
  // Diagnostics can finish once enough distinct verified release executions
  // were observed, even if their CPU status is WATCH. A WATCH is never PASS.
  if (args.observeRuns !== null && final.length >= args.observeRuns) {
    console.log('DIAGNOSTIC QUORUM: ' + final.length +
      ' distinct completed post-deploy executions observed.');
    for (const r of final) {
      console.log('  runTick=' + r.sample.runTick +
        ' schedulerCPU=' + r.sample.schedulerCpu +
        ' MINCUTphaseCPU=' + r.sample.mincutPhaseCpu +
        ' outcome=' + r.outcome + ' checks=' + JSON.stringify(r.counts));
    }
    console.log('RELEASE RESULT: WATCH — observation quorum is not an all-PASS acceptance criterion.');
    process.exitCode = 3;
    break;
  }
  if (!args.wait || Date.now() >= deadline) {
    console.log('WATCH: No sufficient new complete P3 PASS windows (' + accepted.length + '/' + args.minRuns + ').');
    for (const r of results) console.log('  runTick', r.sample.runTick, r.outcome,
      'checks', JSON.stringify(r.counts));
    process.exitCode = 3;
    break;
  }
  await new Promise(resolve => setTimeout(resolve, args.pollSeconds * 1000));
}
