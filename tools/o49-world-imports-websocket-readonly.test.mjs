import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  resolveSafeScreepsSocketTarget,
  protectScreepsSocketSend,
  assertReadOnlyScreepsWsCommand,
  WORLD_WS_MUTATION_HOLD
} from './o49-world-websocket-readonly.mjs';
import { stageInactiveWorldCode } from './world-branch-bootstrap.mjs';
import { restageInactiveWorldCode } from './world-next-inactive-restage.mjs';
import { stageSeparateInactiveCode } from './world-next-separate-inactive-stage.mjs';
import { placeW37S79Only } from './world-next-place-spawn.mjs';
import { activateW37S79 } from './world-next-activate-spawn.mjs';
import { placePinnedWorldSpawn,activateVerifiedWorldSpawn }
  from './world-first-spawn.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const calls=[];
const api=new Proxy({}, {
  get(_obj,key){calls.push(String(key));throw new Error('MOCK_API_TOUCHED');}
});
const data={main:'synthetic-code',config:'synthetic-config'};
const mutations=[
  ['world-branch-bootstrap.mjs','stageInactiveWorldCode',
    ()=>stageInactiveWorldCode(api,data)],
  ['world-next-inactive-restage.mjs','restageInactiveWorldCode',
    ()=>restageInactiveWorldCode(api,data,'RESTAGE_INACTIVE_WORLD_CODE')],
  ['world-next-separate-inactive-stage.mjs','stageSeparateInactiveCode',
    ()=>stageSeparateInactiveCode(api,data,'STAGE_SEPARATE_INACTIVE_CODE')],
  ['world-next-place-spawn.mjs','placeW37S79Only',
    ()=>placeW37S79Only(api,'operator','PLACE_W37S79_37_26_ONLY')],
  ['world-next-activate-spawn.mjs','activateW37S79',
    ()=>activateW37S79(api,'ACTIVATE_W37S79_VERIFIED_SPAWN_STAGE')],
  ['world-first-spawn.mjs','placePinnedWorldSpawn',
    ()=>placePinnedWorldSpawn(api,'operator')],
  ['world-first-spawn.mjs','activateVerifiedWorldSpawn',
    ()=>activateVerifiedWorldSpawn(api,'operator',{
      status:'PASS',spawnVerified:true,worldCodeActivated:false
    })]
];
for(const [file,fn,invoke] of mutations){
  await assert.rejects(invoke,/O45_WORLD_MUTATION_HOLD_NO_APPROVED_FENCED_EXECUTOR/,
    file+' imported legacy writer MUST abort before touching injected API');
  assert.deepEqual(calls,[],'No getter or method may be read from caller API');
  const src=fs.readFileSync(path.join(root,'tools',file),'utf8');
  const entry=src.indexOf('export async function '+fn+'(');
  const hold=src.indexOf('assertLegacyWorldMutationDisabled(',entry);
  assert.ok(entry>=0 && hold>entry && hold-entry<420,
    file+' must deny immediately inside exported writer function');
}
// O49: socket URL may preserve configured proxy prefixes but not raw credentials
// or an arbitrary URI authority injected by changing the base path.
assert.equal(resolveSafeScreepsSocketTarget('https://screeps.com/').href,
  'wss://screeps.com/socket/websocket');
assert.equal(resolveSafeScreepsSocketTarget('http://screeps.newbieland.net:21025/').href,
  'ws://screeps.newbieland.net:21025/socket/websocket');
assert.equal(resolveSafeScreepsSocketTarget('https://test.invalid/proxy/').href,
  'wss://test.invalid/proxy/socket/websocket');
for(const bad of [
  'https://user:password@screeps.com/',
  'https://screeps.com/?token=secret', 'ftp://screeps.com/',
  'not-a-url','https://screeps.com/#token',null
]){
  assert.throws(()=>resolveSafeScreepsSocketTarget(bad),
    /O48_API_TARGET_HOLD_UNSAFE_ENDPOINT|O49_WORLD_WEBSOCKET_HOLD_READ_ONLY_DIAGNOSTICS/);
}
const token='synthetic-reader-token';
const world='https://screeps.com/';
const commands=[
  'auth '+token, 'subscribe user:abcdef0123456789abcdef01/console',
  'subscribe user:user-123/cpu'
];
for(const command of commands)
  assert.equal(assertReadOnlyScreepsWsCommand('world',world,command,token),
    undefined);
for(const disallowed of [
  'console.log(1)', 'console Game.spawns.Spawn1.destroy()',
  'eval Game.spawns.Spawn1.destroy()', 'memory set', 'set-active-branch',
  'subscribe room:W37S79', 'subscribe user:abc/memory',
  'subscribe user:abc/console\nconsole something',
  'auth another-token', 'unsubscribe user:abc/cpu',Buffer.from('console hi'),
  'subscribe user:abc/cpu\u0000',null
]){
  assert.throws(()=>assertReadOnlyScreepsWsCommand(
    'world',world,disallowed,token),new RegExp(WORLD_WS_MUTATION_HOLD));
}
// Guard must use actual host as in O47: a mislabeled client pointed at
// official World cannot write arbitrary WebSocket commands.
for(const invalidToken of [
  'token\nconsole malicious', 'contains spaces', 'token\r\n',
  'token\u0000danger', ''
]){
  const tokenValue=invalidToken.includes('\\n')?invalidToken.replace('\\n','\n')
    :invalidToken.includes('\\r')?invalidToken.replace('\\r','\r')
    :invalidToken.includes('\\u0000')?invalidToken.replace('\\u0000','\u0000')
    :invalidToken;
  assert.throws(()=>assertReadOnlyScreepsWsCommand(
    'world',world,'auth '+tokenValue,tokenValue),
    new RegExp(WORLD_WS_MUTATION_HOLD));
  assert.throws(()=>protectScreepsSocketSend(
    {send(){}},'world',world,tokenValue),
    new RegExp(WORLD_WS_MUTATION_HOLD));
}

const sent=[];
const ws={send(value){sent.push(value);return 1;}};
protectScreepsSocketSend(ws,'newbieland',world,token);
for(const msg of commands){assert.equal(ws.send(msg),1);}
assert.deepEqual(sent,commands);
assert.throws(()=>ws.send('console malicious eval'),new RegExp(WORLD_WS_MUTATION_HOLD));
assert.throws(()=>{ws.send=()=>sent.push('bypass');},TypeError);
assert.equal(Object.getOwnPropertyDescriptor(ws,'send').configurable,false);
assert.equal(sent.length,3);

const separate=[];
const nbWs={send(m){separate.push(m);}};
protectScreepsSocketSend(nbWs,'newbieland',
  'http://screeps.newbieland.net:21025/',token);
nbWs.send('subscribe user:someone/custom');
assert.deepEqual(separate,['subscribe user:someone/custom'],
  'Newbieland non-World WebSocket behavior is unchanged');

const source=fs.readFileSync(path.join(root,'tools','screeps-client.mjs'),'utf8');
assert.ok(source.includes('resolveSafeScreepsSocketTarget(configuredBaseUrl)'));
assert.ok(source.includes('protectScreepsSocketSend(ws,this.http.serverName'));
assert.ok(!source.includes('WebSocket authentication failed: ${msg}'),
  'Never include raw WebSocket auth response frames in errors');
console.log('O49 exported World writer unconditional HOLD + World WebSocket readonly guard: PASS');
