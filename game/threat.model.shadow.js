'use strict';

// D0 is observational. No intents, reservations, or persisted gameplay state.
const SCHEMA_VERSION = 1;
const MAX_ACTORS = 50;
const MAX_ASSETS = 8;
const MAX_SEARCHES = 4;

function constant(name, fallback) {
  return typeof globalThis !== 'undefined' && globalThis[name] !== undefined ? globalThis[name] : fallback;
}
function number(value, fallback) { return Number.isFinite(value) ? value : fallback; }
function round(value) { return Math.round(value * 1000) / 1000; }
function range(a, b) {
  if (!a || !b || a.roomName !== b.roomName) return Infinity;
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}
function multiplier(part, action) {
  const boosts = constant('BOOSTS', {});
  const value = boosts[part.type] && boosts[part.type][part.boost] && boosts[part.type][part.boost][action];
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function bodyStrength(creep) {
  const out = { meleeDps: 0, rangedDps: 0, healPerTick: 0, rangedHealPerTick: 0,
    dismantlePerTick: 0, effectiveTough: 0, effectiveHits: 0, movePower: 0, weight: 0,
    claimParts: 0, unknownBoosts: 0, roadTicks: null, plainTicks: null, swampTicks: null };
  const boosts = constant('BOOSTS', {});
  let loaded = creep.store ? (typeof creep.store.getUsedCapacity === 'function'
    ? creep.store.getUsedCapacity() : Object.keys(creep.store).reduce((n, k) => n + number(creep.store[k], 0), 0)) : 0;
  for (const raw of creep.body || []) {
    const p = typeof raw === 'string' ? { type: raw, hits: 100 } : raw;
    if (!p) continue;
    // Destroyed non-MOVE parts still contribute fatigue. Empty CARRY does not.
    if (p.type !== 'move' && p.type !== 'carry') out.weight++;
    const hits = Math.max(0, number(p.hits, 100));
    if (!hits) continue;
    if (p.boost && !(boosts[p.type] && boosts[p.type][p.boost])) out.unknownBoosts++;
    const mitigation = p.type === 'tough' ? Math.min(1, multiplier(p, 'damage')) : 1;
    out.effectiveHits += hits / mitigation;
    if (p.type === 'tough') out.effectiveTough += hits / mitigation;
    if (p.type === 'attack') out.meleeDps += constant('ATTACK_POWER', 30) * multiplier(p, 'attack');
    if (p.type === 'ranged_attack') out.rangedDps += constant('RANGED_ATTACK_POWER', 10) * multiplier(p, 'rangedAttack');
    if (p.type === 'heal') {
      out.healPerTick += constant('HEAL_POWER', 12) * multiplier(p, 'heal');
      out.rangedHealPerTick += constant('RANGED_HEAL_POWER', 4) * multiplier(p, 'rangedHeal');
    }
    if (p.type === 'work') out.dismantlePerTick += constant('DISMANTLE_POWER', 50) * multiplier(p, 'dismantle');
    if (p.type === 'claim') out.claimParts++;
    if (p.type === 'move') out.movePower += constant('MOVE_POWER', 2) * multiplier(p, 'fatigue');
    if (p.type === 'carry') {
      const capacity = constant('CARRY_CAPACITY', 50) * multiplier(p, 'capacity');
      if (loaded > 0) { out.weight++; loaded = Math.max(0, loaded - capacity); }
    }
  }
  if (out.movePower > 0) {
    out.roadTicks = Math.max(1, Math.ceil(out.weight / out.movePower));
    out.plainTicks = Math.max(1, Math.ceil(out.weight * 2 / out.movePower));
    out.swampTicks = Math.max(1, Math.ceil(out.weight * 10 / out.movePower));
  }
  out.effectiveTough = round(out.effectiveTough);
  out.effectiveHits = round(out.effectiveHits);
  return out;
}

function towerDamage(tower, pos) {
  if (!tower || !tower.store || number(tower.store[constant('RESOURCE_ENERGY', 'energy')], 0) < constant('TOWER_ENERGY_COST', 10)) return 0;
  if (typeof tower.isActive === 'function' && !tower.isActive()) return 0;
  const distance = range(tower.pos, pos);
  if (!Number.isFinite(distance)) return 0;
  const optimal = constant('TOWER_OPTIMAL_RANGE', 5);
  const falloffRange = constant('TOWER_FALLOFF_RANGE', 20);
  const fraction = Math.max(0, Math.min(1, (distance - optimal) / Math.max(1, falloffRange - optimal)));
  return constant('TOWER_POWER_ATTACK', 600) * (1 - constant('TOWER_FALLOFF', 0.75) * fraction);
}

// Use actual structures, never unbuilt P3 rampart proposals, for access evidence.
function accessTo(creep, asset, strength, state, budget, options) {
  const attackRange = strength.rangedDps > 0 ? 3 : 1;
  const distance = range(creep.pos, asset.pos);
  const protection = (state.structures || []).filter(s => s.structureType === 'rampart' && s.my && range(s.pos, asset.pos) === 0);
  const barrierHits = protection.reduce((sum, s) => sum + Math.max(0, number(s.hits, 0)), 0);
  const damage = Math.max(strength.meleeDps, strength.dismantlePerTick) + strength.rangedDps;
  const base = { actorId: creep.id || creep.name, assetId: asset.id, status: 'UNKNOWN', travelTicks: null,
    barrierHits, breachTicks: damage > 0 ? Math.ceil(barrierHits / damage) : null, reason: null };
  if (distance <= attackRange) return Object.assign(base, { status: 'REACHABLE', travelTicks: 0 });
  if (!strength.movePower) return Object.assign(base, { status: 'IMMOBILE', reason: 'NO_ACTIVE_MOVE' });
  const pf = options.pathFinder || constant('PathFinder', null);
  if (!pf || typeof pf.search !== 'function' || typeof pf.CostMatrix !== 'function') return Object.assign(base, { reason: 'PATH_API_MISSING' });
  if (budget.searches >= MAX_SEARCHES) return Object.assign(base, { reason: 'PATH_BUDGET' });
  budget.searches++;
  try {
    const matrix = new pf.CostMatrix();
    const obstacles = constant('OBSTACLE_OBJECT_TYPES', ['spawn', 'extension', 'constructedWall', 'tower', 'storage', 'link', 'lab', 'terminal', 'factory', 'observer', 'powerSpawn', 'nuker']);
    for (const s of state.structures || []) if (s.pos && s.structureType === 'road') matrix.set(s.pos.x, s.pos.y, Math.min(254, strength.roadTicks));
    for (const s of state.structures || []) {
      if (!s.pos) continue;
      const rampartBlocks = s.structureType === 'rampart' && !s.isPublic &&
        (!s.owner || !creep.owner || s.owner.username !== creep.owner.username);
      if (obstacles.indexOf(s.structureType) >= 0 || rampartBlocks) matrix.set(s.pos.x, s.pos.y, 255);
    }
    // Natural room objects also block walking.
    for (const item of (state.sources || []).concat(state.room.controller ? [state.room.controller] : [])) {
      if (item.pos) matrix.set(item.pos.x, item.pos.y, 255);
    }
    const result = pf.search(creep.pos, { pos: asset.pos, range: attackRange }, {
      maxRooms: 1, maxOps: 200, plainCost: Math.min(254, strength.plainTicks), swampCost: Math.min(254, strength.swampTicks),
      roomCallback: name => name === state.room.name ? matrix : false
    });
    if (result.incomplete) return Object.assign(base, { reason: 'PATH_INCOMPLETE_OR_BREACH_REQUIRED' });
    const cost = number(result.cost, (result.path || []).length * strength.plainTicks);
    return Object.assign(base, { status: 'REACHABLE', travelTicks: cost + Math.ceil(Math.max(0, number(creep.fatigue, 0)) / strength.movePower) });
  } catch (err) {
    return Object.assign(base, { reason: 'PATH_API_ERROR' });
  }
}

function evaluate(state, game, options) {
  options = options || {};
  const tick = game && Number.isFinite(game.time) ? game.time : 0;
  const hostiles = state.hostileCreeps || [];
  const assets = (state.structures || []).filter(s => s.my && ['spawn', 'storage', 'terminal', 'tower'].indexOf(s.structureType) >= 0)
    .sort((a, b) => (a.structureType === 'spawn' ? 0 : 1) - (b.structureType === 'spawn' ? 0 : 1) || String(a.id).localeCompare(String(b.id)));
  const aggregate = { meleeDps: 0, rangedDps: 0, healPerTick: 0, dismantlePerTick: 0, effectiveTough: 0, mobility: 0 };
  const budget = { searches: 0 };
  const actors = [];
  const paths = [];
  const atRisk = [];
  const towers = (state.structures || []).filter(s => s.structureType === 'tower');
  const observed = hostiles.slice(0, MAX_ACTORS).map(creep => ({ creep, strength: bodyStrength(creep) }));
  let armed = 0;
  let earliest = null;
  let urgentLoss = false;
  for (const observation of observed) {
    const creep = observation.creep;
    const strength = observation.strength;
    for (const key of Object.keys(aggregate)) if (key !== 'mobility') aggregate[key] += strength[key];
    if (strength.movePower > 0) aggregate.mobility++;
    const offensive = strength.meleeDps + strength.rangedDps + strength.dismantlePerTick > 0;
    if (offensive || strength.claimParts) armed++;
    const incoming = towers.filter(t => t.my).reduce((sum, t) => sum + towerDamage(t, creep.pos), 0);
    const supportHeal = observed.reduce((sum, other) => {
      const d = range(other.creep.pos, creep.pos);
      if (d > 3) return sum;
      const healer = other.strength;
      return sum + (d <= 1 ? healer.healPerTick : healer.rangedHealPerTick);
    }, 0);
    actors.push({ id: creep.id || creep.name, strength, friendlyTowerDps: round(incoming), nearbyHealPerTick: supportHeal });
    if (!offensive) continue;
    for (const asset of assets.slice(0, MAX_ASSETS)) {
      const access = accessTo(creep, asset, strength, state, budget, options);
      paths.push(access);
      if (access.status !== 'REACHABLE') continue;
      const impact = tick + access.travelTicks + access.breachTicks;
      if (earliest === null || impact < earliest) earliest = impact;
      const damage = Math.max(strength.meleeDps, strength.dismantlePerTick) + strength.rangedDps;
      const lossTicks = access.travelTicks + access.breachTicks + Math.ceil(Math.max(1, number(asset.hits, 1)) / damage);
      // A deterministic conservative bound, not a calibrated probability. Tower
      // damage is diagnostic: do not assume split fire or future tower energy.
      atRisk.push({ assetId: asset.id, actorId: creep.id || creep.name, impactTick: impact, earliestLossTick: tick + lossTicks });
      if (lossTicks <= 25) urgentLoss = true;
    }
  }
  const incomplete = hostiles.length > MAX_ACTORS || assets.length > MAX_ASSETS || paths.some(p => p.status === 'UNKNOWN') || actors.some(a => a.strength.unknownBoosts > 0);
  const riskState = !hostiles.length ? 'NORMAL' : !armed ? 'WATCH' : urgentLoss ? 'EMERGENCY' : atRisk.length ? 'DEFENSE' : 'ALERT';
  const controller = state.room.controller || {};
  return {
    schemaVersion: SCHEMA_VERSION, authority: 'SHADOW', actionAuthority: 'NONE', tick, roomName: state.room.name,
    status: incomplete ? 'PARTIAL' : 'READY', hostileCount: hostiles.length, armedCount: armed,
    hostileActors: actors, aggregate,
    access: { breachPaths: paths, criticalAssetsAtRisk: atRisk, earliestImpactTick: earliest },
    towers: { friendlyCoverage: actors.map(a => ({ actorId: a.id, damage: a.friendlyTowerDps })),
      hostileCoverage: towers.filter(t => !t.my && t.owner).map(t => ({ id: t.id, damageAtCore: assets.length ? round(towerDamage(t, assets[0].pos)) : 0 })) },
    risk: { state: riskState, coreLossProbability: null, recommendedSafeMode: urgentLoss && !!controller.my && !controller.safeMode && !controller.safeModeCooldown && number(controller.safeModeAvailable, 0) > 0,
      basis: 'CONSERVATIVE_ASSET_LOSS_BOUND', safetyAuthority: 'LEGACY_UNCHANGED' },
    pathSearches: budget.searches, assumptions: ['NO_FUTURE_TOWER_ENERGY_ASSUMED', 'INCOMPLETE_PATH_IS_UNKNOWN', 'BREACH_SEARCH_DEFERRED', 'NO_COMBAT_INTENTS']
  };
}

function telemetrySummary(result) {
  if (!result) return null;
  return { schemaVersion: result.schemaVersion, authority: result.authority, actionAuthority: result.actionAuthority,
    tick: result.tick, status: result.status, hostileCount: result.hostileCount, armedCount: result.armedCount,
    aggregate: result.aggregate, riskState: result.risk.state, recommendedSafeMode: result.risk.recommendedSafeMode,
    safetyAuthority: result.risk.safetyAuthority, coreLossProbability: result.risk.coreLossProbability,
    assetsAtRisk: result.access.criticalAssetsAtRisk.length, earliestImpactTick: result.access.earliestImpactTick,
    unknownPaths: result.access.breachPaths.filter(p => p.status === 'UNKNOWN').length, pathSearches: result.pathSearches };
}

module.exports = { SCHEMA_VERSION, evaluate, telemetrySummary, bodyStrength, towerDamage, _test: { accessTo } };
