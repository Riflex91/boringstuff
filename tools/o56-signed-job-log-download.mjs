// O56: second-hop GitHub Actions job-log download ONLY. A 302 from the
// exact authenticated GitHub jobs/:id/logs endpoint can return an expiring
// signed object URL. Never forward the GitHub bearer token or other headers
// to that URL, never follow another redirect, and never trust arbitrary hosts.
// Pure URL checks can be unit-tested without any real network connection.
export const O56_LOG_REDIRECT_HOLD='O56_JOB_LOG_REDIRECT_HOLD';
export const O56_LOG_SIZE_HOLD='O56_JOB_LOG_MAX_BYTES_HOLD';
export const MAX_JOB_LOG_BYTES=8*1024*1024;
const refuse=reason=>{throw new Error(reason);};

function signedDownloadHost(hostname) {
  return hostname==='pipelines.actions.githubusercontent.com' ||
    /^productionresultssa[0-9]{1,3}\.blob\.core\.windows\.net$/.test(hostname);
}
export function assertSignedJobLogLocation(location) {
  if(typeof location!=='string'||location.length<12||location.length>8192||
     /[\x00-\x1f\x7f\\]/.test(location))refuse(O56_LOG_REDIRECT_HOLD);
  let u;
  try{u=new URL(location);}catch{refuse(O56_LOG_REDIRECT_HOLD);}
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||
     u.href!==location||!signedDownloadHost(u.hostname)||
     !u.pathname.startsWith('/')||u.pathname.startsWith('//')||
     u.pathname==='/'||/%(?:2e|2f|5c|00)/i.test(u.pathname)||
     u.pathname.includes('..'))refuse(O56_LOG_REDIRECT_HOLD);
  if(u.hostname.endsWith('.blob.core.windows.net')){
    if(!u.pathname.startsWith('/actions-results/')||
       u.searchParams.get('sp')!=='r'||
       !u.searchParams.get('sig')||!u.searchParams.get('se')||
       u.searchParams.getAll('sig').length!==1)
      refuse(O56_LOG_REDIRECT_HOLD);
  }
  // Do not return or print this signed capability URL in diagnostics.
  return Object.freeze({allowed:true,kind:
    u.hostname.endsWith('.blob.core.windows.net')?'azure-actions-results':'github-actions-cdn'});
}
export async function readBoundedJobLog(response,maxBytes=MAX_JOB_LOG_BYTES) {
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_JOB_LOG_BYTES||
     !response?.body||typeof response.body.getReader!=='function')
    refuse(O56_LOG_SIZE_HOLD);
  const reader=response.body.getReader();
  let total=0;
  const chunks=[];
  try{
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      if(!(value instanceof Uint8Array))refuse(O56_LOG_SIZE_HOLD);
      total+=value.byteLength;
      if(total>maxBytes){
        await reader.cancel().catch(()=>{});
        refuse(O56_LOG_SIZE_HOLD);
      }
      chunks.push(Buffer.from(value));
    }
    return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,total));
  }catch{
    refuse(O56_LOG_SIZE_HOLD);
  }finally{
    reader.releaseLock();
  }
}
export async function followOneSignedJobLogRedirect(response) {
  if(response?.status!==302||response.redirected===true||
     response.type==='opaqueredirect'||typeof response.headers?.get!=='function')
    refuse(O56_LOG_REDIRECT_HOLD);
  const location=response.headers.get('location');
  assertSignedJobLogLocation(location);

  // This is a completely NEW request with no Authorization and no GitHub
  // token material. Manual mode stops automatic redirects at this hop.
  let downloaded;
  try{
    downloaded=await fetch(location,{
      method:'GET',
      redirect:'manual',
      headers:{Accept:'text/plain'},
      cache:'no-store',
      signal:AbortSignal.timeout(15000)
    });
  }catch{
    // A failed fetch may embed the signed capability URL in the thrown
    // TypeError/cause. Do not forward that error into CI logs or reports.
    refuse(O56_LOG_REDIRECT_HOLD);
  }
  if(!downloaded||!downloaded.ok||
     downloaded.status!==200||downloaded.redirected||
     downloaded.type==='opaqueredirect')refuse(O56_LOG_REDIRECT_HOLD);
  return readBoundedJobLog(downloaded);
}
