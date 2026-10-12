'use strict';

// E5 is evidence-only. There is deliberately no code path to change roles,
// move creeps, transfer energy, build structures or select a live topology.
const SCHEMA_VERSION = 1;
const MODES = Object.freeze([
  'SELF_HAUL', 'SOURCE_LANE', 'POOLED_HAUL', 'LINKS_HUB', 'TERMINAL'
]);

function finiteNonnegative(n) {
  return Number.isFinite(n) && n >= 0;
}
function roomPosition(object, roomName) {
  const p = object && object.pos;
  return p && Number.isSafeInteger(p.x) && Number.isSafeInteger(p.y) &&
    p.x >= 0 && p.x < 50 && p.y >= 0 && p.y < 50 &&
    (!p.roomName || p.roomName === roomName) ? p : null;
}
function near(a, b, roomName) {
  const p = roomPosition(a, roomName), q = roomPosition(b, roomName);
  return !!p && !!q && Math.max(Math.abs(p.x-q.x),Math.abs(p.y-q.y)) <= 2;
}
function validWindow(w, now) {
  if (!w || w.schemaVersion !== 2 || w.authority !== 'SHADOW_EVIDENCE' ||
      !Number.isSafeInteger(now) || !Number.isSafeInteger(w.startTick) ||
      !Number.isSafeInteger(w.endTick) || w.endTick !== now ||
      w.ticks !== 100 || w.endTick-w.startTick !== 99 ||
      !finiteNonnegative(w.deferredRatio) || w.deferredRatio > 1) return false;
  for (const key of ['haulerUtilization','averageConsumerWaiting',
    'averageConsumerCritical','averageConsumerFallback',
    'averagePredictedTransportTicks','criticalRequestTicks',
    'unmatchedCriticalTicks','duplicateReservationTicks']) {
    if (!finiteNonnegative(w[key])) return false;
  }
  return w.haulerUtilization <= 1 &&
    Number.isSafeInteger(w.criticalRequestTicks) &&
    Number.isSafeInteger(w.unmatchedCriticalTicks) &&
    Number.isSafeInteger(w.duplicateReservationTicks) &&
    w.unmatchedCriticalTicks <= w.criticalRequestTicks &&
    w.duplicateReservationTicks <= w.ticks;
}
function deferred(now, roomName, reason) {
  return {
    schemaVersion: SCHEMA_VERSION, authority:'SHADOW',
    actionAuthority:'NONE', roomName:roomName || null, tick:now,
    status:'DEFERRED', reason, currentTopology:null,
    baseline:null, candidates:[], switchAuthorized:false,
    economicWinner:null
  };
}
function inspectTopology(state, completedWindow, game) {
  game = game || (typeof Game !== 'undefined' ? Game : null);
  const now = game && game.time;
  const roomName = state && state.room && state.room.name;
  if (!roomName || !Number.isSafeInteger(now) || now < 0)
    return deferred(null,roomName,'NO_VALID_ROOM_OR_TICK');
  if (!validWindow(completedWindow,now))
    return deferred(now,roomName,'NO_FRESH_COMPLETE_E4_WINDOW');

  // E4 matching snapshots are projected assignments, not settled transports.
  // These metrics may describe current pressure but cannot price new modes.
  const baseline = {
    observedTicks:completedWindow.ticks,
    startTick:completedWindow.startTick,endTick:completedWindow.endTick,
    deferredRatio:completedWindow.deferredRatio,
    averageConsumerWaiting:completedWindow.averageConsumerWaiting,
    averageConsumerFallback:completedWindow.averageConsumerFallback,
    averageConsumerCritical:completedWindow.averageConsumerCritical,
    unmatchedCriticalTicks:completedWindow.unmatchedCriticalTicks,
    duplicateReservationTicks:completedWindow.duplicateReservationTicks,
    haulerUtilization:completedWindow.haulerUtilization,
    predictedTransportTicks:completedWindow.averagePredictedTransportTicks,
    measuredTransportEnergyPerTick:null, measuredTransportCpuPerTick:null,
    settledDeliveryLatency:null
  };
  const structures=Array.isArray(state.structures) ? state.structures : [];
  const sources=Array.isArray(state.sources) ? state.sources : [];
  const creeps=Array.isArray(state.creeps) ? state.creeps : [];
  const links=structures.filter(s=>s && s.my===true &&
    s.structureType==='link');
  const storages=structures.filter(s=>s && s.my===true &&
    s.structureType==='storage');
  const terminals=structures.filter(s=>s && s.my===true &&
    s.structureType==='terminal');
  const haulerIds=new Set(creeps.filter(c=>c && !c.spawning &&
    c.memory && c.memory.role==='hauler' && (c.id||c.name))
    .map(c=>c.id||c.name));
  const rawRoutes=state.economyModel && state.economyModel.sourceRoutes;
  const routeById=new Map();
  let routeEvidence=Array.isArray(rawRoutes);
  for(const r of Array.isArray(rawRoutes)?rawRoutes:[]){
    if (!r || typeof r.sourceId!=='string' || !r.sourceId ||
        routeById.has(r.sourceId) || !Number.isSafeInteger(r.spawnDistance) ||
        r.spawnDistance < 0 || typeof r.containerReady!=='boolean') {
      routeEvidence=false;
      break;
    }
    routeById.set(r.sourceId,r);
  }
  const ids=sources.map(s=>s&&s.id);
  const distinctSources=ids.length>0 && ids.every(id=>typeof id==='string'&&!!id) &&
    new Set(ids).size===ids.length;
  const sourceRoutesReady=routeEvidence && distinctSources &&
    routeById.size===sources.length &&
    sources.every(s=>routeById.has(s.id));
  const sourceLanePossible=sourceRoutesReady &&
    sources.every(s=>routeById.get(s.id).containerReady===true);
  const linkSource=sourceRoutesReady && links.some(l=>sources.some(s=>near(l,s,roomName)));
  const linkHub=storages.length===1 && links.some(l=>near(l,storages[0],roomName));
  const hasLinkPair=links.length>=2 && linkSource && linkHub;
  const infra = [
    {mode:'SELF_HAUL',ready:distinctSources,
      blocker:distinctSources?null:'SOURCE_IDENTITY_NOT_VERIFIED'},
    {mode:'SOURCE_LANE',ready:sourceLanePossible,
      blocker:sourceRoutesReady?'SOURCE_CONTAINER_INCOMPLETE':'SOURCE_ROUTE_NOT_VERIFIED'},
    {mode:'POOLED_HAUL',ready:sourceLanePossible && sources.length>=2 && haulerIds.size>=2,
      blocker:!sourceLanePossible?'SOURCE_LANE_NOT_ELIGIBLE':
        sources.length<2?'INSUFFICIENT_INDEPENDENT_SOURCES':'INSUFFICIENT_HAULER_IDENTITIES'},
    {mode:'LINKS_HUB',ready:hasLinkPair,
      blocker:hasLinkPair?null:'LINK_SOURCE_AND_HUB_PAIR_NOT_VERIFIED'},
    {mode:'TERMINAL',ready:storages.length===1 && terminals.length===1,
      blocker:storages.length===1&&terminals.length===1?null:'OWNED_STORAGE_AND_TERMINAL_NOT_VERIFIED'}
  ];
  const candidates=infra.map(c=>({
    mode:c.mode,
    infrastructureStatus:c.ready?'POSSIBLE':'BLOCKED',
    blocker:c.ready?null:c.blocker,
    economicStatus:'UNVERIFIED',
    decision:'NO_SWITCH'
  }));
  return {
    schemaVersion:SCHEMA_VERSION,authority:'SHADOW',
    actionAuthority:'NONE',roomName,tick:now,status:'OBSERVATION_ONLY',
    reason:'MISSING_COMPARABLE_SETTLED_ROUTE_ENERGY_CPU_AND_LATENCY',
    currentTopology:state.economyModel && typeof state.economyModel.mode==='string'
      ? state.economyModel.mode:null,
    baseline,candidates,switchAuthorized:false,economicWinner:null,
    measuredInfrastructure:{
      sourceCount:sources.length,haulerCount:haulerIds.size,
      sourceRoutesVerified:!!sourceRoutesReady,
      allSourceContainersReady:!!sourceLanePossible,
      ownedStorageCount:storages.length,ownedLinkCount:links.length,
      ownedTerminalCount:terminals.length
    }
  };
}
function telemetrySummary(report) {
  if (!report) return null;
  return {
    authority:report.authority,actionAuthority:'NONE',
    status:report.status,reason:report.reason,
    evidenceTicks:report.baseline?report.baseline.observedTicks:null,
    readyInfrastructureModes:report.candidates.filter(c=>
      c.infrastructureStatus==='POSSIBLE').map(c=>c.mode),
    economicWinner:null,switchAuthorized:false
  };
}
module.exports={
  SCHEMA_VERSION,MODES,inspectTopology,telemetrySummary,
  _test:{validWindow,near}
};
