'use strict';

// D0 is observational. No intents, reservations, or persisted gameplay state.
const SCHEMA_VERSION = 2;
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

// Piecewise integration of focused damage. Each actor joins only after its
// own travel/route-breach delay. A rampart covering the asset is paid once by
// the group, not independently by each attacker. No repair or tower kill is
// credited without a combat simulation. Route estimates are not guaranteed
// optimal, so this is a scenario estimate, not a proven global earliest loss.
function focusedLoss(asset, contributions, tick) {
  const arrivals = contributions.filter(c => Number.isFinite(c.arrivalTicks) && c.dps > 0)
    .sort((a, b) => a.arrivalTicks - b.arrivalTicks);
  if (!arrivals.length) return null;
  const barrierHits = Math.max(0, ...arrivals.map(c => c.barrierHits || 0));
  const totalHits = barrierHits + Math.max(1, number(asset.hits, 1));
  let time = 0;
  let damage = 0;
  let dps = 0;
  let impact = barrierHits === 0 ? arrivals[0].arrivalTicks : null;
  let loss = null;
  for (const arrival of arrivals) {
    const duration = arrival.arrivalTicks - time;
    if (dps > 0) {
      if (impact === null && damage + duration * dps >= barrierHits) impact = time + Math.ceil((barrierHits - damage) / dps);
      if (damage + duration * dps >= totalHits) { loss = time + Math.ceil((totalHits - damage) / dps); break; }
      damage += duration * dps;
    }
    time = arrival.arrivalTicks;
    dps += arrival.dps;
  }
  if (impact === null) impact = time + Math.ceil((barrierHits - damage) / dps);
  if (loss === null) loss = time + Math.ceil((totalHits - damage) / dps);
  const useful = arrivals.filter(a => a.arrivalTicks < loss);
  // One creep can contribute ranged and close-range damage at different
  // arrival ticks. Count distinct attackers, not weapon/arrival channels.
  const attackers = new Set(useful.map((a, index) => a.actorId || 'unknown-' + index));
  return { assetId: asset.id, attackerCount: attackers.size, focusedDps: useful.reduce((sum, a) => sum + a.dps, 0),
    barrierHits, impactTick: tick + impact, earliestLossTick: tick + loss };
}

