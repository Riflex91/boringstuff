'use strict';

// Read-only expansion budget observation. Never issues claim, move, or spawn intents.
const config = require('config');
const SCHEMA_VERSION = 1;
const nonNegativeInteger = value => Number.isSafeInteger(value) && value >= 0;

function evaluate(capabilities, roomStates, tickCpu) {
  const ownership = capabilities && capabilities.ownership || {};
  const cpu = capabilities && capabilities.cpu || {};
  const reasons = [];
  const ownedRooms = ownership.ownedRooms;
  const gclLevel = ownership.gclLevel;
  const commitments = ownership.activeClaimCommitments;
  const validCapacity = nonNegativeInteger(ownedRooms) &&
    nonNegativeInteger(gclLevel) && nonNegativeInteger(commitments);
  let availableClaimSlots = null;
  let capacitySource = 'UNVERIFIED';

  if (!validCapacity) {
    reasons.push('OWNERSHIP_CAPACITY_UNVERIFIED');
  } else {
    let cap = gclLevel;
    capacitySource = 'GCL_OBSERVED';
    const policyLimit = ownership.discoveredClaimLimit;
    if (policyLimit !== null && policyLimit !== undefined) {
      if (nonNegativeInteger(policyLimit) &&
          Number.isFinite(ownership.claimPolicyConfidence) &&
          ownership.claimPolicyConfidence >= 0.9) {
        cap = Math.min(cap, policyLimit);
        capacitySource = 'GCL_AND_VERIFIED_SERVER_POLICY';
      } else {
        reasons.push('CLAIM_POLICY_UNVERIFIED');
      }
    }
    availableClaimSlots = Math.max(0, cap - ownedRooms - commitments);
    if (availableClaimSlots === 0) reasons.push('NO_AVAILABLE_CLAIM_SLOT');
  }

  const limit = cpu.limit;
  const bucket = cpu.bucket;
  const cpuVerified = Number.isFinite(limit) && limit > 0 &&
    Number.isFinite(tickCpu) && tickCpu >= 0 && Number.isFinite(bucket);
  const minimumHeadroom = cpuVerified
    ? Math.max(config.SHADOW_CPU_RESERVE, Math.ceil(limit * 0.35))
    : null;
  const cpuHeadroom = cpuVerified ? Math.max(0, limit - tickCpu) : null;
  if (!cpuVerified) reasons.push('CPU_EVIDENCE_UNVERIFIED');
  else {
    if (cpuHeadroom < minimumHeadroom) reasons.push('CPU_HEADROOM_INSUFFICIENT');
    if (bucket < config.CPU_BUCKET_HEALTHY) reasons.push('CPU_BUCKET_NOT_HEALTHY');
  }

  const states = Array.isArray(roomStates) ? roomStates : [];
  if (!validCapacity || states.length !== ownedRooms) {
    reasons.push('OWNED_ROOM_STATES_INCOMPLETE');
  }
  const suitableParent = states.some(state => state && state.room &&
    state.room.controller && state.room.controller.my &&
    !(Number.isFinite(state.room.controller.safeMode) &&
      state.room.controller.safeMode > 0) &&
    !(Number.isFinite(state.room.controller.safeModeCooldown) &&
      state.room.controller.safeModeCooldown > 0) &&
    !!state.spawn && !state.emergency &&
    Number.isFinite(state.rcl) && state.rcl >= 4 &&
    state.health && state.health.status === 'HEALTHY' &&
    Array.isArray(state.hostileCreeps) && state.hostileCreeps.length === 0 &&
    state.economyModel &&
    Number.isFinite(state.economyModel.haulerCarryDeficit) &&
    state.economyModel.haulerCarryDeficit <= 0);
  if (!suitableParent) reasons.push('NO_HEALTHY_SUPPORTING_PARENT');

  const status = !validCapacity || !cpuVerified
    ? 'UNVERIFIED'
    : availableClaimSlots === 0 ? 'AT_CAPACITY'
      : reasons.length ? 'HOLD' : 'PLANNING_CANDIDATE';

  return {
    schemaVersion: SCHEMA_VERSION, authority: 'SHADOW', status,
    claimActionEnabled: false, selectedRoom: null,
    ownedRooms: nonNegativeInteger(ownedRooms) ? ownedRooms : null,
    gclLevel: nonNegativeInteger(gclLevel) ? gclLevel : null,
    activeClaimCommitments: nonNegativeInteger(commitments) ? commitments : null,
    availableClaimSlots, capacitySource,
    cpuLimit: Number.isFinite(limit) ? limit : null,
    cpuHeadroom, minimumHeadroom,
    cpuBucket: Number.isFinite(bucket) ? bucket : null,
    suitableParent, reasons
  };
}

module.exports = { SCHEMA_VERSION, evaluate };
