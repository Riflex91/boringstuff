import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ScreepsHttpClient } from './screeps-client-node18.mjs';
import { verifyInitialSpawnTarget } from './spawn-safety.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = process.env.SCREEPS_LOG_DIR || path.resolve(__dirname, '..', 'logs');
const DEFAULT_SERVER = process.env.SCREEPS_SERVER || 'newbieland';
const TOOL_VERSION = '0.2.6-node18';

function usage(exitCode = 0) {
  console.log(`
ChatGPT Screeps Final Spawn Verifier v${TOOL_VERSION}

Default: verify the selected target from the newest planner report:
  npm run spawn:verify

Explicit target:
  npm run spawn:verify -- --room E8N1 --x 20 --y 29 --name Spawn1

Options:
  --report PATH|latest  Planner report used as target source (default: latest when no explicit target)
  --room ROOM           Room to verify
  --x N                 Spawn X
  --y N                 Spawn Y
  --name NAME           Spawn name (default: Spawn1)
  --server NAME         screeps.json server key (default: newbieland)
  --branch NAME         Expected World branch (default: chatgpt)
  --help                Show help

This command is read-only. It NEVER calls /api/game/place-spawn.
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const out = { report: null, room: null, x: null, y: null, name: 'Spawn1', server: DEFAULT_SERVER, branch: 'chatgpt' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') usage(0);
    else if (a === '--report') out.report = argv[++i];
    else if (a === '--room') out.room = String(argv[++i] || '').toUpperCase();
    else if (a === '--x') out.x = Number(argv[++i]);
    else if (a === '--y') out.y = Number(argv[++i]);
    else if (a === '--name') out.name = argv[++i];
    else if (a === '--server') out.server = argv[++i];
    else if (a === '--branch') out.branch = argv[++i];
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!/^[A-Za-z0-9_\-]{1,100}$/.test(out.name)) throw new Error('Spawn name must be 1-100 characters and use letters, digits, _, or -');
  return out;
}

function newestPlan() {
  if (!fs.existsSync(LOG_DIR)) throw new Error(`No log directory exists: ${LOG_DIR}`);
  const files = fs.readdirSync(LOG_DIR)
    .filter(n => /^initial-spawn-plan-.*\.json$/i.test(n))
    .map(n => ({ path: path.join(LOG_DIR, n), mtime: fs.statSync(path.join(LOG_DIR, n)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!files.length) throw new Error(`No initial-spawn-plan-*.json found in ${LOG_DIR}`);
  return files[0].path;
}

function targetFromReport(reportPath) {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const selected = report?.selected;
  if (!selected?.room || !Number.isInteger(selected?.x) || !Number.isInteger(selected?.y)) {
    throw new Error(`Report has no usable selected target: ${reportPath}`);
  }
  return {
    room: String(selected.room).toUpperCase(),
    x: selected.x,
    y: selected.y,
    report,
    reportPath
  };
}

function stamp() { return new Date().toISOString().replace(/[:.]/g, '-'); }
function writeReport(data) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const p = path.join(LOG_DIR, `initial-spawn-verification-${stamp()}.json`);
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return p;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let sourceReport = null;
  if (args.report || (!args.room && args.x === null && args.y === null)) {
    const reportPath = !args.report || args.report === 'latest' ? newestPlan() : path.resolve(args.report);
    sourceReport = targetFromReport(reportPath);
    args.room ||= sourceReport.room;
    if (args.x === null) args.x = sourceReport.x;
    if (args.y === null) args.y = sourceReport.y;
    console.log(`Target loaded from report: ${reportPath}`);
  }

  if (!args.room || !Number.isInteger(args.x) || !Number.isInteger(args.y)) {
    throw new Error('Provide --room, --x and --y, or omit them to use the newest planner report.');
  }

  console.log(`Connecting using Screeps config '${args.server}'...`);
  const api = await ScreepsHttpClient.fromConfig(args.server, { app: 'chatgpt-spawn-verifier' });
  const me = await api.authMe();
  const myUserId = me?._id || me?.id || null;
  console.log(`Authenticated as ${me?.username || me?.email || myUserId || 'unknown user'}`);
  console.log(`VERIFY TARGET: ${args.room} (${args.x},${args.y}) name='${args.name}'`);

  const result = await verifyInitialSpawnTarget({
    api,
    room: args.room,
    x: args.x,
    y: args.y,
    name: args.name,
    myUserId,
    branch: args.branch,
    requireNormalStatus: true,
    requireUniqueName: true
  });

  for (const c of result.checks) {
    const marker = c.pass ? 'PASS' : c.severity === 'warning' ? 'WARN' : 'FAIL';
    const extra = c.error ? ` - ${c.error}` : c.actual !== undefined ? ` - actual=${c.actual}` : '';
    console.log(`${marker.padEnd(4)} ${c.name}${extra}`);
  }

  const report = {
    toolVersion: TOOL_VERSION,
    createdAt: new Date().toISOString(),
    server: args.server,
    sourceReport: sourceReport ? {
      path: sourceReport.reportPath,
      toolVersion: sourceReport.report?.toolVersion || null,
      createdAt: sourceReport.report?.createdAt || null
    } : null,
    authenticatedUser: me?.username || me?.email || myUserId || null,
    result
  };
  const p = writeReport(report);
  console.log(`Verification log written to: ${p}`);
  console.log('No spawn placement API call was made.');

  if (!result.ok) {
    console.error(`FINAL VERIFICATION FAILED (${result.failures.length} blocking check(s)).`);
    process.exitCode = 2;
    return;
  }
  console.log(`FINAL VERIFICATION PASSED for ${args.room} at (${args.x},${args.y}).`);
  if (result.warnings.length) console.log(`Warnings: ${result.warnings.length} (non-blocking).`);
}

main().catch(err => {
  console.error(`\nSpawn verification failed:\n${err?.stack || err}`);
  process.exitCode = 1;
});
