'use strict';

const config = require('config');
const ROOM = /^[WE][0-9]+[NS][0-9]+$/;

// Dedicated second-colony bootstrap worker. No mission means no new-room
// construction or uncontrolled travel. The first spawn is the only site this
// role can create; once built, existing room/worker management takes over.
function validMission(creep, memory, game) {
  const m = memory?.bot?.expansionClaim;
  const tick = game?.time;
  if (!creep?.memory || creep.memory.role !== 'pioneer' ||
      !m || m.schemaVersion !== 1 ||
      m.phase !== 'CLAIMED' ||
      typeof m.id !== 'string' || m.id.length > 80 ||
      !/^claim-[WE][0-9]+[NS][0-9]+-[WE][0-9]+[NS][0-9]+-[0-9]+$/.test(m.id) ||
      m.id !== creep.memory.claimMissionId ||
      !ROOM.test(m.parent || '') || !ROOM.test(m.target || '') ||
      m.parent === m.target ||
      !Array.isArray(m.route) || m.route.length < 2 ||
      m.route.length > 4 ||
      m.route[0] !== m.parent || m.route.at(-1) !== m.target ||
      new Set(m.route).size !== m.route.length ||
      m.route.some(name => !ROOM.test(name)) ||
      !Number.isSafeInteger(m.confirmedTick) ||
      !Number.isSafeInteger(tick) || m.confirmedTick > tick ||
      tick - m.confirmedTick > 2000 ||
      !m.verifiedSpawnSite ||
      m.verifiedSpawnSite.roomName !== m.target ||
      !Number.isInteger(m.verifiedSpawnSite.x) ||
      !Number.isInteger(m.verifiedSpawnSite.y) ||
      m.verifiedSpawnSite.x < 5 || m.verifiedSpawnSite.x > 44 ||
      m.verifiedSpawnSite.y < 5 || m.verifiedSpawnSite.y > 44)
    return null;
  return m;
}

function hostile(room) {
  if (!room || typeof room.find !== 'function' ||
      typeof FIND_HOSTILE_CREEPS === 'undefined' ||
      typeof FIND_HOSTILE_STRUCTURES === 'undefined') return true;
  const creeps = room.find(FIND_HOSTILE_CREEPS);
  const structures = room.find(FIND_HOSTILE_STRUCTURES);
  return !Array.isArray(creeps) || creeps.length > 0 ||
    !Array.isArray(structures) || structures.length > 0;
}

function move(creep, target, reusePath) {
  return creep.moveTo(target, {
    reusePath, maxOps: config.PATH_MAX_OPS, maxRooms: 1
  });
}

function retreat(creep, mission) {
  const index = mission.route.indexOf(creep.room?.name);
  if (index <= 0) return;
  const previous = mission.route[index - 1];
  const direction = Game.map?.findExit?.(creep.room.name, previous);
  if (!Number.isInteger(direction) || direction < 0) return;
  const exit = creep.pos.findClosestByRange(direction);
  if (exit) move(creep, exit, 4);
}

function moveAlongRoute(creep, mission) {
  const index = mission.route.indexOf(creep.room.name);
  if (index < 0 || index >= mission.route.length - 1) return false;
  const direction = Game.map?.findExit?.(
    creep.room.name, mission.route[index + 1]);
  if (!Number.isInteger(direction) || direction < 0) return false;
  const exit = creep.pos.findClosestByRange(direction);
  if (!exit) return false;
  move(creep, exit, 5);
  return true;
}

function spawnSite(room, mission) {
  const site = mission.verifiedSpawnSite;
  if (!room || room.name !== site.roomName ||
      !room.controller?.my ||
      typeof room.find !== 'function') return null;
  const built = room.find(FIND_MY_SPAWNS);
  if (!Array.isArray(built)) return null;
  if (built.length) return {status:'BUILT',target:built[0]};
  const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
  if (!Array.isArray(sites)) return null;
  const own = sites.filter(x=>x && x.structureType === STRUCTURE_SPAWN);
  if (own.length) {
    const verified=own.find(x=>x.pos?.x===site.x && x.pos?.y===site.y);
    return verified ? {status:'SITE',target:verified} : null;
  }
  // Avoid duplicating a previous queued site or silently removing foreign
  // obstructions. Never place sites while under CPU pressure.
  if (typeof room.lookForAt !== 'function' ||
      typeof room.createConstructionSite !== 'function' ||
      typeof LOOK_STRUCTURES === 'undefined' ||
      typeof LOOK_CONSTRUCTION_SITES === 'undefined' ||
      typeof TERRAIN_MASK_WALL === 'undefined' ||
      typeof room.getTerrain !== 'function') return null;
  const blocking=room.lookForAt(LOOK_STRUCTURES,site.x,site.y);
  const building=room.lookForAt(LOOK_CONSTRUCTION_SITES,site.x,site.y);
  const terrain=room.getTerrain();
  if (!Array.isArray(blocking) || blocking.length ||
      !Array.isArray(building) || building.length ||
      !terrain || typeof terrain.get !== 'function' ||
      (terrain.get(site.x,site.y) & TERRAIN_MASK_WALL)) return null;
  if (Game.time % 25 !== 0 || !Game.cpu ||
      !Number.isFinite(Game.cpu.bucket) || Game.cpu.bucket < 7000)
    return null;
  const rc=room.createConstructionSite(site.x,site.y,STRUCTURE_SPAWN);
  return {status:rc===OK?'SITE_INTENT_ACCEPTED':'SITE_REJECTED',
    result:rc};
}

function workEnergy(creep) {
  if (!creep.store || creep.store.getFreeCapacity(RESOURCE_ENERGY) <= 0)
    return false;
  const source=creep.pos.findClosestByPath(FIND_SOURCES, {
    maxOps: config.PATH_MAX_OPS,
    filter:s=>s && s.energy>0
  });
  if (!source) return false;
  const rc=creep.harvest(source);
  if (rc===ERR_NOT_IN_RANGE) move(creep,source,5);
  return rc===OK || rc===ERR_NOT_IN_RANGE;
}

function run(creep) {
  const m=validMission(creep, Memory, Game);
  if (!m || !creep?.room || !creep.pos) return;
  const parent=Game.rooms?.[m.parent];
  if (!parent?.controller?.my ||
      (Number(parent.controller.safeMode)||0)>0 ||
      (Number(parent.controller.safeModeCooldown)||0)>0 ||
      hostile(parent) || hostile(creep.room)) {
    retreat(creep,m);
    return;
  }
  const at=m.route.indexOf(creep.room.name);
  if (at<0) return;
  if (at<m.route.length-1) {
    moveAlongRoute(creep,m);
    return;
  }
  if (creep.room.name!==m.target || !creep.room.controller?.my) {
    retreat(creep,m);
    return;
  }
  const site=spawnSite(creep.room,m);
  if (!site || site.status==='SITE_REJECTED' ||
      site.status==='SITE_INTENT_ACCEPTED') return;
  // After first colony spawn is confirmed, ordinary worker behavior
  // will be scheduled in a separate settlement/assignment release.
  if (site.status!=='SITE') return;
  if ((creep.store?.[RESOURCE_ENERGY]||0) <= 0) {
    workEnergy(creep);
    return;
  }
  const rc=creep.build(site.target);
  if (rc===ERR_NOT_IN_RANGE) move(creep,site.target,5);
}

module.exports={run,_test:{validMission,hostile,spawnSite,workEnergy}};
