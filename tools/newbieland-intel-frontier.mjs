// Conservative, bounded retained world-intel frontier for Newbieland.
// Diagnostic only: room names and recorded age, never a verified live route,
// room claim permission, source ID, private owner or game-state mutation.
const ROOM = /^[WE][0-9]+[NS][0-9]+$/;
const MAX_KNOWN_RECORDS = 512;
const MAX_FRONTIER_ROOMS = 32;
const MAX_HOPS = 3;
const MAX_CANDIDATE_AGE = 500;
const MAX_ROUTE_AGE = 150;
const validName = name => typeof name === 'string' && name.length <= 16 &&
  ROOM.test(name);
const validTick = n => Number.isSafeInteger(n) && n >= 0;
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function evaluateRecord(records, name, hops, journalTick) {
  const record = own(records, name) ? records[name] : null;
  if (!record) return { room: name, hops, status: 'MISSING_RECORD',
    intelAgeJournalTicks: null, routeFreshAtJournalTick: false };
  const observation = record.observation;
  const last = observation?.lastSeenTick;
  const age = validTick(last) && last <= journalTick
    ? journalTick - last : null;
  const base = { room: name, hops, intelAgeJournalTicks: age,
    routeFreshAtJournalTick: false };
  if (age === null || record.roomName !== name ||
      record.schemaVersion !== 1)
    return { ...base, status: 'INVALID_OR_FUTURE_RECORD' };
  if (age > MAX_CANDIDATE_AGE)
    return { ...base, status: 'STALE_OVER_500_TICKS' };
  if (!Number.isFinite(observation.confidence) ||
      observation.confidence < 0.95 ||
      !['scout', 'visible-room'].includes(observation.source))
    return { ...base, status: 'FULL_INTEL_NOT_VERIFIED' };
  if (record.classification?.roomStatus !== 'normal')
    return { ...base, status: 'NON_NORMAL_OR_UNKNOWN_ROOM_STATUS' };
  return { ...base, status: 'RECENT_TRUSTED_RECORD',
    routeFreshAtJournalTick: age <= MAX_ROUTE_AGE };
}

function eligibleToExplore(record, home) {
  if (!record || !record.controller ||
      record.threat?.hostileCreeps !== 0) return false;
  const c = record.controller;
  return home ? c.my === true :
    c.owner == null && c.reservationOwner == null;
}

export function summarizeRetainedIntelFrontier(bot, journalTick,
  homeRoom = 'E8N1') {
  const records = bot?.worldIntel?.rooms;
  if (!validName(homeRoom) || !validTick(journalTick) ||
      bot?.worldIntel?.schemaVersion !== 1 ||
      !records || typeof records !== 'object' ||
      Array.isArray(records))
    return { status: 'UNVERIFIED', reason: 'WORLD_INTEL_UNAVAILABLE' };

  if (Object.keys(records).length > MAX_KNOWN_RECORDS)
    return { status: 'UNVERIFIED', reason: 'WORLD_INTEL_TOO_LARGE' };
  if (!own(records, homeRoom))
    return { status: 'UNVERIFIED', reason: 'HOME_RECORD_UNAVAILABLE' };

  const queue = [{ room: homeRoom, hops: 0 }];
  const visited = new Set([homeRoom]);
  const rows = [];
  let truncated = false;
  for (let i = 0; i < queue.length; i++) {
    if (i >= MAX_FRONTIER_ROOMS) { truncated = true; break; }
    const node = queue[i];
    const row = evaluateRecord(records, node.room, node.hops,
      journalTick);
    rows.push(row);
    const record = own(records, node.room) ? records[node.room] : null;
    if (row.status !== 'RECENT_TRUSTED_RECORD' ||
        node.hops >= MAX_HOPS ||
        !eligibleToExplore(record, node.hops === 0)) continue;
    const exits = record.topology?.exits;
    if (!Array.isArray(exits) || exits.length > 4 ||
        exits.some(e => !validName(e?.roomName))) {
      return { status: 'UNVERIFIED', reason: 'FRONTIER_TOPOLOGY_INVALID' };
    }
    for (const name of exits.map(e => e.roomName).sort()) {
      if (!visited.has(name)) {
        visited.add(name);
        queue.push({ room: name, hops: node.hops + 1 });
      }
    }
  }

  return {
    status: 'OBSERVED_RETAINED',
    basis: 'LAST_RETAINED_JOURNAL_EVENT_NOT_SERVER_TICK',
    journalTick, homeRoom, maxHops: MAX_HOPS,
    routeVerified: false, currentGameTickVerified: false,
    visitedFrontierRooms: rows.length,
    missingOrUnverifiedRooms: rows.filter(r =>
      r.status !== 'RECENT_TRUSTED_RECORD').map(r => r.room),
    routeAgeOver150Rooms: rows.filter(r =>
      r.status === 'RECENT_TRUSTED_RECORD' &&
      !r.routeFreshAtJournalTick).map(r => r.room),
    frontierTruncated: truncated,
    rooms: rows
  };
}
