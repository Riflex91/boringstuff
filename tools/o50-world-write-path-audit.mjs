import fs from 'node:fs';
import path from 'node:path';

// O50 static conservative audit of this repository's World-capable scripts,
// public mutator exports and GitHub command entrypoints. Not a full JS
// call-graph, a security sandbox, or proof against independently coded clients.
export const LEGACY_WORLD_MUTATOR_EXPORTS=Object.freeze({
  'world-branch-bootstrap.mjs':['stageInactiveWorldCode'],
  'world-next-inactive-restage.mjs':['restageInactiveWorldCode'],
  'world-next-separate-inactive-stage.mjs':['stageSeparateInactiveCode'],
  'world-next-place-spawn.mjs':['placeW37S79Only'],
  'world-next-activate-spawn.mjs':['activateW37S79'],
  'world-first-spawn.mjs':['placePinnedWorldSpawn','activateVerifiedWorldSpawn']
});
export const WRITE_PATH_CLASSES=Object.freeze({
  'world-branch-bootstrap.mjs':'LEGACY_BLOCKED',
  'world-next-inactive-restage.mjs':'LEGACY_BLOCKED',
  'world-next-separate-inactive-stage.mjs':'LEGACY_BLOCKED',
  'world-next-place-spawn.mjs':'LEGACY_BLOCKED',
  'world-next-activate-spawn.mjs':'LEGACY_BLOCKED',
  'world-first-spawn.mjs':'LEGACY_BLOCKED',
  'deploy-live.mjs':'WORLD_DIRECT_BLOCKED',
  'screeps-client.mjs':'SHARED_HTTP_FIREWALL'
});
export const MUTATING_WORKFLOW_CLI=Object.freeze({
  'screeps-world-bootstrap.yml':'world-branch-bootstrap.mjs',
  'screeps-world-next-inactive-restage.yml':'world-next-inactive-restage.mjs',
  'screeps-world-next-separate-inactive-stage.yml':'world-next-separate-inactive-stage.mjs',
  'screeps-world-next-place-spawn.yml':'world-next-place-spawn.mjs',
  'screeps-world-next-activate-spawn.yml':'world-next-activate-spawn.mjs',
  'screeps-world-first-spawn.yml':'world-first-spawn.mjs',
  'screeps-world-deploy.yml':'deploy-live.mjs',
  'screeps-world-next-auto-deploy.yml':'deploy-live.mjs'
});
const failReason=(arr,file,reason)=>arr.push(file+':'+reason);
const mutationCandidate = /(?:_request\s*\(\s*['"](?:POST|PUT|PATCH|DELETE)['"]|(?:api|client)\.(?:userUploadCodeOnce|userSetActiveBranch|gamePlaceSpawn|gameCheckUniqueObjectName)\s*\(|(?:this|api)\._request\s*\(\s*['"]POST['"])/;
const missing=(str,word)=>!str.includes(word);

export function classifyWorldWriteSource(filename,source){
  if(typeof filename!=='string'||typeof source!=='string')
    throw new Error('O50_WRITE_AUDIT_INPUT');
  const errors=[];
  const exports=LEGACY_WORLD_MUTATOR_EXPORTS[filename]||[];
  const classification=WRITE_PATH_CLASSES[filename]||null;
  const hasPotentialMutation=mutationCandidate.test(source);
  if(hasPotentialMutation&&!classification && filename.startsWith('world-'))
    failReason(errors,filename,'UNREVIEWED_WORLD_MUTATION_SINK');
  if(classification==='LEGACY_BLOCKED'){
    for(const name of exports){
      const re=new RegExp('export\\s+async\\s+function\\s+'+name+'\\s*\\([^]*?\\)\\s*\\{');
      const match=re.exec(source);
      if(!match){failReason(errors,filename,'MISSING_EXPORT_'+name);continue;}
      const first=source.slice(match.index+match[0].length,
        match.index+match[0].length+430);
      if(!/assertLegacyWorldMutationDisabled\('legacy-[a-z-]+'\)/.test(first))
        failReason(errors,filename,'EXPORT_NOT_QUARANTINED_'+name);
    }
    // Deny command entrypoint, not only exported functions. Require the
    // guard at the beginning of the actual async main() body.
    const entry=/async function main\(\)\s*\{/.exec(source);
    if(!entry || !/assertLegacyWorldMutationDisabled\('legacy-[a-z-]+'\)/.test(
      source.slice(entry.index+entry[0].length,entry.index+entry[0].length+320)))
      failReason(errors,filename,'MAIN_NOT_QUARANTINED');
  }
  if(filename==='deploy-live.mjs'){
    const hold=source.indexOf('O43_WORLD_CODE_UPLOAD_HOLD_NO_APPROVED_TWO_PHASE_EXECUTOR');
    const auth=source.indexOf('ScreepsHttpClient.fromConfig(serverName)');
    const upload=source.indexOf('await api.userUploadCodeOnce(branch, modules)');
    if(hold<0||auth<hold||upload<auth||
      missing(source,"if (serverName === 'world')"))
      failReason(errors,filename,'WORLD_DIRECT_UPLOAD_HOLD_MISSING');
  }
  if(filename==='screeps-client.mjs'){
    const first=source.indexOf(
      'assertWorldHttpReadOnly(this.serverName, method, endpoint, this.server?.baseUrl)');
    const second=source.indexOf(
      'assertWorldHttpReadOnly(this.serverName, method, endpoint, configuredBaseUrl)');
    const strict=source.indexOf(
      'resolveSafeScreepsApiTarget(this.server?.baseUrl,endpoint)');
    const socket=source.indexOf('const req = transport.request(');
    if(first<0||second<first||strict<first||socket<second)
      failReason(errors,filename,'SHARED_HTTP_FIREWALL_MISSING');
    if(missing(source,'protectScreepsSocketSend(ws,this.http.serverName'))
      failReason(errors,filename,'WORLD_WS_COMMAND_FIREWALL_MISSING');
    for(const part of [
      "'POST', '/api/game/check-unique-object-name', this.server?.baseUrl",
      "'POST', '/api/game/place-spawn', this.server?.baseUrl",
      "'POST', '/api/user/code', this.server?.baseUrl",
      "'POST', '/api/user/set-active-branch', this.server?.baseUrl"
    ])if(missing(source,part))failReason(errors,filename,'WRAPPER_GUARD_MISSING');
  }
  return {filename,classification,hasPotentialMutation,exportCount:exports.length,
    errors};
}
export function auditWorldWritePaths(root){
  const dir=path.join(root,'tools'),workflowDir=path.join(root,'.github','workflows');
  const violations=[],records=[],workflows=[];
  const sourceFiles=fs.readdirSync(dir).filter(name=>
    name.endsWith('.mjs')&&!name.endsWith('.test.mjs')&&
    !name.endsWith('.bench.mjs')).sort();
  for(const filename of sourceFiles){
    const source=fs.readFileSync(path.join(dir,filename),'utf8');
    const result=classifyWorldWriteSource(filename,source);
    records.push(result);
    violations.push(...result.errors);
  }
  for(const file of Object.keys(WRITE_PATH_CLASSES))
    if(!records.some(r=>r.filename===file))
      failReason(violations,file,'REVIEWED_SOURCE_REMOVED');
  const workflowsFiles=fs.readdirSync(workflowDir).filter(name=>
    /\.ya?ml$/.test(name)).sort();
  for(const file of workflowsFiles){
    const source=fs.readFileSync(path.join(workflowDir,file),'utf8');
    const expected=MUTATING_WORKFLOW_CLI[file]||null;
    const scriptNames=Array.from(source.matchAll(
      /\bnode\s+(?:\.\/)?([a-z0-9._-]+\.mjs)\b/g)).map(x=>x[1]);
    const classified=expected!==null;
    if(expected&&!scriptNames.includes(expected))
      failReason(violations,file,'EXPECTED_GUARDED_SCRIPT_WIRING_LOST');
    if(!expected&&file.startsWith('screeps-world-')&&
       scriptNames.some(n=>WRITE_PATH_CLASSES[n]))
      failReason(violations,file,'UNREVIEWED_WORLD_WORKFLOW_WRITER');
    workflows.push({file,classified,expected,scriptNames});
  }
  for(const file of Object.keys(MUTATING_WORKFLOW_CLI))
    if(!workflows.some(w=>w.file===file))
      failReason(violations,file,'REVIEWED_WORKFLOW_REMOVED');
  return Object.freeze({
    sourceFiles:sourceFiles.length,workflowFiles:workflowsFiles.length,
    classifiedWorldWriterSources:records.filter(x=>x.classification).map(x=>x.filename),
    worldMutationCandidates:records.filter(x=>x.hasPotentialMutation&&
      x.filename.startsWith('world-')).map(x=>x.filename),
    guardedLegacyExports:records.reduce((n,x)=>n+x.exportCount,0),
    classifiedWorldWriterWorkflows:workflows.filter(x=>x.classified).map(x=>x.file),
    violations
  });
}
