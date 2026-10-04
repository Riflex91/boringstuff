'use strict';

const SCHEMA_VERSION = 1;
const STATUS = Object.freeze({
  OPEN: 'OPEN',
  RESERVED: 'RESERVED',
  IN_PROGRESS: 'IN_PROGRESS',
  BLOCKED: 'BLOCKED',
  SATISFIED: 'SATISFIED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED'
});

function currentTick(game) {
  game = game || (typeof Game !== 'undefined' ? Game : null);
  return game && Number.isFinite(game.time) ? game.time : 0;
}

function ensure(memoryRoot) {
  memoryRoot = memoryRoot || (typeof Memory !== 'undefined' ? Memory : null);
  if (!memoryRoot) return { schemaVersion: SCHEMA_VERSION, rooms: {} };
  if (!memoryRoot.bot) memoryRoot.bot = {};
  if (!memoryRoot.bot.requestRegistry || memoryRoot.bot.requestRegistry.schemaVersion !== SCHEMA_VERSION) {
    memoryRoot.bot.requestRegistry = { schemaVersion: SCHEMA_VERSION, rooms: {} };
  }
  if (!memoryRoot.bot.requestRegistry.rooms) memoryRoot.bot.requestRegistry.rooms = {};
  return memoryRoot.bot.requestRegistry;
}

function ensureRoom(roomName, memoryRoot) {
  const registry = ensure(memoryRoot);
  if (!registry.rooms[roomName]) registry.rooms[roomName] = { requests: {}, lastReconcileTick: null };
  if (!registry.rooms[roomName].requests) registry.rooms[roomName].requests = {};
  return registry.rooms[roomName];
}

function safeKey(value) {
  return String(value || 'request').replace(/[^a-zA-Z0-9_.:@|-]/g, '_').slice(0, 180);
}

function requestId(roomName, dedupeKey) {
  return 'req|' + safeKey(roomName) + '|' + safeKey(dedupeKey);
}

function cloneTarget(target, roomName) {
  target = target || {};
  const pos = target.pos;
  return {
    roomName: target.roomName || roomName || null,
    id: target.id || null,
    pos: pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)
      ? { x: pos.x, y: pos.y, roomName: pos.roomName || target.roomName || roomName || null }
      : null
  };
}

function normalize(spec, roomName, tick) {
  spec = spec || {};
  const dedupeKey = safeKey(spec.dedupeKey || (spec.domain || 'unknown') + ':' + (spec.kind || 'unknown'));
  const amount = spec.demand && Number.isFinite(spec.demand.amount) ? Math.max(0, spec.demand.amount) : 0;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: requestId(roomName, dedupeKey),
    dedupeKey,
    domain: spec.domain || 'unknown',
    kind: spec.kind || 'unknown',
    createdTick: tick,
    updatedTick: tick,
    deadlineTick: Number.isFinite(spec.deadlineTick) ? spec.deadlineTick : null,
    target: cloneTarget(spec.target, roomName),
    demand: {
      resourceType: spec.demand ? spec.demand.resourceType || null : null,
      capability: spec.demand ? spec.demand.capability || null : null,
      amount,
      minimumUsefulAmount: spec.demand && Number.isFinite(spec.demand.minimumUsefulAmount) ? Math.max(0, spec.demand.minimumUsefulAmount) : null,
      maximumUsefulAmount: spec.demand && Number.isFinite(spec.demand.maximumUsefulAmount) ? Math.max(0, spec.demand.maximumUsefulAmount) : null
    },
    priority: {
      base: spec.priority && Number.isFinite(spec.priority.base) ? spec.priority.base : 0,
      urgency: spec.priority && Number.isFinite(spec.priority.urgency) ? spec.priority.urgency : 0,
      strategicClass: spec.priority && spec.priority.strategicClass ? spec.priority.strategicClass : 'STANDARD'
    },
    utility: {
      current: spec.utility && Number.isFinite(spec.utility.current) ? spec.utility.current : 0,
      marginalModel: spec.utility && spec.utility.marginalModel ? spec.utility.marginalModel : 'LINEAR'
    },
    risk: Number.isFinite(spec.risk) ? spec.risk : 0,
    dependencies: Array.isArray(spec.dependencies) ? spec.dependencies.slice(0, 20) : [],
    status: STATUS.OPEN,
    progress: {
      amount: 0,
      lastProgressTick: null
    },
    reservations: [],
    blocked: { untilTick: null, reason: null, failureCount: 0 },
    evidence: {
      source: spec.evidence && spec.evidence.source ? spec.evidence.source : 'unknown',
      hypothesis: spec.evidence && spec.evidence.hypothesis ? spec.evidence.hypothesis : null
    },
    shadow: spec.shadow !== false
  };
}

