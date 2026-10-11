'use strict';

// Bounded, read-only I4 second-colony spawn-site / creep-path evidence.
// Live vision is mandatory for every routed room; cached intel alone cannot
// demonstrate walkable terrain. Never writes construction/claim/spawn intents.
const MAX_CANDIDATES = 16;
const PATH_MAX_OPS = 1200;
const localPartOps = 550;
const OFFSETS = [
  [0,0],[4,0],[-4,0],[0,4],[0,-4],
  [4,4],[-4,4],[4,-4],[-4,-4],
  [8,0],[-8,0],[0,8],[0,-8],
  [8,4],[-8,-4],[4,8]
];
const ROOM = /^[WE]\d+[NS]\d+$/;

function coord(value) {
  return Number.isInteger(value) && value >= 0 && value <= 49;
}

function validPos(pos, roomName) {
  return !!pos && coord(pos.x) && coord(pos.y) && pos.roomName === roomName;
}

function range(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function sites(record) {
  const sources = record?.resources?.sources;
  const controller = record?.controller?.pos;
  const name = record?.roomName;
  if (!ROOM.test(name || '') || !validPos(controller, name) ||
      !Array.isArray(sources) || sources.length !== 2 ||
      sources.some(s => !validPos(s?.pos, name))) return [];
  const xs = [controller.x, ...sources.map(s => s.pos.x)];
  const ys = [controller.y, ...sources.map(s => s.pos.y)];
  const center = {
    x: Math.round(xs.reduce((a,b)=>a+b,0) / xs.length),
    y: Math.round(ys.reduce((a,b)=>a+b,0) / ys.length)
  };
  return OFFSETS.slice(0,MAX_CANDIDATES).map(([dx,dy]) => ({
    x:center.x+dx, y:center.y+dy, roomName:name
  }));
}

function visible(game, names) {
  if (!Array.isArray(names) || names.length < 1 || names.length > 3 ||
      new Set(names).size !== names.length || !game?.rooms)
    return false;
  for (const name of names) {
    const room = game.rooms[name];
    if (!ROOM.test(name) || !room || room.name !== name ||
        typeof room.find !== 'function' || typeof room.getTerrain !== 'function')
      return false;
    if (typeof FIND_HOSTILE_CREEPS === 'undefined' ||
        !Array.isArray(room.find(FIND_HOSTILE_CREEPS)) ||
        room.find(FIND_HOSTILE_CREEPS).length) return false;
  }
  return true;
}

function currentTargetMatches(room, record) {
  const controller = room?.controller;
  if (!controller || controller.my !== false || controller.owner ||
      controller.reservation || controller.level !== 0 ||
      !validPos(controller.pos, room.name) ||
      !validPos(record?.controller?.pos, room.name) ||
      controller.pos.x !== record.controller.pos.x ||
      controller.pos.y !== record.controller.pos.y) return false;
  if (typeof FIND_SOURCES === 'undefined') return false;
  const sources = room.find(FIND_SOURCES);
  const cached = record?.resources?.sources;
  return Array.isArray(sources) && sources.length === 2 &&
    Array.isArray(cached) && cached.length === 2 &&
    sources.every(s => cached.some(c => c.id === s.id &&
      validPos(s.pos, room.name) && validPos(c.pos, room.name) &&
      c.pos.x === s.pos.x && c.pos.y === s.pos.y));
}

function tileClear(room, tile, record) {
  if (!coord(tile?.x) || !coord(tile?.y) || tile.x < 5 ||
      tile.x > 44 || tile.y < 5 || tile.y > 44 ||
      range(tile, record.controller.pos) < 3 ||
      range(tile, record.controller.pos) > 22 ||
      record.resources.sources.some(s =>
        range(tile, s.pos) < 3 || range(tile, s.pos) > 22))
    return false;
  const terrain = room.getTerrain();
  if (!terrain || typeof terrain.get !== 'function' ||
      typeof TERRAIN_MASK_WALL === 'undefined' ||
      typeof LOOK_STRUCTURES === 'undefined' ||
      typeof LOOK_CONSTRUCTION_SITES === 'undefined' ||
      typeof room.lookForAt !== 'function') return false;
  if (terrain.get(tile.x, tile.y) & TERRAIN_MASK_WALL) return false;
  if ((room.lookForAt(LOOK_STRUCTURES, tile.x, tile.y) || []).length ||
      (room.lookForAt(LOOK_CONSTRUCTION_SITES,tile.x,tile.y) || []).length)
    return false;
  let adjacent = 0;
  for (let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++) {
    if (dx === 0 && dy === 0) continue;
    const x=tile.x+dx, y=tile.y+dy;
    if (!(terrain.get(x,y) & TERRAIN_MASK_WALL)) adjacent++;
  }
  return adjacent >= 6;
}

function pathVerified(from, to, destinationRange, allowed, maxOps) {
  if (typeof PathFinder === 'undefined' ||
      typeof PathFinder.search !== 'function' ||
      typeof RoomPosition === 'undefined') return null;
  let path;
  try {
    path = PathFinder.search(
      new RoomPosition(from.x,from.y,from.roomName),
      {pos:new RoomPosition(to.x,to.y,to.roomName),range:destinationRange},
      {
        maxOps,maxRooms:Math.min(4,allowed.size),
        plainCost:2,swampCost:10,
        roomCallback: name => allowed.has(name) ? undefined : false
      }
    );
  } catch (_) {
    return false;
  }
  if (!path || path.incomplete !== false ||
      !Number.isFinite(path.cost) || path.cost < 0 ||
      !Array.isArray(path.path) || path.path.length < 1)
    return false;
  const last=path.path[path.path.length-1];
  if (!validPos(last, to.roomName) || range(last,to) > destinationRange)
    return false;
  if (path.path.some(pos=>!validPos(pos,pos?.roomName) ||
      !allowed.has(pos.roomName))) return false;
  return {cost:path.cost,steps:path.path.length};
}

function assess(game, parent, targetRecord, routeRooms, cursor) {
  const planned = sites(targetRecord);
  if (!planned.length) return {status:'DEFERRED',reason:'SPAWN_GEOMETRY_INTEL_MISSING'};
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor >= planned.length)
    return {status:'EXHAUSTED',reason:'SITE_CANDIDATES_EXHAUSTED'};
  if (!parent?.spawn || !validPos(parent.spawn.pos,parent.room?.name) ||
      !Array.isArray(routeRooms) ||
      routeRooms[routeRooms.length-1] !== targetRecord.roomName ||
      routeRooms.length > 3 || routeRooms.includes(parent.room.name) ||
      !visible(game,[parent.room.name,...routeRooms]))
    return {status:'DEFERRED',reason:'COMPLETE_ROUTE_VISION_REQUIRED'};
  const room=game.rooms[targetRecord.roomName];
  if (!currentTargetMatches(room,targetRecord))
    return {status:'DEFERRED',reason:'VISIBLE_TARGET_INTEL_MISMATCH'};
  if (typeof PathFinder === 'undefined' ||
      typeof PathFinder.search !== 'function' ||
      typeof RoomPosition === 'undefined')
    return {status:'DEFERRED',reason:'PATHFINDER_UNAVAILABLE'};
  const tile=planned[cursor];
  if (!tileClear(room,tile,targetRecord))
    return {status:'REJECTED',reason:'SPAWN_TILE_GEOMETRY_BLOCKED'};
  const allowed = new Set([parent.room.name,...routeRooms]);
  const goals=[{pos:tile,range:0,ops:PATH_MAX_OPS},
    {pos:targetRecord.controller.pos,range:1,ops:localPartOps},
    ...targetRecord.resources.sources.map(s=>({pos:s.pos,range:1,ops:localPartOps}))];
  let cost=0,steps=0;
  for (let i=0;i<goals.length;i++) {
    const goal=goals[i];
    const start=i===0 ? parent.spawn.pos : tile;
    const route=pathVerified(start,goal.pos,goal.range,
      i===0 ? allowed : new Set([targetRecord.roomName]),goal.ops);
    if (route === null)
      return {status:'DEFERRED',reason:'PATHFINDER_UNAVAILABLE'};
    if (!route)
      return {status:'REJECTED',reason:'CREEP_PATH_UNVERIFIED'};
    cost += route.cost;
    steps += route.steps;
  }
  return {status:'PASS',reason:null,site:tile,pathCost:cost,pathSteps:steps,
    checkedRoutes:goals.length,visionRooms:allowed.size};
}

module.exports={MAX_CANDIDATES,assess,_test:{
  sites,validPos,range,visible,currentTargetMatches,tileClear,pathVerified
}};
