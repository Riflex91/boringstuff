// O39: a prior preflight cannot authorize an upload if the active branch has
// since switched. This pure check must execute before any Screeps code POST.
// In particular, ambiguous, absent or historical active-world metadata
// always fail closed. This is NOT a release-approval decision.
export function assertUniqueActiveCodeBranch(branches, requestedBranch) {
  if (typeof requestedBranch !== 'string' ||
      !/^[a-zA-Z0-9_-]{1,80}$/.test(requestedBranch) ||
      !Array.isArray(branches?.list) ||
      branches.list.length < 1 || branches.list.length > 100 ||
      branches.list.some(entry => !entry || typeof entry.branch !== 'string' ||
        typeof entry.activeWorld !== 'boolean')) {
    throw new Error('CODE_UPLOAD_HOLD_ACTIVE_BRANCH_DATA_UNVERIFIED');
  }
  const branchesByName = new Set();
  for (const entry of branches.list) {
    if (branchesByName.has(entry.branch))
      throw new Error('CODE_UPLOAD_HOLD_DUPLICATE_BRANCH');
    branchesByName.add(entry.branch);
  }
  const active = branches.list.filter(entry => entry.activeWorld === true);
  if (active.length !== 1 || active[0].branch !== requestedBranch)
    throw new Error('CODE_UPLOAD_HOLD_EXACT_ACTIVE_BRANCH_NOT_VERIFIED');
  return Object.freeze({ verified: true, requestedBranch });
}
