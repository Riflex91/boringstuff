import crypto from 'node:crypto';

// O44, opt-in proof only. A single fixed GitHub Git-ref is an atomic,
// cross-process *cooperating writer* exclusion point. Neither this protocol
// nor the transport below interacts with a Screeps API or authorizes a POST.
// Existing World deploy-live.mjs remains hard-blocked.
const ROOT = 'refs/tags/locks/screeps-world-code-writer';
const REF_PATH = '/git/ref/tags/locks/screeps-world-code-writer';
const hex40 = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const fail = reason => { throw new Error('O44_WRITER_LOCK_HOLD_' + reason); };
const DENIAL = Object.freeze({
  mayUploadWorldCode:false, mayRetryCodePost:false,
  mayWriteDeploymentReceipt:false, releaseAuthorized:false,
  canonicalLive100tPass:false, requiresApprovedExecutor:true
});
const lockState = (tagSha,runId) => Object.freeze({
  scope:'world', ref:ROOT, ownerTagSha:tagSha, ownerRunId:runId,
  lockHeld:true,...DENIAL
});

function requestArgs(transport,commit,runId) {
  if (typeof transport!=='function' || !hex40(commit) ||
      typeof runId!=='string' || !/^[1-9][0-9]{0,19}$/.test(runId))
    fail('PARAMETERS');
}
async function send(transport,method,route,body) {
  // The transport contract is ONE HTTP attempt. Network, 429, 5xx,
  // redirects, 401 and ambiguous answers must never repeat mutations.
  try {
    const response=await transport({method,path:route,body});
    if (!response || !Number.isInteger(response.status) ||
        response.status<100 || response.status>599) fail('TRANSPORT_RESPONSE');
    return response;
  } catch {
    fail('TRANSPORT_OUTCOME_UNCERTAIN_NO_RETRY');
  }
}
function refSha(response) {
  const object=response?.data?.object;
  if (response.status!==200 || response.data?.ref!==ROOT ||
      object?.type!=='tag' || !hex40(object.sha))
    fail('REFERENCE_UNVERIFIED');
  return object.sha;
}
async function readRef(transport) {
  const response=await send(transport,'GET',REF_PATH);
  if (response.status===404) return null;
  return refSha(response);
}

// Tag object carries only public commit SHA, run ID, and unique nonce.
// It is not a deploy receipt. GitHub's create-ref operation is atomic;
// 409/422/timeout leave us in HOLD (never retry an ambiguous POST).
export async function acquireWorldWriterFence({
  transport, pinnedCommit, runId
}) {
  requestArgs(transport,pinnedCommit,runId);
  if (await readRef(transport)!==null) fail('HELD_BY_ANOTHER_RUN');
  const nonce=crypto.randomBytes(24).toString('hex');
  const tagResponse=await send(transport,'POST','/git/tags',{
    tag:'locks/screeps-world-code-writer',
    message:JSON.stringify({protocol:'O44_SINGLE_WRITER_V1',runId,
      nonce,pinnedCommit}),
    object:pinnedCommit,type:'commit'
  });
  if (tagResponse.status!==201 || !hex40(tagResponse.data?.sha))
    fail('TAG_OBJECT_NOT_ACKNOWLEDGED_NO_RETRY');
  const tagSha=tagResponse.data.sha;
  const create=await send(transport,'POST','/git/refs',{
    ref:ROOT,sha:tagSha
  });
  if (create.status!==201 || create.data?.ref!==ROOT ||
      create.data?.object?.type!=='tag' ||
      create.data?.object?.sha!==tagSha)
    fail('CREATE_REF_UNCERTAIN_NO_RETRY');
  // GET is evidence of ownership; a matching read after an uncertain
  // creation is NOT proof that its POST acknowledgement was successful.
  if (await readRef(transport)!==tagSha) fail('OWNERSHIP_NOT_VERIFIED');
  return lockState(tagSha,runId);
}

export async function inspectWorldWriterFence({transport,held}) {
  if (typeof transport!=='function' || held?.scope!=='world' ||
      held?.ref!==ROOT || !held.lockHeld || !hex40(held.ownerTagSha))
    fail('OWNER_PROOF_INVALID');
  const sha=await readRef(transport);
  if (sha!==held.ownerTagSha) fail('OWNERSHIP_LOST');
  return lockState(sha,held.ownerRunId);
}

// O45: the REST Git-ref DELETE endpoint has no atomic "delete only if
// current SHA equals owner SHA" precondition. An owner GET followed by DELETE
// is subject to a TOCTOU race: another writer might replace the ref between
// requests and the old holder could delete the new holder's lock.
// Therefore NO caller, even one with the operator phrase and a resolved
// mutation outcome, may perform DELETE through this helper. An external
// operator-controlled CAS-capable cleanup design must be reviewed first.
export async function releaseWorldWriterFence({
  transport,held,operatorReleasePhrase,mutationOutcomeResolved
}) {
  if (operatorReleasePhrase!=='RELEASE_WORLD_WRITER_LOCK' ||
      mutationOutcomeResolved!==true) fail('EXPLICIT_REVIEW_REQUIRED');
  // Confirm for diagnostics only: even matching ownership is not permission
  // to delete because it can change immediately afterward.
  await inspectWorldWriterFence({transport,held});
  fail('UNSAFE_NON_ATOMIC_REF_DELETE_DISABLED');
}

// Real GitHub REST adapter for a future manually controlled operator workflow.
// No automatic retries or redirects, no global token storage, only fixed repo
// and fixed endpoint. NEVER invoked by offline CI; CI tests use loopback mocks.
export function createGithubWriterFenceTransport({
  githubToken, repository='Riflex91/boringstuff',
  baseUrl='https://api.github.com'
}) {
  if (repository!=='Riflex91/boringstuff' ||
      typeof githubToken!=='string' || githubToken.length<12)
    fail('GITHUB_CREDENTIALS');
  const base=new URL(baseUrl);
  if (base.origin!=='https://api.github.com' ||
      base.pathname!=='/' || base.search || base.hash)
    fail('UNTRUSTED_GITHUB_ENDPOINT');
  return async ({method,path,body}) => {
    if (!['GET','POST'].includes(method) ||
        ![REF_PATH,'/git/tags','/git/refs'].includes(path) ||
        (method==='GET'&&path!==REF_PATH) ||
        (method==='POST'&&!['/git/tags','/git/refs'].includes(path)))
      fail('UNEXPECTED_REQUEST');
    const response=await fetch('https://api.github.com/repos/'+repository+path,{
      method,redirect:'error',signal:AbortSignal.timeout(12000),
      headers:{'Accept':'application/vnd.github+json',
        'Authorization':'Bearer '+githubToken,
        'X-GitHub-Api-Version':'2022-11-28',
        ...(method==='POST'?{'Content-Type':'application/json'}:{})},
      ...(method==='POST'?{body:JSON.stringify(body)}:{})
    });
    // The response body may contain an error with sensitive request data.
    // Discard it entirely for non-success statuses.
    let data=null;
    if (response.status===200 || response.status===201) {
      try { data=await response.json(); }
      catch { fail('GITHUB_JSON_INVALID'); }
    }
    return {status:response.status,data};
  };
}
