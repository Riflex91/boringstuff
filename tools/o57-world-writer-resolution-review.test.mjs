import assert from 'node:assert/strict';
import {
 inspectWorldWriterResolution,appendOfflineWriterIncidentRecord
} from './o57-world-writer-resolution-review.mjs';
const same='a'.repeat(40),other='b'.repeat(40);
const baseline={ownerTagSha:same,readbackTagSha:same,
 mutationOutcome:'NOT_ATTEMPTED',backupVerified:true,
 allCooperatingWritersPaused:true,operatorCaseId:'INCIDENT-WORLD-172'};
const reviewed=inspectWorldWriterResolution(baseline);
assert.equal(reviewed.state,'OPERATOR_MANUAL_RECOVERY_REVIEW_ONLY');
assert.equal(reviewed.mayDeleteGitRef,false);
assert.equal(reviewed.mayCreateReplacementRef,false);
assert.equal(reviewed.mayRetryWorldPost,false);
assert.equal(reviewed.releaseAuthorized,false);
for(const o of [
 {...baseline,readbackTagSha:other},
 {...baseline,mutationOutcome:'UNCERTAIN'},
 {...baseline,mutationOutcome:'UNEXPECTED'},
 {...baseline,backupVerified:false},
 {...baseline,allCooperatingWritersPaused:false},
 {...baseline,operatorCaseId:''}
]){
 const got=inspectWorldWriterResolution(o);
 assert.equal(got.state,'HOLD');
 assert.ok(got.issues.length>0);
 assert.equal(got.mayDeleteGitRef,false);
}
const event=appendOfflineWriterIncidentRecord({
 priorDigest:'0'.repeat(64),ownerTagSha:same,
 stage:'POST_UNCERTAIN',reason:'NO_ACKNOWLEDGEMENT',
 observedAt:'2026-10-17T16:00:00Z'
});
assert.match(event.digest,/^[a-f0-9]{64}$/);
assert.equal(event.gitHubRefTouched,false);
assert.equal(event.releaseAuthorized,false);
assert.notEqual(event.digest,appendOfflineWriterIncidentRecord({
 ...event.event,reason:'GET_RECONCILIATION_REQUIRED'
}).digest);
assert.throws(()=>appendOfflineWriterIncidentRecord({
 ...event.event,stage:'DELETE_LOCK'
}),/O57_WRITER_LIFECYCLE_HOLD_/);
console.log('O57 CAS-less Git-ref delete always disabled, uncertain writers held, offline chained audit: PASS');
