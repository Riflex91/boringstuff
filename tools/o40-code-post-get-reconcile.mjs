import { assertUniqueActiveCodeBranch } from './o39-code-upload-active-branch-policy.mjs';

// O40: an unknown POST outcome is NEVER authorization to retry, rollback or
// generate a canonical deployment receipt. This read-only diagnostic avoids
// calling auth()/userBranches(): those convenience methods could perform a
// POST sign-in following a 401. Only preauthenticated GETs are permitted.
const hold = (classification, readbackExact = false) => Object.freeze({
  classification,
  readbackExact,
  mayRetryCodePost: false,
  mayRollback: false,
  mayWriteReceipt: false,
  canonicalLive100tPass: false,
  releaseAuthorized: false,
  requiresOperatorReview: true
});

export async function reconcileUncertainCodePostViaGet(api, branch, expectedModules) {
  if (!api || typeof api._request !== 'function' || !api.token ||
      typeof branch !== 'string' || !expectedModules ||
      typeof expectedModules !== 'object' || Array.isArray(expectedModules) ||
      Object.keys(expectedModules).length !== 82) {
    return hold('GET_NOT_SAFE_OR_EXPECTED_PAYLOAD_UNVERIFIED');
  }
  try {
    const opts = { retryAuth: false };
    // Drain both initiated reads before returning, even if one fails.
    // This prevents an orphaned GET from outliving the diagnostic decision.
    const inspected = await Promise.allSettled([
      api._request('GET', '/api/user/branches', {}, opts),
      api._request('GET', '/api/user/code', { branch }, opts)
    ]);
    if (inspected.some(result => result.status !== 'fulfilled'))
      return hold('GET_UNAVAILABLE_OUTCOME_UNKNOWN');
    const [branches, readback] = inspected.map(result => result.value);
    try {
      assertUniqueActiveCodeBranch(branches, branch);
    } catch {
      return hold('ACTIVE_BRANCH_UNVERIFIED_OUTCOME_UNKNOWN');
    }
    const actual = readback?.modules;
    const expectedNames = Object.keys(expectedModules).sort();
    const actualNames = actual && typeof actual === 'object' &&
      !Array.isArray(actual) ? Object.keys(actual).sort() : [];
    const exact = expectedNames.length === actualNames.length &&
      expectedNames.every((name, i) =>
        name === actualNames[i] &&
        typeof expectedModules[name] === 'string' &&
        expectedModules[name] === actual[name]);
    return hold(exact
      ? 'GET_READBACK_EXACT_BUT_POST_ACK_AND_RECEIPT_MISSING'
      : 'GET_READBACK_DIFFERENT_OUTCOME_UNKNOWN', exact);
  } catch {
    return hold('GET_UNAVAILABLE_OUTCOME_UNKNOWN');
  }
}