// Use actual structures, never unbuilt P3 rampart proposals, for access evidence.
function accessTo(creep, asset, strength, state, budget, options, attack) {
  const attackRange = attack ? attack.range : strength.rangedDps > 0 ? 3 : 1;
  const damage = attack ? attack.damage : Math.max(strength.meleeDps, strength.dismantlePerTick) + strength.rangedDps;
  const distance = range(creep.pos, asset.pos);
  const protection = (state.structures || []).filter(s => s.structureType === 'rampart' && s.my && range(s.pos, asset.pos) === 0);
  const barrierHits = protection.reduce((sum, s) => sum + Math.max(0, number(s.hits, 0)), 0);
  const base = { actorId: creep.id || creep.name, assetId: asset.id,
    attackMode: attack ? attack.mode : 'COMBINED', attackRange, status: 'UNKNOWN', travelTicks: null,
    barrierHits, breachTicks: damage > 0 ? Math.ceil(barrierHits / damage) : null,
    routeBreachTicks: 0, routeBarrierCount: 0, routeBarrierHits: 0, reason: null };
  if (distance <= attackRange) return Object.assign(base, { status: 'REACHABLE', travelTicks: 0 });
  if (!strength.movePower) return Object.assign(base, { status: 'IMMOBILE', reason: 'NO_ACTIVE_MOVE' });
  const pf = options.pathFinder || constant('PathFinder', null);
  if (!pf || typeof pf.search !== 'function' || typeof pf.CostMatrix !== 'function') return Object.assign(base, { reason: 'PATH_API_MISSING' });
  if (budget.searches >= MAX_SEARCHES) return Object.assign(base, { reason: 'PATH_BUDGET' });
  budget.searches++;
  try {
    const matrix = new pf.CostMatrix();
    const tiles = {};
    const key = pos => pos.x + ',' + pos.y;
    const tile = pos => tiles[key(pos)] || (tiles[key(pos)] = { barriers: [], road: false, impassable: false });
    const obstacles = constant('OBSTACLE_OBJECT_TYPES', ['spawn', 'extension', 'constructedWall', 'tower', 'storage', 'link', 'lab', 'terminal', 'factory', 'observer', 'powerSpawn', 'nuker']);
    for (const s of state.structures || []) if (s.pos && s.structureType === 'road') {
      matrix.set(s.pos.x, s.pos.y, Math.min(254, strength.roadTicks));
      tile(s.pos).road = true;
    }
    for (const s of state.structures || []) {
      if (!s.pos) continue;
      const rampartBlocks = s.structureType === 'rampart' && !s.isPublic &&
        (!s.owner || !creep.owner || s.owner.username !== creep.owner.username);
      if (obstacles.indexOf(s.structureType) >= 0 || rampartBlocks) {
        matrix.set(s.pos.x, s.pos.y, 255);
        if (number(s.hits, 0) > 0 && (!s.owner || !creep.owner || s.owner.username !== creep.owner.username)) tile(s.pos).barriers.push(s);
        else tile(s.pos).impassable = true;
      }
    }
    // Natural room objects also block walking.
    const minerals = state.minerals || (typeof state.room.find === 'function' && constant('FIND_MINERALS', null) !== null
      ? state.room.find(constant('FIND_MINERALS', null)) : []);
    for (const item of (state.sources || []).concat(minerals, state.room.controller ? [state.room.controller] : [])) {
      if (item.pos) { matrix.set(item.pos.x, item.pos.y, 255); tile(item.pos).impassable = true; }
    }
    const searchOptions = {
      maxRooms: 1, maxOps: 200, plainCost: Math.min(254, strength.plainTicks), swampCost: Math.min(254, strength.swampTicks),
      roomCallback: name => name === state.room.name ? matrix : false
    };
    const result = pf.search(creep.pos, { pos: asset.pos, range: attackRange }, searchOptions);
    if (result.incomplete) {
      if (budget.searches >= MAX_SEARCHES) return Object.assign(base, { reason: 'BREACH_PATH_BUDGET' });
      const terrain = typeof state.room.getTerrain === 'function' ? state.room.getTerrain() : null;
      if (!terrain || typeof terrain.get !== 'function') return Object.assign(base, { reason: 'BREACH_TERRAIN_UNKNOWN' });
      let barriers = 0;
      for (const k of Object.keys(tiles)) {
        const t = tiles[k];
        if (!t.barriers.length || t.impassable) continue;
        const xy = k.split(',').map(Number);
        if (terrain.get(xy[0], xy[1]) & constant('TERRAIN_MASK_WALL', 1)) continue;
        const cost = Math.ceil(t.barriers.reduce((sum, s) => sum + s.hits, 0) / damage);
        // The search heuristic is capped, but reported travel/breach durations
        // below use actual hits and terrain, never the capped matrix weight.
        matrix.set(xy[0], xy[1], Math.min(254, cost + strength.plainTicks));
        barriers++;
      }
      if (!barriers) return Object.assign(base, { reason: 'PATH_INCOMPLETE' });
      budget.searches++;
      const breach = pf.search(creep.pos, { pos: asset.pos, range: attackRange }, searchOptions);
      if (breach.incomplete || !Array.isArray(breach.path) || !breach.path.length) return Object.assign(base, { reason: 'BREACH_PATH_INCOMPLETE' });
      let travel = Math.ceil(Math.max(0, number(creep.fatigue, 0)) / strength.movePower);
      let routeHits = 0;
      let breachTicks = 0;
      let barrierCount = 0;
      const paid = new Set();
      for (const pos of breach.path) {
        const t = tiles[key(pos)];
        const terrainType = terrain.get(pos.x, pos.y);
        if (terrainType & constant('TERRAIN_MASK_WALL', 1) || t && t.impassable) return Object.assign(base, { reason: 'BREACH_PATH_INVALID' });
        travel += t && t.road ? strength.roadTicks : terrainType & constant('TERRAIN_MASK_SWAMP', 2) ? strength.swampTicks : strength.plainTicks;
        for (const s of t ? t.barriers : []) if (!paid.has(s.id)) {
          paid.add(s.id);
          routeHits += s.hits;
          breachTicks += Math.ceil(s.hits / damage);
          barrierCount++;
        }
      }
      return Object.assign(base, { status: 'REACHABLE_WITH_BREACH', travelTicks: travel,
        routeBreachTicks: breachTicks, routeBarrierHits: routeHits, routeBarrierCount: barrierCount });
    }
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
  const contributions = {};
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
    // At range 2–3 only RANGED_ATTACK deals damage. Melee and WORK dismantle
    // require range 1. Never credit them at the ranged weapon's arrival tick.
    // The same actor may contribute both channels; focusedLoss deduplicates it.
    // Ranged access runs first under the shared four-search room budget.
    const attacks = [
      { mode: 'RANGED', range: 3, damage: strength.rangedDps },
      { mode: 'CLOSE', range: 1, damage: Math.max(strength.meleeDps, strength.dismantlePerTick) }
    ].filter(attack => attack.damage > 0);
    for (const asset of assets.slice(0, MAX_ASSETS)) {
      for (const attack of attacks) {
        const access = accessTo(creep, asset, strength, state, budget, options, attack);
        paths.push(access);
        if (access.status !== 'REACHABLE' && access.status !== 'REACHABLE_WITH_BREACH') continue;
        if (!contributions[asset.id]) contributions[asset.id] = [];
        contributions[asset.id].push({ actorId: creep.id || creep.name,
          arrivalTicks: access.travelTicks + access.routeBreachTicks,
          dps: attack.damage, barrierHits: access.barrierHits });
      }
    }
  }
  for (const asset of assets.slice(0, MAX_ASSETS)) {
    const loss = focusedLoss(asset, contributions[asset.id] || [], tick);
    if (!loss) continue;
    atRisk.push(loss);
    if (earliest === null || loss.impactTick < earliest) earliest = loss.impactTick;
    if (loss.earliestLossTick - tick <= 25) urgentLoss = true;
  }
  const incomplete = hostiles.length > MAX_ACTORS || assets.length > MAX_ASSETS || paths.some(p => p.status === 'UNKNOWN' || p.status === 'REACHABLE_WITH_BREACH') || actors.some(a => a.strength.unknownBoosts > 0);
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
      basis: 'BOUNDED_FOCUSED_DAMAGE_SCENARIO', safetyAuthority: 'LEGACY_UNCHANGED' },
    pathSearches: budget.searches, assumptions: ['NO_FUTURE_TOWER_ENERGY_ASSUMED', 'INCOMPLETE_PATH_IS_UNKNOWN', 'SEPARATE_RANGED_AND_CLOSE_ACCESS', 'INDEPENDENT_ROUTE_BREACH_ESTIMATES', 'BOUNDED_NONOPTIMAL_BREACH_ROUTE', 'NO_COMBAT_INTENTS']
  };
}