function expireReservations(request, tick) {
  const before = request.reservations.length;
  request.reservations = request.reservations.filter(r => !Number.isFinite(r.validUntilTick) || r.validUntilTick >= tick);
  if (before !== request.reservations.length && !request.reservations.length && request.status === STATUS.RESERVED) {
    request.status = STATUS.OPEN;
  }
}

function maybeUnblock(request, tick) {
  if (request.status !== STATUS.BLOCKED) return;
  if (!Number.isFinite(request.blocked.untilTick) || tick < request.blocked.untilTick) return;
  request.status = STATUS.OPEN;
  request.blocked.untilTick = null;
  request.blocked.reason = null;
}

function upsert(roomName, spec, memoryRoot, game) {
  const tick = currentTick(game);
  const room = ensureRoom(roomName, memoryRoot);
  const normalized = normalize(spec, roomName, tick);
  let request = room.requests[normalized.dedupeKey];

  if (!request || request.schemaVersion !== SCHEMA_VERSION) {
    request = normalized;
    room.requests[normalized.dedupeKey] = request;
  } else {
    expireReservations(request, tick);
    maybeUnblock(request, tick);
    const preserved = {
      createdTick: request.createdTick,
      status: request.status,
      progress: request.progress,
      reservations: request.reservations,
      blocked: request.blocked
    };
    Object.assign(request, normalized);
    request.createdTick = preserved.createdTick;
    request.status = preserved.status;
    request.progress = preserved.progress;
    request.reservations = preserved.reservations;
    request.blocked = preserved.blocked;
    if (request.status === STATUS.SATISFIED || request.status === STATUS.EXPIRED || request.status === STATUS.CANCELLED) {
      request.status = STATUS.OPEN;
      request.progress = { amount: 0, lastProgressTick: null };
    }
  }

  request.updatedTick = tick;
  request._seenTick = tick;
  return request;
}

function reserve(roomName, dedupeKey, reservation, memoryRoot, game) {
  const tick = currentTick(game);
  const room = ensureRoom(roomName, memoryRoot);
  const request = room.requests[safeKey(dedupeKey)];
  if (!request) return null;
  expireReservations(request, tick);
  reservation = reservation || {};
  const ownerType = reservation.ownerType || 'unknown';
  const ownerId = reservation.ownerId || 'unknown';
  const id = 'res|' + safeKey(request.id) + '|' + safeKey(ownerType) + '|' + safeKey(ownerId);
  const existing = request.reservations.find(r => r.id === id);
  const value = {
    id,
    requestId: request.id,
    ownerType,
    ownerId,
    amount: Number.isFinite(reservation.amount) ? Math.max(0, reservation.amount) : 0,
    createdTick: existing ? existing.createdTick : tick,
    validUntilTick: Number.isFinite(reservation.validUntilTick) ? reservation.validUntilTick : null,
    revalidateOn: reservation.revalidateOn || null
  };
  if (existing) Object.assign(existing, value);
  else request.reservations.push(value);
  request.status = STATUS.RESERVED;
  request.updatedTick = tick;
  return value;
}

function releaseReservation(roomName, dedupeKey, reservationId, memoryRoot, game) {
  const tick = currentTick(game);
  const room = ensureRoom(roomName, memoryRoot);
  const request = room.requests[safeKey(dedupeKey)];
  if (!request) return false;
  const before = request.reservations.length;
  request.reservations = request.reservations.filter(r => r.id !== reservationId);
  if (!request.reservations.length && request.status === STATUS.RESERVED) request.status = STATUS.OPEN;
  request.updatedTick = tick;
  return request.reservations.length !== before;
}

