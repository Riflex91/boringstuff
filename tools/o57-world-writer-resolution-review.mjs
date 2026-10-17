import crypto from 'node:crypto';

// Review-only remediation state model. O44's GitHub ref DELETE is unsafe:
// GET+DELETE cannot be performed atomically. A timeline record is NOT
// a GitHub ref, an operator approval, or a lock-release primitive.
const HOLD='O57_WRITER_LIFECYCLE_HOLD_';
const fail=x=>{throw new Error(HOLD+x);};
const HEX40=/^[a-f0-9]{40}$/;
export function inspectWorldWriterResolution({
 ownerTagSha,readbackTagSha,mutationOutcome,backupVerified,
 allCooperatingWritersPaused,operatorCaseId
}={}){
 if(typeof ownerTagSha!=='string'||!HEX40.test(ownerTagSha)||
    typeof readbackTagSha!=='string'||!HEX40.test(readbackTagSha))
    fail('IDENTITY');
 const issues=[];
 if(ownerTagSha!==readbackTagSha)issues.push('WRITER_OWNERSHIP_DRIFT');
 if(!['NOT_ATTEMPTED','ACKNOWLEDGED','UNCERTAIN'].includes(mutationOutcome))
    issues.push('UNKNOWN_MUTATION_OUTCOME');
 if(mutationOutcome==='UNCERTAIN')issues.push('GET_RECONCILIATION_REQUIRED');
 if(backupVerified!==true)issues.push('RECOVERY_BACKUP_NOT_VERIFIED');
 if(allCooperatingWritersPaused!==true)issues.push('COOPERATING_WRITERS_NOT_PAUSED');
 if(typeof operatorCaseId!=='string'||!/^[A-Z][A-Z0-9-]{5,60}$/.test(operatorCaseId))
    issues.push('OPERATOR_CASE_MISSING');
 return Object.freeze({
  state:issues.length?'HOLD':'OPERATOR_MANUAL_RECOVERY_REVIEW_ONLY',
  issues:Object.freeze(issues), ownerTagSha,readbackTagSha,
  mayDeleteGitRef:false,mayCreateReplacementRef:false,
  mayRetryWorldPost:false,mayUploadWorldCode:false,
  releaseAuthorized:false,
  requiresNewReviewedCASCapableLifecycle:true
 });
}
export function appendOfflineWriterIncidentRecord({
 priorDigest,ownerTagSha,stage,reason,observedAt
}={}){
 if(!/^[a-f0-9]{64}$/.test(priorDigest||'')||
    !HEX40.test(ownerTagSha||'')||
    !['LOCK_HELD','POST_UNCERTAIN','GET_RECONCILED','MANUAL_REVIEW'].includes(stage)||
    !/^[A-Z0-9_]{4,100}$/.test(reason||'')||
    typeof observedAt!=='string'||!Number.isFinite(Date.parse(observedAt)))
    fail('RECORD');
 const event=Object.freeze({schema:'O57_OFFLINE_WRITER_REVIEW_V1',
  priorDigest,ownerTagSha,stage,reason,observedAt});
 return Object.freeze({event,digest:crypto.createHash('sha256')
  .update(JSON.stringify(event)).digest('hex'),
  gitHubRefTouched:false,releaseAuthorized:false});
}
