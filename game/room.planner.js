'use strict';

const config = require('config');
const logger = require('logger');

function isBuildable(room, x, y) {
  if (x <= 1 || x >= 48 || y <= 1 || y >= 48) return false;
  if (room.getTerrain().get(x, y) === TERRAIN_MASK_WALL) return false;
  const structures = room.lookForAt(LOOK_STRUCTURES, x, y);
  if (structures.some(s => s.structureType !== STRUCTURE_ROAD && s.structureType !== STRUCTURE_RAMPART)) return false;
  const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y);
  return sites.length === 0;
}

function place(room, type, x, y, budget) {
  if (budget && budget.remaining <= 0) return false;
  if (!isBuildable(room, x, y)) return false;
  const rc = room.createConstructionSite(x, y, type);
  if (rc === OK) {
    if (budget) budget.remaining--;
    return true;
  }
  if (rc !== ERR_FULL && rc !== ERR_INVALID_TARGET && rc !== ERR_RCL_NOT_ENOUGH) {
    logger.warn('PLAN_SITE_RC', 'createConstructionSite returned unexpected code', { room: room.name, type, x, y, rc }, { dedupeTicks: 50 });
  }
  return false;
}

function placeNear(room, origin, type, maxRange, budget) {
  for (let r = 1; r <= maxRange; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = origin.x + dx, y = origin.y + dy;
        if (place(room, type, x, y, budget)) return true;
        if (budget && budget.remaining <= 0) return false;
      }
    }
  }
  return false;
}

function roadPath(room, from, to, budget) {
  if (budget.remaining <= 0) return 0;
  const path = room.findPath(from, to, { ignoreCreeps: true, swampCost: 5, plainCost: 2 });
  let built = 0;
  for (const step of path) {
    if (budget.remaining <= 0) break;
    // Do not auto-build 45,000-energy wall tunnels at RCL2 (or at higher
    // RCL without an explicit route-ROI validator). Unlike place(), the old
    // roadPath() bypassed terrain/buildability checks entirely.
    // Walls are 150x plain-road cost; keep existing tunnel sites untouched.
    if (!isBuildable(room, step.x, step.y)) continue;
    if (room.lookForAt(LOOK_STRUCTURES, step.x, step.y).some(s => s.structureType === STRUCTURE_ROAD)) continue;
    const rc = room.createConstructionSite(step.x, step.y, STRUCTURE_ROAD);
    if (rc === OK) { built++; budget.remaining--; }
    if (rc === ERR_FULL) break;
  }
  return built;
}

function countStructureAndSites(state, type) {
  return state.structures.filter(s => s.structureType === type).length +
    state.room.find(FIND_MY_CONSTRUCTION_SITES, { filter: s => s.structureType === type }).length;
}

function hasControllerContainer(room) {
  if (!room.controller) return false;
  return room.controller.pos.findInRange(FIND_STRUCTURES, 1, { filter: s => s.structureType === STRUCTURE_CONTAINER }).length > 0 ||
    room.controller.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, { filter: s => s.structureType === STRUCTURE_CONTAINER }).length > 0;
}

function hasCriticalRcl2Work(state) {
  const rcl = state.rcl;
  if (rcl < 2) return false;
  const extensionAllowed = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][rcl] || 0;
  const extensionBuilt = state.structures.filter(s => s.structureType === STRUCTURE_EXTENSION).length;
  const sourceContainersBuilt = state.sources.filter(source =>
    source.pos.findInRange(FIND_STRUCTURES, 1, { filter: s => s.structureType === STRUCTURE_CONTAINER }).length > 0
  ).length;
  return extensionBuilt < extensionAllowed || sourceContainersBuilt < state.sources.length || !hasControllerContainer(state.room);
}

function rcl2CriticalSiteDeficit(state) {
  if (state.rcl !== 2 || !state.room.controller) return 0;
  const absentSourceContainers = state.sources.filter(source=>
    source.pos.findInRange(FIND_STRUCTURES,1,{
      filter:s=>s.structureType===STRUCTURE_CONTAINER
    }).length===0 &&
    source.pos.findInRange(FIND_CONSTRUCTION_SITES,1,{
      filter:s=>s.structureType===STRUCTURE_CONTAINER
    }).length===0).length;
  const controllerContainer = hasControllerContainer(state.room) ? 0 : 1;
  const extensionQuota=CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][2]||0;
  const extensionDeficit=Math.max(0,
    extensionQuota-countStructureAndSites(state,STRUCTURE_EXTENSION));
  return absentSourceContainers+controllerContainer+extensionDeficit;
}

