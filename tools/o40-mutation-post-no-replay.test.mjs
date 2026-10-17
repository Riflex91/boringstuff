import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { reconcileUncertainCodePostViaGet } from './o40-code-post-get-reconcile.mjs';

const modules = { main: 'module.exports.loop=()=>{};',
  config: "module.exports={VERSION:'o16'};" };
for (let i = 0; i < 80; i++) modules['module' + i] = 'source' + i;
assert.equal(Object.keys(modules).length, 82);

async function transportScenario(route, kind) {
  let posts = 0, signins = 0, wrongMethod = 0;
  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/auth/signin') {
      signins++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end('{"token":"unexpected"}');
    }
    if (req.method !== 'POST' || req.url !== route) wrongMethod++;
    posts++;
    for await (const chunk of req) { void chunk; }
    if (kind === 'socket-loss') return req.socket.destroy();
    const status = kind === '401' ? 401 : kind === '429' ? 429 :
      kind === '503' ? 503 : 200;
    res.writeHead(status, { 'Content-Type': 'application/json', 'Retry-After': '0' });
    res.end(status === 200 ? '{"ok":1}' : '{"error":"unconfirmed"}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const client = new ScreepsHttpClient('offline', {
    baseUrl: 'http://127.0.0.1:' + server.address().port + '/',
    token: 'fixture-token', email: 'fixture@example.test', password: 'fixture'
  });
  try {
    // Even explicit retry overrides must not bypass the mutation guard.
    const action = () => client._request('POST', route,
      { branch: 'fixture', modules },
      { max429Retries: 8, max5xxRetries: 8, retryAuth: true });
    if (kind === '200') assert.equal((await action()).ok, 1);
    else await assert.rejects(action);
    assert.equal(posts, 1, route + ' / ' + kind + ' replayed');
    assert.equal(signins, 0, 'A mutation cannot sign in then replay');
    assert.equal(wrongMethod, 0);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

for (const route of [
  '/api/user/code',
  '/api/user/clone-branch',
  '/api/user/set-active-branch',
  '/api/game/place-spawn',
  '/api/user/memory'
]) {
  for (const kind of ['200', '401', '429', '503', 'socket-loss'])
    await transportScenario(route, kind);
}

// A failed GET can be retried as GET, with no escalation into a POST.
{
  let reads = 0;
  const server = http.createServer((req, res) => {
    assert.equal(req.method, 'GET');
    reads++;
    res.writeHead(reads === 1 ? 503 : 200,
      { 'Content-Type': 'application/json' });
    res.end(reads === 1 ? '{}' : '{"list":[]}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const client = new ScreepsHttpClient('offline', {
      baseUrl: 'http://127.0.0.1:' + server.address().port + '/', token: 'x'
    });
    assert.deepEqual((await client._request('GET', '/api/user/branches')).list, []);
    assert.equal(reads, 2);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

const active = { list: [
  { branch: 'chatgpt', activeWorld: true },
  { branch: 'default', activeWorld: false }
] };
async function diagnostic(branches, readback, reject = false, token = 'x') {
  const calls = [];
  const api = {
    token,
    async _request(method, endpoint, payload, options) {
      calls.push({ method, endpoint, payload, options });
      assert.equal(method, 'GET', 'Uncertain POST must never cause a write');
      assert.equal(options?.retryAuth, false);
      if (reject) throw new Error('unavailable');
      return endpoint === '/api/user/branches' ? branches : readback;
    }
  };
  const result = await reconcileUncertainCodePostViaGet(api, 'chatgpt', modules);
  assert.equal(calls.some(c => c.method !== 'GET'), false);
  assert.equal(result.mayRetryCodePost, false);
  assert.equal(result.mayRollback, false);
  assert.equal(result.mayWriteReceipt, false);
  assert.equal(result.releaseAuthorized, false);
  assert.equal(result.canonicalLive100tPass, false);
  assert.equal(result.requiresOperatorReview, true);
  return { result, calls };
}
{
  const { result, calls } = await diagnostic(active, { modules: { ...modules } });
  assert.equal(result.classification, 'GET_READBACK_EXACT_BUT_POST_ACK_AND_RECEIPT_MISSING');
  assert.equal(result.readbackExact, true);
  assert.equal(calls.length, 2);
}
{
  const { result } = await diagnostic(active, {
    modules: { ...modules, config: 'DIFFERENT' }
  });
  assert.equal(result.classification, 'GET_READBACK_DIFFERENT_OUTCOME_UNKNOWN');
}
{
  const { result } = await diagnostic({ list: [
    { branch: 'other', activeWorld: true }
  ] }, { modules });
  assert.equal(result.classification, 'ACTIVE_BRANCH_UNVERIFIED_OUTCOME_UNKNOWN');
}
{
  const { result } = await diagnostic(active, { modules }, true);
  assert.equal(result.classification, 'GET_UNAVAILABLE_OUTCOME_UNKNOWN');
}
{
  const { result, calls } = await diagnostic(active, { modules }, false, '');
  assert.equal(result.classification, 'GET_NOT_SAFE_OR_EXPECTED_PAYLOAD_UNVERIFIED');
  assert.equal(calls.length, 0, 'No token -> do not initiate POST authentication');
}
// Exercise a real GET 401 with password credentials: no implicit sign-in POST.
{
  let getCount = 0, postCount = 0;
  const server = http.createServer((req, res) => {
    if (req.method === 'POST') postCount++;
    else getCount++;
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end('{"error":"expired"}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const client = new ScreepsHttpClient('offline', {
      baseUrl: 'http://127.0.0.1:' + server.address().port + '/',
      token: 'expired', email: 'fixture', password: 'fixture'
    });
    const result = await reconcileUncertainCodePostViaGet(client, 'chatgpt', modules);
    assert.equal(result.classification, 'GET_UNAVAILABLE_OUTCOME_UNKNOWN');
    assert.equal(getCount, 2);
    assert.equal(postCount, 0);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

// Offline regression for the already-shared GitHub workflow concurrency group.
// GitHub's concurrency protects workflows only within THIS repository; this
// is not a global lock against external CLIs, tokens or other repositories.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowDir = path.join(root, '.github', 'workflows');
const writers = [
  'screeps-world-bootstrap.yml',
  'screeps-world-deploy.yml',
  'screeps-world-next-auto-deploy.yml',
  'screeps-world-next-inactive-restage.yml',
  'screeps-world-next-separate-inactive-stage.yml',
  'screeps-world-next-activate-spawn.yml',
  'screeps-world-next-place-spawn.yml',
  'screeps-world-first-spawn.yml'
];
for (const file of writers) {
  const workflow = fs.readFileSync(path.join(workflowDir, file), 'utf8');
  assert.match(workflow,
    /concurrency:\s*\n\s*group:\s*screeps-world-chatgpt\s*\n\s*cancel-in-progress:\s*false\b/,
    file + ' must participate in the single shared World writer queue');
}
// Fail when any previously unlisted workflow directly invokes a known World writer.
const executables = [
  'deploy-live.mjs', 'world-branch-bootstrap.mjs',
  'world-next-inactive-restage.mjs', 'world-next-separate-inactive-stage.mjs',
  'world-next-activate-spawn.mjs', 'world-next-place-spawn.mjs',
  'world-first-spawn.mjs'
];
for (const file of fs.readdirSync(workflowDir).filter(n => n.endsWith('.yml'))) {
  const source = fs.readFileSync(path.join(workflowDir, file), 'utf8');
  if (!file.startsWith('screeps-world-')) continue;
  const invokes = executables.some(name => source.includes('node ' + name));
  if (invokes) assert.ok(writers.includes(file), 'Unexpected World writer: ' + file);
}
const deploy = fs.readFileSync(path.join(root, 'tools', 'deploy-live.mjs'), 'utf8');
assert.match(deploy, /reconcileUncertainCodePostViaGet\(api, branch, modules\)/);
assert.match(deploy, /CODE_POST_OUTCOME_UNCERTAIN_NO_RETRY_NO_RECEIPT/);
console.log('O40 offline no-replay mutations, GET-only reconciliation and shared World writer queue: PASS');
