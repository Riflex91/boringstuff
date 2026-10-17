import path from 'node:path';

// O55: GitHub evidence fetches carry an Actions token. A checked-in,
 // user-controlled, or API-supplied URL must never choose its destination.
// Whitelist only the exact repository/run/job URLs needed by the old
// evidence reader. Redirects are refused by the caller before they can
// follow a GitHub-supplied Location.
export const EVIDENCE_URL_HOLD='O55_GITHUB_EVIDENCE_URL_HOLD';
export const SCOUT_ENV_HOLD='O55_SCOUT_CHILD_ENV_HOLD';
const refuse=(reason)=>{throw new Error(reason);};
const decimal=x=>typeof x==='string'&&/^[0-9]{5,15}$/.test(x);
const repoName=x=>typeof x==='string'&&
  /^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(x);

export function assertGitHubEvidenceReadUrl(input,repository,runId){
  if(typeof input!=='string'||input.length>512||
     !repoName(repository)||!decimal(String(runId)))refuse(EVIDENCE_URL_HOLD);
  let url;
  try{url=new URL(input);}catch{refuse(EVIDENCE_URL_HOLD);}
  if(url.protocol!=='https:'||url.hostname!=='api.github.com'||
     url.port||url.username||url.password||url.hash||
     url.href!==input)refuse(EVIDENCE_URL_HOLD);
  const prefix='https://api.github.com/repos/'+repository;
  const run=prefix+'/actions/runs/'+runId;
  if(input===run)return Object.freeze({kind:'run'});
  if(input===run+'/jobs?per_page=100')
    return Object.freeze({kind:'jobs'});
  const logs=prefix+'/actions/jobs/';
  if(input.startsWith(logs)&&input.endsWith('/logs')&&!url.search){
    const id=input.slice(logs.length,-'/logs'.length);
    if(decimal(id))return Object.freeze({kind:'job-logs'});
  }
  refuse(EVIDENCE_URL_HOLD);
}

// Only these explicit keys reach the read-only planner child. Inheriting
// process.env spread would also inherit NODE_OPTIONS / NODE_PATH (which may
// execute code BEFORE the CLI's World --place HOLD), LD_PRELOAD, credentials,
// and unrelated CI authorization. No secret/token is passed by environment.
export function buildWorldScoutChildEnv(parentEnv,configFile,logDir){
  if(!parentEnv||typeof parentEnv!=='object'||
     typeof configFile!=='string'||!path.isAbsolute(configFile)||
     typeof logDir!=='string'||!path.isAbsolute(logDir))
    refuse(SCOUT_ENV_HOLD);
  const executablePath=parentEnv.PATH;
  if(typeof executablePath!=='string'||executablePath.length>8192||
     executablePath.includes('\0'))refuse(SCOUT_ENV_HOLD);
  if(configFile.includes('\0')||logDir.includes('\0'))refuse(SCOUT_ENV_HOLD);
  return Object.freeze({
    PATH:executablePath,
    SCREEPS_CONFIG:configFile,
    SCREEPS_LOG_DIR:logDir
  });
}
