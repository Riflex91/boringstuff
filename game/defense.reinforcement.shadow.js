'use strict';

// U7/D2 stage one: one-donor, already-existing defender support feasibility.
// Shadow-only: no dispatch, spawn, movement, boost, reservation or Memory writes.
// ETA is accepted ONLY from fresh observed defender transit evidence, not a
// room-distance estimate, unverified route cache, or assumed ticks/room.
const SCHEMA_VERSION = 1;
const AUTHORITY = 'SHADOW';
const MAX_PROVIDERS = 8;
const MAX_DEFENDERS = 12;
const MIN_ENGAGEMENT_TICKS = 25;
const MAX_ROUTE_AGE = 100;
const PART_COST = Object.freeze({
  move: 50, work: 100, carry: 50, attack: 80,
  ranged_attack: 150, heal: 250, tough: 10, claim: 600
});

function tickValid(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function roomName(state) {
  return state && state.room && state.room.name || null;
}

function freshRequest(state, now) {
  const r = state && state.defenseRegistryPreview;
  const d = state && state.defenseRequestsShadow;
  return !!r && r.schemaVersion === 1 && r.tick === now &&
    r.roomName === roomName(state) && r.authority === 'SHADOW' &&
    r.actionAuthority === 'NONE' && r.summary &&
    r.summary.tick === now && r.summary.roomName === r.roomName &&
    r.summary.authority === 'SHADOW' && r.summary.actionAuthority === 'NONE' &&
    r.summary.executable === false && r.summary.writesToGameMemory === false &&
    r.summary.reservationCount === 0 &&
    d && d.schemaVersion === 1 && d.tick === now &&
    d.roomName === r.roomName && d.authority === 'SHADOW' &&
    d.actionAuthority === 'NONE' &&
    d.spawnActionEnabled === false && d.defenseActionEnabled === false &&
    d.safeModeActionEnabled === false && d.summary &&
    d.summary.tick === now && d.summary.roomName === r.roomName;
}

function needed(state) {
  const records = state.defenseRegistryPreview.projectedRequests;
  const summary = state.defenseRegistryPreview.summary;
  if (state.defenseRegistryPreview.status !== 'PROJECTED' ||
      summary.status !== 'PROJECTED' || !Array.isArray(records) ||
      !records.length || records.length > 6 ||
      records.length !== summary.requestCount) return null;
  const amounts = { damagePerTick: 0, healPerTick: 0, effectiveHits: 0 };
  let deadline = null;
  const seen = new Set();
  for (const record of records) {
    if (!record || record.domain !== 'defense' || record.shadow !== true ||
        record.status !== 'OPEN' || !record.demand ||
        !Number.isSafeInteger(record.demand.amount) ||
        record.demand.amount <= 0 || record.demand.amount > 1000000 ||
        !Array.isArray(record.reservations) || record.reservations.length ||
        !record.target || record.target.roomName !== roomName(state) ||
        !record.dedupeKey || seen.has(record.dedupeKey)) return null;
    seen.add(record.dedupeKey);
    const capability = record.demand.capability;
    if (Object.prototype.hasOwnProperty.call(amounts, capability))
      amounts[capability] += record.demand.amount;
    if (record.deadlineTick !== null) {
      if (!tickValid(record.deadlineTick)) return null;
      deadline = deadline === null ? record.deadlineTick :
        Math.min(deadline, record.deadlineTick);
    }
  }
  return { amounts, deadline };
}

function defender(creep) {
  if (!creep || !creep.my || !creep.memory ||
      creep.memory.role !== 'defender' || !Array.isArray(creep.body) ||
      creep.body.length < 2 || creep.body.length > 50 ||
      !tickValid(creep.ticksToLive)) return null;
  let damage = 0, heal = 0, hits = 0, moves = 0, cost = 0;
  for (const part of creep.body) {
    const type = typeof part === 'string' ? part : part && part.type;
    const hp = typeof part === 'string' ? 100 : part && part.hits;
    if (!Object.prototype.hasOwnProperty.call(PART_COST, type) ||
        !Number.isInteger(hp) || hp < 0 || hp > 100 ||
        (typeof part === 'object' && part.boost)) return null;
    cost += PART_COST[type];
    if (hp === 0) continue;
    hits += hp;
    if (type === 'move') moves++;
    if (type === 'attack') damage += 30;
    if (type === 'ranged_attack') damage += 10;
    if (type === 'heal') heal += 12;
  }
  if (!moves || !damage && !heal) return null;
  return {
    id: String(creep.id || creep.name || ''),
    damagePerTick: damage, healPerTick: heal, effectiveHits: hits,
    bodyReplacementEnergy: cost, ticksToLive: creep.ticksToLive
  };
}

function routeFor(from, to, routeEvidence, now) {
  const key = from + '>' + to;
  const r = routeEvidence && routeEvidence[key];
  if (!r || r.from !== from || r.to !== to ||
      r.source !== 'TRACKED_DEFENDER_TRANSIT' ||
      r.status !== 'VERIFIED' || r.risk !== 'CLEAR' ||
      !tickValid(r.observedTick) || r.observedTick > now ||
      now - r.observedTick > MAX_ROUTE_AGE ||
      !Number.isSafeInteger(r.travelTicks) ||
      r.travelTicks < 1 || r.travelTicks > 5000)
    return null;
  return { travelTicks: r.travelTicks, observedTick: r.observedTick,
    source: r.source };
}


// At most 11 defenders remain after the mandatory home-garrison reserve.
// Enumerate a bounded set of complete individual bodies, not synthetic
// fractional MOVE/ATTACK/HEAL "parts". Every proposed subset actually meets
// all three capacity dimensions and has a deterministic energy/size/ID rank.
// This produces *non-executable* proposals only; it cannot grant authority.
function minimumCombatSubset(defenders, demand) {
  if (!Array.isArray(defenders) || !defenders.length ||
      defenders.length > MAX_DEFENDERS - 1 || !demand ||
      !['damagePerTick', 'healPerTick', 'effectiveHits'].every(k =>
        Number.isSafeInteger(demand[k]) && demand[k] >= 0) ||
      demand.damagePerTick + demand.healPerTick === 0) return null;
  const ordered = defenders.slice().sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set();
  for (const d of ordered) {
    if (!d || typeof d.id !== 'string' || !d.id || ids.has(d.id) ||
        !Number.isSafeInteger(d.bodyReplacementEnergy) ||
        d.bodyReplacementEnergy <= 0 ||
        !['damagePerTick', 'healPerTick', 'effectiveHits'].every(k =>
          Number.isSafeInteger(d[k]) && d[k] >= 0)) return null;
    ids.add(d.id);
  }
  let best = null;
  const combinations = 1 << ordered.length;
  for (let mask = 1; mask < combinations; mask++) {
    let cost = 0, count = 0, damage = 0, heal = 0, hits = 0;
    const chosen = [];
    for (let i = 0; i < ordered.length; i++) {
      if (!(mask & (1 << i))) continue;
      const d = ordered[i];
      cost += d.bodyReplacementEnergy;
      if (best && cost > best.replacementEnergy) break;
      count++;
      damage += d.damagePerTick;
      heal += d.healPerTick;
      hits += d.effectiveHits;
      chosen.push(d.id);
    }
    if (best && cost > best.replacementEnergy) continue;
    if (damage < demand.damagePerTick || heal < demand.healPerTick ||
        hits < demand.effectiveHits) continue;
    const lex = chosen.join('|');
    if (!best || cost < best.replacementEnergy ||
        (cost === best.replacementEnergy && count < best.defenderCount) ||
        (cost === best.replacementEnergy && count === best.defenderCount &&
          lex < best.lex)) {
      best = {
        replacementEnergy: cost, defenderCount: count,
        defenderIds: chosen,
        combatCapacity: {
          damagePerTick: damage, healPerTick: heal, effectiveHits: hits
        },
        lex
      };
    }
  }
  if (!best) return null;
  const { lex, ...answer } = best;
  return answer;
}

function result(now, targets) {
  const total = targets.length;
  const selected = targets.filter(t => t.status === 'PROPOSED_SHADOW').length;
  return {
    schemaVersion: SCHEMA_VERSION, authority: AUTHORITY,
    actionAuthority: 'NONE', tick: now,
    // Detailed ephemeral proposals; status telemetry is always bounded.
    supportRequests: targets,
    summary: {
      schemaVersion: SCHEMA_VERSION, authority: AUTHORITY,
      actionAuthority: 'NONE', tick: now,
      targetCount: total, selectedCount: selected,
      blockedCount: total - selected,
      byTarget: Object.fromEntries(targets.map(t => [
        t.targetColony, {
          status: t.status, reason: t.reason,
          candidateCount: t.candidateProviders.length,
          selectedProvider: t.selectedProvider,
          latestUsefulArrivalTick: t.latestUsefulArrivalTick
        }
      ])),
      executable: false, writesToGameMemory: false
    }
  };
}

function evaluate(states, routeEvidence, game) {
  const now = game && game.time;
  if (!tickValid(now)) return result(null, []);
  const owned = (Array.isArray(states) ? states : []).filter(s =>
    s && s.room && s.room.controller && s.room.controller.my &&
    typeof roomName(s) === 'string')
    .sort((a, b) => roomName(a).localeCompare(roomName(b)))
    .slice(0, MAX_PROVIDERS + 1);
  const targets = [];
  // The cheapest donor is not allowed to promise the same field defenders to
  // multiple endangered colonies in one shadow evaluation. Sort by the first
  // provable deadline so urgent defense is considered before later demand.
  // This is a function-local ledger, NOT an authoritative Reservation.
  const shadowDonorLocks = new Set();
  const threatened = owned.filter(s => freshRequest(s, now) &&
    ['DEFENSE', 'EMERGENCY'].includes(s.defenseRequestsShadow.summary.riskState))
    .sort((a, b) => {
      const da = needed(a), db = needed(b);
      const ta = da && da.deadline !== null ? da.deadline : Infinity;
      const tb = db && db.deadline !== null ? db.deadline : Infinity;
      return ta - tb || roomName(a).localeCompare(roomName(b));
    });
  for (const target of threatened) {
    const demand = needed(target);
    const room = roomName(target);
    const support = {
      id: 'support|defense|' + room + '|' + now,
      targetColony: room, type: 'DEFENSE', capability: 'combatVector',
      amount: demand ? demand.amounts.damagePerTick : 0,
      requestedCapacity: demand ? demand.amounts : null,
      latestUsefulArrivalTick: demand ? demand.deadline : null,
      expectedRecoveryBenefit: null,
      candidateProviders: [], selectedProvider: null,
      transportOrSpawnPlan: null, status: 'BLOCKED',
      reason: 'INVALID_D1_REQUEST', authority: AUTHORITY,
      actionAuthority: 'NONE'
    };
    targets.push(support);
    if (!demand || demand.amounts.damagePerTick <= 0) continue;
    if (demand.deadline === null || demand.deadline <= now) {
      support.reason = 'NO_USEFUL_VERIFIED_DEADLINE';
      continue;
    }
    let count = 0;
    for (const donor of owned) {
      const from = roomName(donor);
      if (from === room || count >= MAX_PROVIDERS) continue;
      count++;
      const candidate = { roomName: from, status: 'BLOCKED',
        reason: 'DONOR_UNVERIFIED', etaTicks: null,
        arrivalTick: null, replacementEnergy: null,
        spareEnergyBudget: null, availableCapacity: null,
        defenderCount: 0, donorSpawnAvailable: false,
        routeEvidence: null, selectedDefenderIds: [],
        selectedCombatCapacity: null, selectedDefenderCount: 0 };
      support.candidateProviders.push(candidate);
      if (shadowDonorLocks.has(from)) {
        candidate.reason = 'SHADOW_DONOR_ALREADY_ALLOCATED';
        continue;
      }
      if (!freshRequest(donor, now) ||
          donor.defenseRegistryPreview.status !== 'NO_DEMAND' ||
          donor.defenseRequestsShadow.status !== 'CLEAR' ||
          donor.defenseRequestsShadow.summary.hostileCount !== 0 ||
          donor.emergency !== false ||
          !Array.isArray(donor.creeps) ||
          !Array.isArray(donor.hostileCreeps) ||
          donor.hostileCreeps.length !== 0) {
        candidate.reason = 'DONOR_NOT_VERIFIED_CLEAR';
        continue;
      }
      const route = routeFor(from, room, routeEvidence, now);
      if (!route) {
        candidate.reason = 'OBSERVED_TRANSIT_ETA_REQUIRED';
        continue;
      }
      candidate.etaTicks = route.travelTicks;
      candidate.arrivalTick = now + route.travelTicks;
      candidate.routeEvidence = route;
      if (candidate.arrivalTick > demand.deadline) {
        candidate.reason = 'LATE_ARRIVAL';
        continue;
      }
      if (!Number.isFinite(donor.energyStored) || donor.energyStored < 0 ||
          !Number.isFinite(donor.energyCapacityAvailable) ||
          donor.energyCapacityAvailable <= 0) {
        candidate.reason = 'ENERGY_BUDGET_UNKNOWN';
        continue;
      }
      candidate.donorSpawnAvailable = !!(donor.spawn && !donor.spawn.spawning);
      // Explicit conservative proxy; no strategic stock/boost budget inferred.
      candidate.spareEnergyBudget = Math.max(0,
        donor.energyStored - Math.max(300, 2 * donor.energyCapacityAvailable));
      // Only defenders physically still at home and without a pre-existing
      // defense support mission can be counted. A defender already committed
      // elsewhere is NOT spare capacity, even when a route is verified.
      const all = donor.creeps.filter(c => c && c.memory &&
        c.memory.defenseSupportTarget == null &&
        (c.memory.home == null || c.memory.home === from) &&
        c.room && c.room.name === from)
        .map(defender).filter(Boolean)
        .sort((a, b) => (b.damagePerTick + b.healPerTick * 3) -
          (a.damagePerTick + a.healPerTick * 3) ||
          a.id.localeCompare(b.id)).slice(0, MAX_DEFENDERS);
      // Keep the most valuable defender at home even when clear.
      const reserve = all[0];
      // Creep IDs are a prerequisite for a non-duplicative individual plan.
      if (all.some(d => !d.id) ||
          new Set(all.map(d => d.id)).size !== all.length) {
        candidate.reason = 'DEFENDER_IDENTITY_AMBIGUOUS';
        continue;
      }
      const available = all.slice(1).filter(d =>
        d.ticksToLive > route.travelTicks + MIN_ENGAGEMENT_TICKS);
      candidate.defenderCount = available.length;
      candidate.availableCapacity = {
        damagePerTick: available.reduce((n, d) => n + d.damagePerTick, 0),
        healPerTick: available.reduce((n, d) => n + d.healPerTick, 0),
        effectiveHits: available.reduce((n, d) => n + d.effectiveHits, 0)
      };
      candidate.localReserve = reserve ? {
        damagePerTick: reserve.damagePerTick,
        healPerTick: reserve.healPerTick,
        effectiveHits: reserve.effectiveHits
      } : null;
      if (!available.length) {
        candidate.reason = 'LOCAL_DEFENSE_RESERVE';
        continue;
      }
      const meets = Object.keys(demand.amounts).every(key =>
        candidate.availableCapacity[key] >= demand.amounts[key]);
      if (!meets) {
        candidate.reason = 'COMBAT_CAPACITY_SHORTFALL';
        continue;
      }
      // Choose the lowest replacement-energy *whole-body* combination.
      // A whole-spare-set cost can falsely reject a smaller feasible team.
      const subset = minimumCombatSubset(available, demand.amounts);
      if (!subset) {
        candidate.reason = 'COMBAT_SUBSET_UNVERIFIED';
        continue;
      }
      candidate.replacementEnergy = subset.replacementEnergy;
      candidate.selectedDefenderIds = subset.defenderIds;
      candidate.selectedDefenderCount = subset.defenderCount;
      candidate.selectedCombatCapacity = subset.combatCapacity;
      if (candidate.replacementEnergy > candidate.spareEnergyBudget) {
        candidate.reason = 'REPLACEMENT_BUDGET_SHORTFALL';
        continue;
      }
      candidate.status = 'ELIGIBLE_SHADOW';
      candidate.reason = 'BOUNDED_MINIMUM_COST_COMBAT_SUBSET';
    }
    const ranked = support.candidateProviders.filter(c =>
      c.status === 'ELIGIBLE_SHADOW')
      .sort((a,b) => a.replacementEnergy - b.replacementEnergy ||
        a.arrivalTick - b.arrivalTick || a.roomName.localeCompare(b.roomName));
    if (!ranked.length) {
      support.reason = 'NO_VERIFIED_AFFORDABLE_TIMELY_DONOR';
      continue;
    }
    support.selectedProvider = ranked[0].roomName;
    shadowDonorLocks.add(ranked[0].roomName);
    support.status = 'PROPOSED_SHADOW';
    support.reason = 'ONE_DONOR_COST_RANKING_ONLY';
    support.transportOrSpawnPlan = {
      status: 'NON_EXECUTABLE_PROJECTION', from: ranked[0].roomName,
      to: room, observedTransitTicks: ranked[0].etaTicks,
      replacementEnergyBudget: ranked[0].replacementEnergy,
      requiredCombatCapacity: demand.amounts,
      projectedDefenderIds: ranked[0].selectedDefenderIds.slice(),
      projectedDefenderCount: ranked[0].selectedDefenderCount,
      projectedCombatCapacity: ranked[0].selectedCombatCapacity,
      selectionMethod: 'BOUNDED_WHOLE_BODY_EXHAUSTIVE_SHADOW'
    };
  }
  return result(now, targets);
}

function telemetrySummary(value) {
  return value && value.summary || null;
}

module.exports = { SCHEMA_VERSION, AUTHORITY, MAX_PROVIDERS,
  evaluate, telemetrySummary, _test: { freshRequest, needed, defender, routeFor,
    minimumCombatSubset } };
