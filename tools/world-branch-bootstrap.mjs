import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { buildWorldConfig } from './world-deployment-profile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export function assessWorldCodeBootstrap({ account, status, branches, backup }) {
  const failures = [];
  if (account?.ok === false || !(account?._id || account?.id)) failures.push('ACCOUNT_UNVERIFIED');
  if (status?.ok === false || status?.status !== 'empty') failures.push('ACCOUNT_NOT_EMPTY');
  const list = Array.isArray(branches?.list) ? branches.list : [];
  if (list.some(b => b?.branch === 'chatgpt')) failures.push('WORLD_BRANCH_ALREADY_EXISTS');
  if (!list.some(b => b?.branch === 'default' && b?.activeWorld === true))
    failures.push('DEFAULT_BRANCH_NOT_ACTIVE');
  if (!backup?.modules || typeof backup.modules !== 'object' || Array.isArray(backup.modules))
    failures.push('CURRENT_CODE_BACKUP_NOT_READABLE');
  return { ok: failures.length === 0, failures, targetBranch: 'chatgpt' };
}
export function verifyUploadedWorldModules(expected, actual) {
  if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
  const names = Object.keys(expected).sort();
  const got = Object.keys(actual).sort();
  return names.length === got.length &&
    names.every((name,i) => name === got[i] && expected[name] === actual[name]);
}
function hash(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex');
}
async function main() {
  const temp = process.env.RUNNER_TEMP;
  if (!temp || process.env.WORLD_BOOTSTRAP_CONFIRM !== 'STAGE_WORLD_CODE')
    throw new Error('World code staging requires explicit authorized workflow gate');
  const filename = path.join(temp, 'screeps-world-bootstrap-' + process.pid + '.json');
  const evidenceDir = path.join(temp,'world-bootstrap-evidence');
  fs.mkdirSync(evidenceDir,{recursive:true});
  fs.writeFileSync(filename, JSON.stringify(buildWorldConfig(process.env)), {flag:'wx',mode:0o600});
  try {
    const api = await ScreepsHttpClient.fromConfig('world',{file:filename});
    const read = async () => {
      const [account,status,branches,backup] = await Promise.all([
        api.authMe(),api.userWorldStatus(),api.userBranches(),
        api._request('GET','/api/user/code',{branch:'default'})
      ]);
      return { account,status,branches,backup };
    };
    const initial = await read();
    const gate = assessWorldCodeBootstrap(initial);
    console.log('WORLD_CODE_STAGE_GATE '+JSON.stringify(gate));
    if (!gate.ok) throw new Error('World staging conditions failed; no upload');
    const game = path.join(here,'..','game');
    const files=fs.readdirSync(game).filter(x=>x.endsWith('.js')).sort();
    const modules=Object.fromEntries(files.map(f=>[f.slice(0,-3),fs.readFileSync(path.join(game,f),'utf8')]));
    if (files.length < 8 || !modules.main || !modules.config ||
        !/VERSION\s*:/.test(modules.config)) throw new Error('Runtime code is not complete');
    // Fail closed on concurrent branch creation before any write.
    const latest = await api.userBranches();
    if (!assessWorldCodeBootstrap({...initial,branches:latest}).ok)
      throw new Error('World branch state changed before staging');
    await api._request('POST','/api/user/code',{branch:'chatgpt',modules});
    const [code,afterBranches,afterStatus] = await Promise.all([
      api._request('GET','/api/user/code',{branch:'chatgpt'}),
      api.userBranches(),api.userWorldStatus()
    ]);
    const newBranch=Array.isArray(afterBranches?.list) &&
      afterBranches.list.some(b=>b?.branch==='chatgpt' && b?.activeWorld!==true);
    const defaultStillActive=afterBranches?.list?.some(b=>b?.branch==='default'&&b?.activeWorld===true);
    if (!newBranch || !defaultStillActive || afterStatus?.status!=='empty' ||
        !verifyUploadedWorldModules(modules,code?.modules)) {
      throw new Error('Fail closed: World branch activation/state or upload verification failed');
    }
    const report={createdAt:new Date().toISOString(),server:'world',
      branch:'chatgpt',activated:false,worldStatus:'empty',moduleCount:files.length,
      sourceModuleHashes:Object.fromEntries(Object.entries(modules).map(([k,v])=>[k,hash(v)])),
      exactModuleBytesVerified:true,spawnPlacementPerformed:false};
    fs.writeFileSync(path.join(evidenceDir,'world-code-stage-receipt.json'),
      JSON.stringify(report,null,2)+'\n',{mode:0o600});
    console.log('WORLD_CODE_STAGED '+JSON.stringify({
      status:'PASS',server:'world',branch:'chatgpt',moduleCount:files.length,
      exactByteMatch:true,activeWorld:'default',spawnPlaced:false
    }));
  } finally {fs.rmSync(filename,{force:true});}
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(() => {console.error('World code bootstrap failed closed; see gate and workflow steps');process.exitCode=1;});
