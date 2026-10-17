import {pathToFileURL} from 'node:url';
import {assertGitHubEvidenceReadUrl} from './o55-readonly-network-boundaries.mjs';

export function verifyLiveRunEvidence(run,jobs,logs,expectedSha) {
 const failures=[];
 if(!/^[a-f0-9]{40}$/.test(expectedSha||'')||
    run?.head_sha!==expectedSha)failures.push('WRONG_EXACT_MAIN');
 if(run?.event!=='workflow_run'||run?.path!=='.github/workflows/screeps-auto-deploy.yml'||
    run?.status!=='completed'||run?.conclusion!=='success')
   failures.push('NEWBIELAND_LIVE_RUN_NOT_SUCCESSFUL');
 if(!Array.isArray(jobs)||!jobs.some(j=>j?.status==='completed'&&
    j?.conclusion==='success'))failures.push('NEWBIELAND_JOB_NOT_SUCCESSFUL');
 const passes=[];
 for(const line of (typeof logs==='string'?logs:'').split('\n')) {
   const start=line.indexOf('LIVE_100T_PASS ');
   if(start<0)continue;
   try {passes.push(JSON.parse(line.slice(start+'LIVE_100T_PASS '.length)));}catch {}
 }
 if(!passes.some(p=>p?.status==='PASS'&&Number.isInteger(p?.observedTicks)&&
    p.observedTicks>=100&&p?.bucket>=0))
   failures.push('REAL_100_TICK_EVIDENCE_MISSING');
 return {ok:failures.length===0,failures,
   observedTicks:passes.filter(p=>p?.status==='PASS').map(p=>p.observedTicks)
     .filter(n=>Number.isInteger(n)&&n>=100)[0]||null};
}

export async function githubGet(url,token,repository,runId,textMode=false){
 // O55: validate the final absolute URL before exposing GitHub token to
 // fetch. Never follow a 30x to a remote host with credentials.
 assertGitHubEvidenceReadUrl(url,repository,runId);
 const r=await fetch(url,{headers:{
   Accept:'application/vnd.github+json',
   Authorization:'Bearer '+token,
   'X-GitHub-Api-Version':'2022-11-28'
 },redirect:'manual'});
 if(!r.ok || r.redirected || r.type==='opaqueredirect')
   throw new Error('GITHUB_EVIDENCE_GET_FAILED_OR_REDIRECT_HOLD');
 return textMode?r.text():r.json();
}
async function main(){
 const token=process.env.GITHUB_TOKEN;
 const sha=process.env.WORLD_EXPECTED_MAIN_SHA;
 const id=process.env.WORLD_NEWBIELAND_LIVE_RUN_ID;
 const repository=process.env.GITHUB_REPOSITORY;
 if(!token||!/^[a-f0-9]{40}$/.test(sha||'')||
    !/^[0-9]{5,15}$/.test(id||'')||
    !/^[-\w]+\/[-\w.]+$/.test(repository||''))
   throw new Error('WORLD_LIVE_GATE_INPUT_INVALID');
 const root='https://api.github.com/repos/'+repository;
 const run=await githubGet(root+'/actions/runs/'+id,token,repository,id);
 const jobSet=await githubGet(root+'/actions/runs/'+id+'/jobs?per_page=100',token,repository,id);
 const jobs=Array.isArray(jobSet?.jobs)?jobSet.jobs:[];
 const candidates=jobs.filter(j=>j.status==='completed'&&j.conclusion==='success');
 let output={ok:false,failures:['REAL_100_TICK_EVIDENCE_MISSING']};
 for(const job of candidates) {
   let logs;
   try {logs=await githubGet(root+'/actions/jobs/'+job.id+'/logs',token,repository,id,true);}
   catch {continue;}
   output=verifyLiveRunEvidence(run,jobs,logs,sha);
   if(output.ok)break;
 }
 console.log('WORLD_FIRST_SPAWN_LIVE_GATE '+JSON.stringify(output));
 if(!output.ok)process.exitCode=2;
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url)
 main().catch(()=>{console.error('WORLD_FIRST_SPAWN_LIVE_GATE_UNVERIFIED');
 process.exitCode=1;});