function telemetrySummary(result) {
  if (!result) return null;
  return { schemaVersion: result.schemaVersion, authority: result.authority, actionAuthority: result.actionAuthority,
    tick: result.tick, status: result.status, hostileCount: result.hostileCount, armedCount: result.armedCount,
    aggregate: result.aggregate, riskState: result.risk.state, recommendedSafeMode: result.risk.recommendedSafeMode,
    safetyAuthority: result.risk.safetyAuthority, coreLossProbability: result.risk.coreLossProbability,
    assetsAtRisk: result.access.criticalAssetsAtRisk.length, earliestImpactTick: result.access.earliestImpactTick,
    unknownPaths: result.access.breachPaths.filter(p => p.status === 'UNKNOWN').length, pathSearches: result.pathSearches,
    breachPaths: result.access.breachPaths.filter(p => p.status === 'REACHABLE_WITH_BREACH').length,
    coordinatedAssets: result.access.criticalAssetsAtRisk.filter(a => a.attackerCount > 1).length,
    earliestLossTick: result.access.criticalAssetsAtRisk.length ? Math.min(...result.access.criticalAssetsAtRisk.map(a => a.earliestLossTick)) : null };
}

module.exports = { SCHEMA_VERSION, evaluate, telemetrySummary, bodyStrength, towerDamage, _test: { accessTo, focusedLoss } };
