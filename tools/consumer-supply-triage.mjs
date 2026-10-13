// E4 evidence triage is an OFFLINE, read-only interpretation of independently
// validated samples. It must never issue a live job, mutate Memory, or claim
// energy transfer settlement from post-intent snapshots.
const nonnegative = x => Number.isSafeInteger(x) && x >= 0;
const GAP_CODES = Object.freeze([
  'DUPLICATE_STICKY_TARGET',
  'EMPTY_ENERGY_STICKY',
  'STICKY_NOT_DELIVERY_READY',
  'READY_HAULER_WITHOUT_CRITICAL_ASSIGNMENT',
  'NO_SPARE_GUARD_CAPACITY',
  'NO_READY_HAULERS',
  'CRITICAL_READY_COVERAGE_GAP'
]);

export function triageSupplySample(sample) {
  const c = sample && sample.consumers;
  const h = sample && sample.haulers;
  const v = sample && sample.reservationCoverage;
  const unknown = reason => ({
    classification:'UNKNOWN', evidenceReason:reason,
    reasonCodes:[], criticalCount:null, uncoveredCriticalCount:null,
    actionAuthority:'NONE', causalProof:false, settledDeliveryProof:false
  });
  if (!c || !nonnegative(c.critical) || !h ||
      !nonnegative(h.readyByGuardRule) || !nonnegative(h.live))
    return unknown('INVALID_OR_MISSING_CONSUMER_COUNTS');
  if (c.critical === 0) return {
    classification:'NO_CRITICAL_AT_SAMPLE',
    evidenceReason:'OBSERVED_NO_CRITICAL_CONSUMERS',
    reasonCodes:[], criticalCount:0, uncoveredCriticalCount:0,
    actionAuthority:'NONE', causalProof:false, settledDeliveryProof:false
  };
  if (!v) return {
    ...unknown('RESERVATION_COVERAGE_NOT_OBSERVED'),
    criticalCount:c.critical
  };
  if (v.acceptedDeliveryProof !== false)
    return unknown('UNSUPPORTED_DELIVERY_SETTLEMENT_CLAIM');
  for (const key of ['criticalWithReadySticky','criticalWithoutReadySticky',
    'criticalWithSticky','criticalWithoutSticky',
    'criticalWithDuplicateSticky','stickyWithoutEnergy',
    'readyHaulersWithoutSticky','stickyAssignments']) {
    if (!nonnegative(v[key])) return unknown('INVALID_RESERVATION_COVERAGE');
  }
  if (v.criticalWithReadySticky + v.criticalWithoutReadySticky !== c.critical ||
      v.criticalWithSticky + v.criticalWithoutSticky !== c.critical ||
      v.criticalWithReadySticky > v.criticalWithSticky ||
      v.criticalWithSticky > v.stickyAssignments ||
      v.criticalWithDuplicateSticky > v.criticalWithSticky ||
      v.stickyWithoutEnergy > v.stickyAssignments ||
      v.readyHaulersWithoutSticky > h.readyByGuardRule ||
      v.stickyAssignments > h.live)
    return unknown('INCONSISTENT_RESERVATION_COVERAGE');
  const reasons=[];
  if (v.criticalWithDuplicateSticky > 0)
    reasons.push('DUPLICATE_STICKY_TARGET');
  if (v.stickyWithoutEnergy > 0)
    reasons.push('EMPTY_ENERGY_STICKY');
  if (v.criticalWithSticky > v.criticalWithReadySticky)
    reasons.push('STICKY_NOT_DELIVERY_READY');
  if (v.criticalWithoutReadySticky > 0 &&
      v.readyHaulersWithoutSticky > 0) {
    // The production guard always keeps at least one ready hauler outside
    // consumer-first service for spawn/extensions. A ready carrier without
    // sticky assignment is not automatically a missed assignment when all
    // consumer guard slots are already occupied (or only one is ready).
    // This is a policy-capacity observation, not proof of infrastructure
    // demand or of an attempted/settled consumer transfer.
    const availableGuardSlots = Math.max(0, h.readyByGuardRule - 1);
    reasons.push(v.criticalWithReadySticky >= availableGuardSlots ?
      'NO_SPARE_GUARD_CAPACITY' :
      'READY_HAULER_WITHOUT_CRITICAL_ASSIGNMENT');
  }
  if (v.criticalWithoutReadySticky > 0 &&
      h.readyByGuardRule === 0)
    reasons.push('NO_READY_HAULERS');
  if (v.criticalWithoutReadySticky > 0)
    reasons.push('CRITICAL_READY_COVERAGE_GAP');
  return {
    classification: v.criticalWithoutReadySticky > 0 ?
      'CRITICAL_COVERAGE_GAP_OBSERVED' : 'READY_STICKY_COVERAGE_OBSERVED',
    evidenceReason: v.criticalWithoutReadySticky > 0 ?
      'POST_INTENT_COVERAGE_SNAPSHOT' : 'POST_INTENT_COVERAGE_NOT_DELIVERY',
    reasonCodes:reasons, criticalCount:c.critical,
    uncoveredCriticalCount:v.criticalWithoutReadySticky,
    actionAuthority:'NONE', causalProof:false, settledDeliveryProof:false
  };
}

// A repeated pattern is only reportable when three consecutive 25-tick samples
// for the same deployment and room show the same primary observed gap. Missing
// diagnostics, UNKNOWN/coverage-positive snapshots and any cadence break reset.
export function repeatedSupplyObservations(samples) {
  const result=[];
  let run=null;
  for (const s of (Array.isArray(samples) ? samples : []).slice()
    .filter(s=>s&&nonnegative(s.tick))
    .sort((a,b)=>a.tick-b.tick)) {
    // Never trust a preattached classification; revalidate raw counts.
    const t=triageSupplySample(s);
    const reason=(t.classification==='CRITICAL_COVERAGE_GAP_OBSERVED' &&
      t.reasonCodes.find(x=>GAP_CODES.includes(x))) || null;
    if (!reason) {
      if (run&&run.sampleCount>=3) result.push({...run});
      run=null;continue;
    }
    if (run&&s.tick===run.endTick+25&&reason===run.reasonCode) {
      run.endTick=s.tick;run.sampleCount++;run.maximumUncoveredCritical=
        Math.max(run.maximumUncoveredCritical,t.uncoveredCriticalCount);
    } else {
      if (run&&run.sampleCount>=3) result.push({...run});
      run={reasonCode:reason,startTick:s.tick,endTick:s.tick,sampleCount:1,
        maximumUncoveredCritical:t.uncoveredCriticalCount,
        classification:'REPEATED_ASSOCIATION_NOT_CAUSAL',
        actionAuthority:'NONE', causalProof:false,
        settledDeliveryProof:false};
    }
  }
  if (run&&run.sampleCount>=3) result.push({...run});
  return result;
}
