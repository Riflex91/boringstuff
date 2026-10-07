import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_VERIFICATION_LOG_DIR, readDeploymentReceipt } from './deployment-receipt.mjs';
import { EXPECTED_BOT_VERSION } from './live-verification-core.mjs';
import { evaluateD0Shadow } from './d0-live-verification-core.mjs';

const args = process.argv.slice(2);
let startTick;
let logDir = process.env.SCREEPS_LOG_DIR || DEFAULT_VERIFICATION_LOG_DIR;
let roomName = process.env.SCREEPS_ROOM || 'E8N1';
let json = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--start-tick') startTick = Number(args[++i]);
  else if (args[i] === '--log-dir') logDir = args[++i];
  else if (args[i] === '--room') roomName = args[++i];
  else if (args[i] === '--json') json = true;
  else throw new Error('Unknown argument: ' + args[i]);
}
const events = [];
const seen = new Set();
for (const file of fs.readdirSync(logDir).filter(n => /^bot-events-.*\.ndjson$/.test(n)).sort()) {
  for (const line of fs.readFileSync(path.join(logDir, file), 'utf8').split(/\r?\n/)) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.v !== EXPECTED_BOT_VERSION) continue;
    const key = event.jseq || JSON.stringify(event);
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(event);
  }
}
events.sort((a, b) => a.tick - b.tick);
const receipt = readDeploymentReceipt({ logDir, server: process.env.SCREEPS_SERVER || 'newbieland', branch: process.env.SCREEPS_BRANCH || 'chatgpt', version: EXPECTED_BOT_VERSION });
if (!receipt) throw new Error('Exact deployment receipt required.');
const marker = events.find(e => e.code === 'DEPLOYMENT_MARKER' && e.ctx?.deploymentId === receipt.receipt.deploymentId);
if (!marker) throw new Error('Exact deployment marker missing.');
if (startTick === undefined) startTick = marker.tick;
if (startTick < marker.tick) throw new Error('Window predates the exact deployment.');
const subsequentDeploy = events.find(e => e.code === 'DEPLOYMENT_MARKER' && e.tick > marker.tick && e.tick <= startTick + 99);
if (subsequentDeploy) throw new Error('Verification window crosses a deployment.');
const result = evaluateD0Shadow({ events: events.filter(e => e.tick >= marker.tick), startTick, roomName });
if (json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`VERIFY D0 ${result.startTick}-${result.endTick}: ${result.outcome}`);
  for (const c of result.checks) console.log(`${c.status} ${c.id}: ${c.message}`);
  console.log(JSON.stringify(result.counts));
}
process.exitCode = result.counts.fail ? 2 : 0;