function pruneExcessRoadSites(room, cap, reservedCriticalSites = 0) {
  const allSites = room.find(FIND_MY_CONSTRUCTION_SITES);
  // A room with *exactly* cap road sites has zero room for RCL2
  // extensions/containers. Reserve slots for missing critical construction
  // sites before considering roads, including when the cap is exactly full.
  const reserved = Math.min(cap, Math.max(0, reservedCriticalSites));
  let need = Math.max(0, allSites.length + reserved - cap);
  if (!need) return 0;
  const roads = allSites
    .filter(site => site.structureType === STRUCTURE_ROAD)
    .sort((a, b) => (a.progress || 0) - (b.progress || 0));
  let removed = 0;
  for (const site of roads) {
    if (need <= 0) break;
    const rc = site.remove();
    if (rc === OK) { removed++; need--; }
  }
  if (removed) {
    logger.info('PLAN_PRUNE_ROADS', 'Removed legacy road construction sites to restore early-room site budget', {
      room: room.name,
      removed,
      siteCap: cap,
      reservedCriticalSites: reserved,
      liveSitesBefore: allSites.length
    }, { force: true, persist: true, dedupeTicks: 0 });
  }
  return removed;
}

// D3: ramparts may legally overlay an existing owned spawn, tower or
// storage. The ordinary place()/isBuildable() deliberately rejects occupied
// tiles, so core fortification has a narrow separate placement gate.
// No speculative walls, border seals, or large construction floods.
function fortifyCore(state, budget) {
  const room = state && state.room;
  if (!room || !room.controller?.my || state.rcl < 4 ||
      state.emergency || state.hostileCreeps?.length ||
      !Number.isFinite(state.energyStored) || state.energyStored < 3000 ||
      !budget || budget.remaining <= 0 ||
      typeof room.lookForAt !== 'function' ||
      typeof room.createConstructionSite !== 'function' ||
      !Array.isArray(state.structures)) return 0;

  const rank = s => s.structureType === STRUCTURE_SPAWN ? 0 :
    s.structureType === STRUCTURE_TOWER ? 1 : 2;
  const critical = state.structures.filter(s => s && s.my === true &&
      s.pos && Number.isInteger(s.pos.x) && Number.isInteger(s.pos.y) &&
      s.pos.x >= 2 && s.pos.x <= 47 &&
      s.pos.y >= 2 && s.pos.y <= 47 &&
      [STRUCTURE_SPAWN,STRUCTURE_TOWER,STRUCTURE_STORAGE].includes(s.structureType))
    .sort((a,b)=>rank(a)-rank(b) ||
      String(a.id||'').localeCompare(String(b.id||'')));
  let placed = 0;
  for (const s of critical) {
    if (budget.remaining <= 0 || placed >= 2) break;
    let buildings,sites;
    try {
      buildings = room.lookForAt(LOOK_STRUCTURES,s.pos.x,s.pos.y);
      sites = room.lookForAt(LOOK_CONSTRUCTION_SITES,s.pos.x,s.pos.y);
    } catch (_) { continue; }
    if (!Array.isArray(buildings) || !Array.isArray(sites) ||
        !buildings.some(b=>b && b.id===s.id && b.my===true) ||
        buildings.some(b=>b && (b.structureType===STRUCTURE_RAMPART ||
          b.structureType===STRUCTURE_WALL)) ||
        sites.length) continue;
    let rc;
    try { rc=room.createConstructionSite(
      s.pos.x,s.pos.y,STRUCTURE_RAMPART); }
    catch (_) { continue; }
    if (rc === OK) { placed++; budget.remaining--; }
    else if (rc === ERR_FULL) break;
  }
  return placed;
}

