'use strict';

// M1 advisory-only cost comparison. This module NEVER issues terminal, market
// or resource-reservation intents. Gross ledger inventory is not spendable.
const SCHEMA_VERSION = 1;
const MAX_OFFERS = 16;
const MAX_AMOUNT = 1000000;
const MAX_CREDIT_VALUE = 1e9;
const MAX_EVIDENCE_AGE_TICKS = 25;

function safeAmount(n) {
  return Number.isSafeInteger(n) && n >= 0 && n <= MAX_AMOUNT;
}
function safeCost(n) {
  return typeof n === 'number' && Number.isFinite(n) &&
    n >= 0 && n <= MAX_CREDIT_VALUE;
}
function safeTick(n) {
  return Number.isSafeInteger(n) && n >= 0;
}
function roomByName(ledger, roomName) {
  return ledger.rooms.find(x => x && x.roomName === roomName);
}
function hasTerminal(room) {
  return !!(room && room.productionInfrastructure &&
    Number.isSafeInteger(room.productionInfrastructure.terminals) &&
    room.productionInfrastructure.terminals > 0);
}
// Explicit terminal-local inventory: an observed resource somewhere in the
// room is not necessarily available in a terminal or able to pay send cost.
function terminalAmount(room, resource) {
  const stock = room && room.resources && room.resources.terminal;
  if (!stock || typeof stock !== 'object') return null;
  const n = Object.prototype.hasOwnProperty.call(stock, resource)
    ? stock[resource] : 0;
  return safeAmount(n) ? n : null;
}
function terminalCanPay(room, offer) {
  const energy = terminalAmount(room, 'energy');
  return safeAmount(offer.transactionEnergy) && energy !== null &&
    energy >= offer.transactionEnergy;
}
// An observed terminal Store is a component of gross owned structures,
// never an independent source of inventory. A malformed or independently
// inflated terminal census must not create a nominal MARKET_BUY fee payer or
// a source terminal with resources absent from the room's gross stock.
function terminalProvenanceConsistent(room) {
  const gross = room?.resources?.structures;
  const terminal = room?.resources?.terminal;
  const count = room?.productionInfrastructure?.terminals;
  if (!gross || typeof gross !== 'object' || Array.isArray(gross) ||
      !terminal || typeof terminal !== 'object' ||
      Array.isArray(terminal) || !Number.isSafeInteger(count) ||
      count < 0) return false;
  for (const amount of Object.values(gross))
    if (!Number.isSafeInteger(amount) || amount < 0) return false;
  const terminalEntries = Object.entries(terminal);
  if (count === 0 && terminalEntries.length > 0) return false;
  for (const [resource, amount] of terminalEntries) {
    const observed = Object.prototype.hasOwnProperty.call(gross, resource)
      ? gross[resource] : 0;
    if (!Number.isSafeInteger(amount) || amount < 0 ||
        !Number.isSafeInteger(observed) || amount > observed) return false;
  }
  return true;
}
function validatedLedger(ledger) {
  return ledger && ledger.schemaVersion === 1 &&
    ledger.authority === 'SHADOW' && ledger.actionEnabled === false &&
    ledger.status === 'OBSERVED' && safeTick(ledger.tick) &&
    Array.isArray(ledger.rooms) && ledger.rooms.length > 0 &&
    ledger.rooms.length <= 25 &&
    ledger.rooms.every(r => r && typeof r.roomName === 'string' &&
      r.resources && r.resources.structures &&
      r.resources.terminal && typeof r.resources.terminal === 'object' &&
      r.productionInfrastructure &&
      terminalProvenanceConsistent(r) &&
      r.availableToCommit === null) &&
    new Set(ledger.rooms.map(r => r.roomName)).size === ledger.rooms.length &&
    ledger.availableToCommit === null;
}
function quoteFresh(proof, tick) {
  return proof && proof.verified === true &&
    safeTick(proof.asOfTick) && safeTick(proof.expiresTick) &&
    proof.asOfTick <= tick &&
    tick - proof.asOfTick <= MAX_EVIDENCE_AGE_TICKS &&
    proof.expiresTick >= tick;
}
function boundedNumber(n) {
  return safeCost(n) && n <= MAX_CREDIT_VALUE;
}
function score(offer, request, market) {
  if (!offer || typeof offer !== 'object' ||
      !quoteFresh(offer.evidence, request.tick) ||
      !safeAmount(offer.amount) || offer.amount !== request.amount ||
      !safeAmount(offer.transactionEnergy) ||
      !boundedNumber(offer.energyShadowPrice) ||
      !boundedNumber(offer.terminalOpportunityCost) ||
      !safeAmount(offer.arrivalDelayTicks)) return null;
  const energyCost = offer.transactionEnergy * offer.energyShadowPrice;
  const urgentCost = offer.arrivalDelayTicks * request.urgencyPerTickCredits;
  let baseCost;
  if (market) {
    if (!boundedNumber(offer.pricePerUnit)) return null;
    baseCost = request.amount * offer.pricePerUnit;
  } else {
    if (!boundedNumber(offer.reserveOpportunityCostPerUnit)) return null;
    baseCost = request.amount * offer.reserveOpportunityCostPerUnit;
  }
  const effectiveCost = energyCost + urgentCost + baseCost +
    offer.terminalOpportunityCost;
  if (!Number.isFinite(effectiveCost) || effectiveCost > MAX_CREDIT_VALUE)
    return null;
  return {
    offerId: offer.id,
    kind: market ? 'MARKET_BUY' : 'INTERNAL_TRANSFER',
    sourceRoom: market ? null : offer.sourceRoom,
    resourceType: request.resourceType,
    amount: request.amount,
    effectiveCost,
    cost: {
      resourceOrReserve: baseCost,
      transactionEnergy: energyCost,
      terminalOpportunity: offer.terminalOpportunityCost,
      urgencyDelay: urgentCost
    },
    readyForExecution: false
  };
}
function validReserve(offer, source, request) {
  const p = offer.reserveProof;
  if (!quoteFresh(p, request.tick) || p.roomName !== offer.sourceRoom ||
      p.resourceType !== request.resourceType ||
      !safeAmount(p.observedStructureStock) ||
      !safeAmount(p.strategicReserve) ||
      !safeAmount(p.committedAmount) ||
      typeof p.owner !== 'string' || !p.owner) return false;
  const observed = source && source.resources &&
    source.resources.structures &&
    source.resources.structures[request.resourceType];
  if (!safeAmount(observed) || observed !== p.observedStructureStock)
    return false;
  const available = observed - p.strategicReserve - p.committedAmount;
  const terminalStock = terminalAmount(source, request.resourceType);
  const requiredStock = request.amount +
    (request.resourceType === 'energy' ? offer.transactionEnergy : 0);
  // Sending energy consumes both the exported amount AND transaction cost
  // from the source terminal; minerals consume their own quantity plus
  // transaction energy. Gross room stock alone cannot prove either condition.
  return safeAmount(offer.transactionEnergy) && safeAmount(requiredStock) &&
    terminalStock !== null && terminalStock >= requiredStock &&
    terminalCanPay(source, offer) &&
    // When exporting ENERGY the terminal transaction fee also consumes
    // protected energy reserves. An amount-only gross-excess test would
    // authorize a shadow quote that breaches survival/buffer commitments.
    available >= (request.resourceType === 'energy'
      ? requiredStock : request.amount) &&
    offer.amount >= request.amount;
}

