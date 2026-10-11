'use strict';

// Bounded, read-only I3 reconnaissance over actually observed I0 room intel.
// Graph adjacency is NOT a pathfinder route or a valid claim/placement decision.
const SCHEMA_VERSION = 1;
const ROOM_NAME = /^[WE][0-9]+[NS][0-9]+$/;
const MAX_HOPS = 3;
const MAX_VISITS = 100;
const MAX_AGE = 500;
const TOP_LIMIT = 3;

function validRoomName(value) {
  return typeof value === 'string' && ROOM_NAME.test(value) && value.length <= 20;
}

function safeRecord(record, name, tick) {
  if (!record || record.roomName !== name || record.schemaVersion !== 1 ||
      !record.observation || !Number.isSafeInteger(record.observation.lastSeenTick) ||
      record.observation.lastSeenTick > tick ||
      tick - record.observation.lastSeenTick > MAX_AGE ||
      !Number.isFinite(record.observation.confidence) ||
      record.observation.confidence < 0.95 ||
      !['visible-room', 'scout'].includes(record.observation.source)) return false;
  return record.classification?.roomStatus === 'normal';
}

function safeTransit(record) {
  const controller = record.controller;
  // Never infer safety across a known hostile-owned or reserved transit room.
  return controller && controller.owner == null &&
    controller.reservationOwner == null &&
    record.threat && record.threat.hostileCreeps === 0;
}

function safeClaimCandidate(record, tick) {
  const controller = record.controller;
  const resources = record.resources;
  const structures = record.structures;
  if (!controller || controller.exists !== true || controller.my !== false ||
      controller.owner != null || controller.reservationOwner != null ||
      controller.level !== 0 ||
      !resources || !Number.isSafeInteger(resources.sourceCount) ||
      resources.sourceCount < 2 || resources.sourceCount > 3 ||
      !Array.isArray(resources.sources) ||
      resources.sources.length !== resources.sourceCount ||
      resources.sources.some(s => !s || typeof s.id !== 'string' || !s.id ||
        !s.pos || !Number.isInteger(s.pos.x) || !Number.isInteger(s.pos.y)) ||
      !structures || !Number.isSafeInteger(structures.count) ||
      structures.count < 0 ||
      !structures.ownedByType || typeof structures.ownedByType !== 'object' ||
      Object.values(structures.ownedByType).some(n => !Number.isSafeInteger(n) || n !== 0) ||
      !record.threat || record.threat.hostileCreeps !== 0) return false;
  const lastHostile = record.threat.lastHostileTick;
  if (lastHostile !== null &&
      (!Number.isSafeInteger(lastHostile) || lastHostile > tick ||
       tick - lastHostile < 1500)) return false;
  return true;
}

function safeParent(state) {
  return !!(state && state.room && validRoomName(state.room.name) &&
    state.room.controller?.my === true && state.spawn &&
    !state.emergency && Number.isFinite(state.rcl) && state.rcl >= 4 &&
    state.health?.status === 'HEALTHY' &&
    Array.isArray(state.hostileCreeps) && state.hostileCreeps.length === 0 &&
    Number.isFinite(state.economyModel?.haulerCarryDeficit) &&
    state.economyModel.haulerCarryDeficit <= 0);
}

function evaluate(readiness, roomStates, game, memoryRoot) {
  const base = {schemaVersion:SCHEMA_VERSION,authority:'SHADOW',
    claimActionEnabled:false,placementEnabled:false,
    routeVerified:false,selectedRoom:null,scoreModel:'bounded-intel-recon-v1',
    candidateCount:0,topCandidates:[],visitedRooms:0,
    unknownOrStaleRooms:0,frontierTruncated:false,reason:null};
  if (!readiness || readiness.authority !== 'SHADOW' ||
      readiness.claimActionEnabled !== false ||
      readiness.status !== 'PLANNING_CANDIDATE' ||
      !Number.isSafeInteger(readiness.availableClaimSlots) ||
      readiness.availableClaimSlots <= 0) {
    return {...base,status:'HOLD',reason:'EXPANSION_BUDGET_NOT_READY'};
  }
  const tick = game?.time;
  const records = memoryRoot?.bot?.worldIntel?.rooms;
  if (!Number.isSafeInteger(tick) || !records || typeof records !== 'object') {
    return {...base,status:'UNVERIFIED',reason:'FRESH_INTEL_UNAVAILABLE'};
  }
  const parents = (Array.isArray(roomStates) ? roomStates : [])
    .filter(safeParent).map(s=>s.room.name).sort();
  if (!parents.length) return {...base,status:'HOLD',reason:'NO_HEALTHY_PARENT'};
  const queue=parents.map(roomName=>({roomName,hops:0,parent:roomName}));
  const visited=new Set(parents);
  const candidates=[];
  let unknownOrStaleRooms=0;
  let visits=0;
  for (let index=0;index<queue.length && visits<MAX_VISITS;index++) {
    const node=queue[index];
    visits++;
    const record=Object.prototype.hasOwnProperty.call(records,node.roomName)
      ? records[node.roomName] : null;
    if (!safeRecord(record,node.roomName,tick)) {
      unknownOrStaleRooms++;
      continue;
    }
    if (node.hops>0 && safeClaimCandidate(record,tick)) {
      const sourceCount=record.resources.sourceCount;
      const mineralPresent=!!record.resources.mineral?.type;
      const exits=Array.isArray(record.topology?.exits)
        ? record.topology.exits.length : 0;
      candidates.push({roomName:node.roomName,parentRoom:node.parent,
        hops:node.hops,sourceCount,
        reconScore:sourceCount*40-node.hops*15+
          (mineralPresent?4:0)+Math.min(4,exits)*2,
        intelAge:tick-record.observation.lastSeenTick,
        observationSource:record.observation.source});
    }
    if (node.hops>=MAX_HOPS || !safeTransit(record) ||
        !Array.isArray(record.topology?.exits)) continue;
    const neighbors=record.topology.exits
      .map(e=>e?.roomName).filter(validRoomName).sort();
    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push({roomName:neighbor,hops:node.hops+1,parent:node.parent});
    }
  }
  candidates.sort((a,b)=>b.reconScore-a.reconScore ||
    a.hops-b.hops || a.roomName.localeCompare(b.roomName));
  return {...base,status:candidates.length?'ADVISORY_ONLY':'NEEDS_MORE_INTEL',
    reason:candidates.length?null:'NO_VERIFIED_LOCAL_CANDIDATES',
    candidateCount:candidates.length,topCandidates:candidates.slice(0,TOP_LIMIT),
    visitedRooms:visits,unknownOrStaleRooms,
    frontierTruncated:queue.length>visits};
}

module.exports={SCHEMA_VERSION,evaluate,_test:{
  validRoomName,safeRecord,safeTransit,safeClaimCandidate,safeParent
}};