function plan(state) {
  const room = state.room;
  if (!state.spawn || !room.controller || !room.controller.my) return;

  const rcl = state.rcl;
  const cap = rcl <= 2 ? Math.min(config.MAX_CONSTRUCTION_SITES_PER_ROOM, config.EARLY_RCL2_SITE_CAP) : config.MAX_CONSTRUCTION_SITES_PER_ROOM;

  // v0.2.7 could leave a large road backlog. Only road sites are pruned; useful
  // extensions/containers are never removed by this migration.
  if (rcl <= 2) pruneExcessRoadSites(room, cap,
    rcl === 2 ? rcl2CriticalSiteDeficit(state) : 0);

  const liveSites = room.find(FIND_MY_CONSTRUCTION_SITES).length;
  if (liveSites >= cap) return;

  const budget = { remaining: Math.max(0, cap - liveSites) };
  let changed = 0;

  // Stage 1: source containers, controller buffer, then extensions. Together at
  // RCL2 this fits exactly in the early cap (2 sources + controller + 5 ext).
  if (rcl >= 2) {
    for (const source of state.sources) {
      if (budget.remaining <= 0) break;
      const hasContainer = source.pos.findInRange(FIND_STRUCTURES, 1, { filter: s => s.structureType === STRUCTURE_CONTAINER }).length > 0 ||
        source.pos.findInRange(FIND_CONSTRUCTION_SITES, 1, { filter: s => s.structureType === STRUCTURE_CONTAINER }).length > 0;
      if (!hasContainer && placeNear(room, source.pos, STRUCTURE_CONTAINER, 1, budget)) changed++;
    }

    if (budget.remaining > 0 && room.controller && !hasControllerContainer(room)) {
      if (placeNear(room, room.controller.pos, STRUCTURE_CONTAINER, 1, budget)) changed++;
    }

    const currentExt = countStructureAndSites(state, STRUCTURE_EXTENSION);
    const allowed = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][rcl] || 0;
    let need = Math.max(0, allowed - currentExt);
    const ring = [
      [-2,-2],[0,-2],[2,-2],[-2,0],[2,0],[-2,2],[0,2],[2,2],
      [-3,-1],[-3,1],[3,-1],[3,1],[-1,-3],[1,-3],[-1,3],[1,3]
    ];
    for (const [dx, dy] of ring) {
      if (need <= 0 || budget.remaining <= 0) break;
      if (place(room, STRUCTURE_EXTENSION, state.spawn.pos.x + dx, state.spawn.pos.y + dy, budget)) { need--; changed++; }
    }
  }

  if (rcl >= 3 && budget.remaining > 0) {
    const towerCount = countStructureAndSites(state, STRUCTURE_TOWER);
    const towerAllowed = CONTROLLER_STRUCTURES[STRUCTURE_TOWER][rcl] || 0;
    if (towerCount < towerAllowed && placeNear(room, state.spawn.pos, STRUCTURE_TOWER, 4, budget)) changed++;
  }

  // After energy infrastructure and towers, protect the core BEFORE
  // discretionary roads. Limit new ramparts to two verified occupied
  // core tiles per planning interval; productive workers then build them.
  if (rcl >= 4 && budget.remaining > 0)
    changed += fortifyCore(state,budget);

  if (rcl >= 2 && budget.remaining > 0 && !hasCriticalRcl2Work(state)) {
    const roadBudget = { remaining: Math.min(config.ROAD_SITE_BUDGET_PER_PLAN, budget.remaining) };
    for (const source of state.sources) {
      if (roadBudget.remaining <= 0) break;
      changed += roadPath(room, state.spawn.pos, source.pos, roadBudget);
    }
    if (roadBudget.remaining > 0 && room.controller) changed += roadPath(room, state.spawn.pos, room.controller.pos, roadBudget);
  }

  if (changed) {
    logger.info('PLAN_CHANGED', 'Room planner placed construction sites', {
      room: room.name,
      rcl,
      placed: changed,
      liveSitesBefore: liveSites,
      siteCap: cap,
      criticalRcl2Work: hasCriticalRcl2Work(state)
    }, { force: true, persist: true, dedupeTicks: 0 });
  }
}

module.exports = { plan, _test: { fortifyCore } };