// ledger: existing M0 SHADOW gross-stock census.
// request: explicit, bounded demand; urgency is supplied, never guessed.
// offers: externally priced, short-lived hypothetical alternatives with
// reserve proof. Even VERIFIED quotations do NOT prove an executable route.
function evaluate(ledger, request, offers) {
  const hold = (code) => ({
    schemaVersion: SCHEMA_VERSION, authority: 'SHADOW',
    actionEnabled: false, status: 'HOLD', reasonCodes: [code],
    selected: null, alternatives: [], command: 'NO_ACTION',
    verifiedAvailableToCommit: null
  });
  if (!validatedLedger(ledger)) return hold('LEDGER_UNVERIFIED');
  if (!request || typeof request !== 'object' ||
      typeof request.roomName !== 'string' || !request.roomName ||
      typeof request.resourceType !== 'string' ||
      !/^[A-Za-z0-9_]{1,50}$/.test(request.resourceType) ||
      ['__proto__','prototype','constructor'].includes(request.resourceType) ||
      !safeAmount(request.amount) || request.amount === 0 ||
      !safeCost(request.urgencyPerTickCredits) ||
      !roomByName(ledger, request.roomName))
    return hold('DEMAND_UNVERIFIED');
  if (!offers || !Array.isArray(offers.internal) ||
      !Array.isArray(offers.market) ||
      offers.internal.length + offers.market.length > MAX_OFFERS)
    return hold('OFFERS_UNVERIFIED');
  const need = { ...request, tick: ledger.tick };
  const target = roomByName(ledger, need.roomName);
  if (!hasTerminal(target)) return hold('DESTINATION_TERMINAL_UNVERIFIED');
  const candidates = [];
  const ids = new Set();
  let invalidOffers = 0;
  for (const offer of offers.internal) {
    const valid = offer && typeof offer.id === 'string' && offer.id &&
      !ids.has(offer.id) && typeof offer.sourceRoom === 'string' &&
      offer.sourceRoom !== need.roomName;
    if (offer && typeof offer.id === 'string') ids.add(offer.id);
    const donor = valid && roomByName(ledger, offer.sourceRoom);
    const candidate = donor && hasTerminal(donor) &&
      validReserve(offer, donor, need) && score(offer, need, false);
    if (candidate) candidates.push(candidate);
    else invalidOffers++;
  }
  for (const offer of offers.market) {
    const valid = offers.marketAvailable === true && offer &&
      typeof offer.id === 'string' && offer.id && !ids.has(offer.id) &&
      offer.resourceType === need.resourceType &&
      offer.destinationRoom === need.roomName;
    if (offer && typeof offer.id === 'string') ids.add(offer.id);
    // A market BUY charges transaction energy to the buyer's terminal.
    // This remains advisory, not a free-capacity/cooldown/credit proof.
    const candidate = valid && terminalCanPay(target, offer) &&
      score(offer, need, true);
    if (candidate) candidates.push(candidate);
    else invalidOffers++;
  }
  if (!candidates.length) return hold(invalidOffers
    ? 'NO_VERIFIED_ALLOCATION_OFFER' : 'NO_ALLOCATION_OFFER');
  candidates.sort((a,b) => a.effectiveCost - b.effectiveCost ||
    (a.kind === b.kind ? 0 : a.kind === 'INTERNAL_TRANSFER' ? -1 : 1) ||
    a.offerId.localeCompare(b.offerId));
  return {
    schemaVersion: SCHEMA_VERSION, authority: 'SHADOW',
    actionEnabled: false, status: invalidOffers ? 'PARTIAL' : 'ADVISORY',
    reasonCodes: invalidOffers ? ['UNVERIFIED_OFFERS_EXCLUDED'] : [],
    selected: candidates[0], alternatives: candidates,
    command: 'NO_ACTION', verifiedAvailableToCommit: null
  };
}
module.exports = { SCHEMA_VERSION, evaluate };