function setStatus(roomName, dedupeKey, status, memoryRoot, game) {
  if (!STATUS[status] && Object.keys(STATUS).map(k => STATUS[k]).indexOf(status) < 0) return null;
  const tick = currentTick(game);
  const room = ensureRoom(roomName, memoryRoot);
  const request = room.requests[safeKey(dedupeKey)];
  if (!request) return null;
  request.status = status;
  request.updatedTick = tick;
  if (status === STATUS.SATISFIED || status === STATUS.CANCELLED || status === STATUS.EXPIRED) request.reservations = [];
  return request;
}

function block(roomName, dedupeKey, reason, untilTick, memoryRoot, game) {
  const tick = currentTick(game);
  const room = ensureRoom(roomName, memoryRoot);
  const request = room.requests[safeKey(dedupeKey)];
  if (!request) return null;
  request.status = STATUS.BLOCKED;
  request.blocked.untilTick = Number.isFinite(untilTick) ? untilTick : tick + 1;
  request.blocked.reason = reason || 'UNKNOWN';
  request.blocked.failureCount = (request.blocked.failureCount || 0) + 1;
  request.updatedTick = tick;
  return request;
}

function progress(roomName, dedupeKey, amount, memoryRoot, game) {
  const tick = currentTick(game);
  const room = ensureRoom(roomName, memoryRoot);
  const request = room.requests[safeKey(dedupeKey)];
  if (!request) return null;
  const delta = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  request.progress.amount = Math.min(request.demand.amount, Math.max(0, request.progress.amount || 0) + delta);
  request.progress.lastProgressTick = tick;
  request.updatedTick = tick;
  request.status = request.progress.amount >= request.demand.amount ? STATUS.SATISFIED : STATUS.IN_PROGRESS;
  if (request.status === STATUS.SATISFIED) request.reservations = [];
  return request;
}

function reconcile(roomName, activeDedupeKeys, memoryRoot, game) {
  const tick = currentTick(game);
  const room = ensureRoom(roomName, memoryRoot);
  const active = {};
  for (const key of activeDedupeKeys || []) active[safeKey(key)] = true;
  let satisfied = 0;
  let expired = 0;

  for (const key in room.requests) {
    const request = room.requests[key];
    expireReservations(request, tick);
    maybeUnblock(request, tick);
    if (Number.isFinite(request.deadlineTick) && tick > request.deadlineTick && request.status !== STATUS.SATISFIED) {
      request.status = STATUS.EXPIRED;
      request.updatedTick = tick;
      request.reservations = [];
      expired += 1;
      continue;
    }
    if (active[key]) continue;
    if (request._seenTick === tick) continue;
    if (request.status !== STATUS.SATISFIED && request.status !== STATUS.EXPIRED && request.status !== STATUS.CANCELLED) {
      request.status = STATUS.SATISFIED;
      request.updatedTick = tick;
      request.reservations = [];
      satisfied += 1;
    }
  }

  room.lastReconcileTick = tick;
  return { satisfied, expired };
}

function list(roomName, memoryRoot, options) {
  const room = ensureRoom(roomName, memoryRoot);
  options = options || {};
  const statuses = options.statuses || null;
  return Object.keys(room.requests).sort().map(key => room.requests[key]).filter(request => {
    if (!statuses) return true;
    return statuses.indexOf(request.status) >= 0;
  });
}

function snapshot(roomName, memoryRoot) {
  const requests = list(roomName, memoryRoot);
  const byStatus = {};
  const byDomain = {};
  let reservationCount = 0;
  let blocked = 0;
  for (const request of requests) {
    byStatus[request.status] = (byStatus[request.status] || 0) + 1;
    byDomain[request.domain] = (byDomain[request.domain] || 0) + 1;
    reservationCount += request.reservations.length;
    if (request.status === STATUS.BLOCKED) blocked += 1;
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    authority: 'SHADOW',
    total: requests.length,
    open: (byStatus.OPEN || 0) + (byStatus.RESERVED || 0) + (byStatus.IN_PROGRESS || 0),
    blocked,
    reservationCount,
    byStatus,
    byDomain
  };
}

module.exports = {
  SCHEMA_VERSION,
  STATUS,
  ensure,
  ensureRoom,
  upsert,
  reserve,
  releaseReservation,
  setStatus,
  block,
  progress,
  reconcile,
  list,
  snapshot,
  _test: { safeKey, requestId, normalize, expireReservations, maybeUnblock }
};