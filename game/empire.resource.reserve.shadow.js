'use strict';

// M0 ResourceReserve shadow contract: inspect gross stock against explicit,
// time-bounded demands and commitments. NO ownership of Memory reservations,
// terminal execution, market orders, production, or available-to-spend stock.
const SCHEMA_VERSION = 1;
const MAX_COMMITMENTS = 128;
const MAX_AGE_TICKS = 25;
const MAX_PROJECTION_TICKS = 250;

function safeInteger(x) {
  return Number.isSafeInteger(x) && x >= 0;
}
function safeTick(x) {
  return safeInteger(x);
}
function safeName(x) {
  return typeof x === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(x) &&
    x !== '__proto__' && x !== 'constructor' && x !== 'prototype';
}
function safeResource(x) {
  return typeof x === 'string' && /^[A-Za-z0-9_]{1,50}$/.test(x) &&
    x !== '__proto__' && x !== 'constructor' && x !== 'prototype';
}
function sumChecked(values) {
  let total = 0;
  for(const amount of values) {
    if(!safeInteger(amount) || !Number.isSafeInteger(total + amount))
      return null;
    total += amount;
  }
  return total;
}
function hold(reason, roomName, resourceType, tick) {
  return {
    schemaVersion: SCHEMA_VERSION, authority: 'SHADOW', actionEnabled: false,
    status: 'HOLD', reasonCodes: [reason], roomName, resourceType, tick,
    currentStock: null, survivalReserve: null, forecastDemand: null,
    operationReservations: null, productionPipelineDemand: null,
    desiredBuffer: null, inboundForecast: null, outboundCommitted: null,
    totalProtected: null, upperBoundPotentialExcess: null,
    grossDeficit: null, availableToCommit: null,
    reservationProof: null, command: 'NO_ACTION', commitments: []
  };
}

// Policy and commitments are unverified upstream policy assertions.
// Validation proves only numeric and temporal consistency. A positive
// gross-stock upper bound NEVER proves terminal-accessible supply, collateral,
// settled transport, or permission to issue any action.
function analyze(ledger, roomName, resourceType, policy, commitments) {
  const tick = ledger && safeTick(ledger.tick) ? ledger.tick : null;
  const failure = code => hold(code, roomName, resourceType, tick);
  if(!safeName(roomName) || !safeResource(resourceType))
    return failure('RESOURCE_IDENTITY_INVALID');
  if(!ledger || ledger.schemaVersion !== 1 ||
      ledger.authority !== 'SHADOW' || ledger.actionEnabled !== false ||
      ledger.status !== 'OBSERVED' || ledger.availableToCommit !== null ||
      !safeTick(ledger.tick) || !Array.isArray(ledger.rooms) ||
      ledger.rooms.length < 1 || ledger.rooms.length > 25 ||
      ledger.rooms.some(r=>!r || !safeName(r.roomName) ||
        r.availableToCommit !== null) ||
      new Set(ledger.rooms.map(r=>r.roomName)).size !== ledger.rooms.length)
    return failure('LEDGER_UNVERIFIED');
  const room = ledger.rooms.find(r=>r.roomName === roomName);
  if(!room || !room.resources || !room.resources.structures ||
      typeof room.resources.structures !== 'object')
    return failure('ROOM_STOCK_UNVERIFIED');
  const stock = Object.prototype.hasOwnProperty.call(
    room.resources.structures, resourceType)
    ? room.resources.structures[resourceType] : 0;
  if(!safeInteger(stock)) return failure('ROOM_STOCK_UNVERIFIED');
  if(!policy || typeof policy !== 'object' || !safeName(policy.owner) ||
      !safeTick(policy.observedTick) || !safeTick(policy.expiresTick) ||
      policy.observedTick > ledger.tick ||
      ledger.tick - policy.observedTick > MAX_AGE_TICKS ||
      policy.expiresTick < ledger.tick ||
      policy.expiresTick - ledger.tick > MAX_PROJECTION_TICKS)
    return failure('POLICY_EVIDENCE_INVALID');
  const fields = [
    'survivalReserve','forecastDemand','productionPipelineDemand',
    'desiredBuffer','inboundForecast'
  ];
  if(fields.some(field=>!safeInteger(policy[field])))
    return failure('POLICY_AMOUNTS_INVALID');
  if(!Array.isArray(commitments) || commitments.length > MAX_COMMITMENTS)
    return failure('COMMITMENTS_UNVERIFIED');
  const seen = new Set();
  const normalized = [];
  for(const item of commitments) {
    if(!item || typeof item !== 'object' ||
        !safeName(item.id) || seen.has(item.id) ||
        !safeName(item.owner) || item.roomName !== roomName ||
        item.resourceType !== resourceType ||
        !safeInteger(item.amount) || item.amount === 0 ||
        !safeTick(item.createdTick) || !safeTick(item.expiresTick) ||
        item.createdTick > ledger.tick ||
        ledger.tick - item.createdTick > MAX_AGE_TICKS ||
        item.expiresTick < ledger.tick ||
        item.expiresTick - ledger.tick > MAX_PROJECTION_TICKS)
      return failure('COMMITMENT_INVALID_OR_EXPIRED');
    seen.add(item.id);
    normalized.push({
      id: item.id, owner: item.owner, amount: item.amount,
      createdTick: item.createdTick, expiresTick: item.expiresTick
    });
  }
  const outboundCommitted = sumChecked(normalized.map(x=>x.amount));
  if(outboundCommitted === null) return failure('RESERVE_AMOUNT_OVERFLOW');
  const operationReservations = outboundCommitted;
  const totalProtected = sumChecked([
    policy.survivalReserve,policy.forecastDemand,
    policy.productionPipelineDemand,policy.desiredBuffer,
    outboundCommitted
  ]);
  if(totalProtected === null) return failure('RESERVE_AMOUNT_OVERFLOW');
  // Inbound shipments are unconfirmed future income, so exclude from gross
  // surplus and deficit. Counting them would overstate safe-to-export stock.
  const upperBoundPotentialExcess = Math.max(0,stock-totalProtected);
  const grossDeficit = Math.max(0,totalProtected-stock);
  normalized.sort((a,b)=>a.id.localeCompare(b.id));
  return {
    schemaVersion: SCHEMA_VERSION, authority: 'SHADOW',
    actionEnabled: false, status: 'ADVISORY',
    reasonCodes: [], roomName, resourceType, tick: ledger.tick,
    currentStock: stock,
    survivalReserve: policy.survivalReserve,
    forecastDemand: policy.forecastDemand,
    operationReservations,
    productionPipelineDemand: policy.productionPipelineDemand,
    desiredBuffer: policy.desiredBuffer,
    inboundForecast: policy.inboundForecast,
    outboundCommitted, totalProtected,
    upperBoundPotentialExcess,grossDeficit,
    // Gross structures include spawns, containers and inaccessible stores.
    availableToCommit: null,reservationProof: null,
    command: 'NO_ACTION',commitments: normalized
  };
}

module.exports = { SCHEMA_VERSION, analyze };
