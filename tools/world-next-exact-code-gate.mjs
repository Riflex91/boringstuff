import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyStagedWorldCode} from './world-target-preflight.mjs';
import {assessPreActivationWorldBranches} from './world-first-spawn.mjs';

export function assessW37S79ExactCode(branchState,code) {
  const failures=[];
  const active=assessPreActivationWorldBranches(branchState);
  if(!active.ok)failures.push('DEFAULT_ACTIVE_CHATGPT_INACTIVE_REQUIRED');
  if(code?.status!=='EXACT_INACTIVE_CODE'||code?.exactSourceMatch!==true)
    failures.push('EXACT_TESTED_MAIN_CODE_NOT_STAGED');
  return {ok:failures.length===0,failures,
    exactInactiveCode:failures.length===0,
    activationAuthorized:false,placementAuthorized:false};
}
export async function inspectW37S79ExactCode(api) {
  const game=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','game');
  const files=fs.readdirSync(game).filter(n=>n.endsWith('.js')).sort();
  if(files.length<8)throw new Error('INSUFFICIENT_TESTED_GAME_MODULES');
  const expected=Object.fromEntries(files.map(n=>[n.slice(0,-3),
    fs.readFileSync(path.join(game,n),'utf8')]));
  const branches=await api.userBranches();
  const code=await verifyStagedWorldCode(api,branches?.list,expected);
  return assessW37S79ExactCode(branches,code);
}
