import { summarizeRoom } from './spawn-planner-core.mjs';

const ROOM_SIZE = 50;
const idx = (x, y) => y * ROOM_SIZE + x;

export function normalizeRoomStatusResponse(raw) {
  const candidates = [
    raw?.room?.status,
    raw?.status,
    raw?.data?.room?.status,
    raw?.data?.status
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim().toLowerCase();
  }

  const room = raw?.room || raw?.data?.room || raw || {};
  const now = Date.now();
  const novice = Number(room?.novice ?? raw?.novice);
  if (Number.isFinite(novice) && novice * 1000 > now) return 'novice';
  const respawn = Number(room?.respawnArea ?? room?.respawn ?? raw?.respawnArea ?? raw?.respawn);
  if (Number.isFinite(respawn) && respawn * 1000 > now) return 'respawn';
  return null;
}

export function inspectSpawnTile({ encodedTerrain, objects = [], x, y }) {
  const issues = [];
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return { ok: false, x, y, issues: ['coordinates-not-integers'], terrain: null, wall: null, swamp: null, occupiedBy: [] };
  }
  if (x < 0 || x >= ROOM_SIZE || y < 0 || y >= ROOM_SIZE) issues.push('coordinates-out-of-room');
  if (x === 0 || x === 49 || y === 0 || y === 49) issues.push('border-tile');

  let wall = null;
  let swamp = null;
  let terrain = null;
  if (typeof encodedTerrain !== 'string' || encodedTerrain.length < ROOM_SIZE * ROOM_SIZE) {
    issues.push('terrain-missing-or-invalid');
  } else if (x >= 0 && x < ROOM_SIZE && y >= 0 && y < ROOM_SIZE) {
    const value = Number(encodedTerrain[idx(x, y)]) || 0;
    wall = (value & 1) !== 0;
    swamp = (value & 2) !== 0;
    terrain = wall ? 'wall' : swamp ? 'swamp' : 'plain';
    if (wall) issues.push('wall-tile');
  }

  const occupiedBy = objects
    .filter(o => Number.isInteger(o?.x) && Number.isInteger(o?.y) && o.x === x && o.y === y)
    .map(o => ({
      type: o.type || o.structureType || 'object',
      id: o._id || o.id || null,
      decayTime: Number.isFinite(Number(o.decayTime)) ? Number(o.decayTime) : null,
      ticksToDecay: Number.isFinite(Number(o.ticksToDecay)) ? Number(o.ticksToDecay) : null
    }));

  // Screeps ruins are walkable and the backend's initial-spawn placement
  // validation does not treat them as blocking construction objects. Keep
  // them in evidence, but do not reject an otherwise valid tile because a
  // respawn ruin is still present there.
  const nonBlockingTypes = new Set(['ruin']);
  const blockingObjects = occupiedBy.filter(o => !nonBlockingTypes.has(o.type));
  const nonBlockingObjects = occupiedBy.filter(o => nonBlockingTypes.has(o.type));
  if (blockingObjects.length) issues.push('occupied-tile');

  return {
    ok: issues.length === 0,
    x,
    y,
    terrain,
    wall,
    swamp,
    occupiedBy,
    blockingObjects,
    nonBlockingObjects,
    issues
  };
}

function check(name, pass, details = {}, severity = 'error') {
  return { name, pass: Boolean(pass), severity, ...details };
}

export async function verifyInitialSpawnTarget({
  api,
  room,
  x,
  y,
  name,
  myUserId = null,
  branch = 'chatgpt',
  requireNormalStatus = true,
  requireUniqueName = true
}) {
  const checks = [];
  const evidence = {
    generatedAt: new Date().toISOString(),
    target: { room, x, y, name },
    placementEndpointCalled: false
  };

  let worldStatus = null;
  try {
    const raw = await api.userWorldStatus();
    worldStatus = typeof raw?.status === 'string' ? raw.status.toLowerCase() : null;
    evidence.worldStatusRaw = raw;
    checks.push(check('world-status-empty', worldStatus === 'empty', { actual: worldStatus, expected: 'empty' }));
  } catch (err) {
    checks.push(check('world-status-empty', false, { error: String(err?.message || err) }));
  }

  let roomStatus = null;
  try {
    const raw = await api.gameRoomStatus(room);
    roomStatus = normalizeRoomStatusResponse(raw);
    evidence.roomStatusRaw = raw;
    checks.push(check('room-status-normal', !requireNormalStatus || roomStatus === 'normal', { actual: roomStatus, expected: requireNormalStatus ? 'normal' : 'available' }));
  } catch (err) {
    checks.push(check('room-status-normal', false, { error: String(err?.message || err), expected: 'normal' }));
  }

  let objects = [];
  let users = {};
  let summary = null;
  try {
    const raw = await api.gameRoomObjects(room);
    objects = Array.isArray(raw?.objects) ? raw.objects : [];
    users = raw?.users && typeof raw.users === 'object' ? raw.users : {};
    summary = summarizeRoom({ roomName: room, objects, users, myUserId, valid: true, roomStatus });
    evidence.roomSummary = summary;
    checks.push(check('controller-exists', Boolean(summary.controller), { controller: summary.controller || null }));
    checks.push(check('controller-unowned', Boolean(summary.controller) && !summary.ownerId, { ownerId: summary.ownerId || null, ownerName: summary.ownerName || null }));
    checks.push(check('controller-unreserved', Boolean(summary.controller) && !summary.reservationId, { reservationId: summary.reservationId || null, reservationName: summary.reservationName || null }));
  } catch (err) {
    checks.push(check('room-objects-readable', false, { error: String(err?.message || err) }));
  }

  let tile = null;
  try {
    const terrainRaw = await api.gameRoomTerrain(room);
    const encodedTerrain = terrainRaw?.terrain?.[0]?.terrain;
    tile = inspectSpawnTile({ encodedTerrain, objects, x, y });
    evidence.tile = tile;
    checks.push(check('spawn-tile-free-and-buildable', tile.ok, { terrain: tile.terrain, issues: tile.issues, occupiedBy: tile.occupiedBy, blockingObjects: tile.blockingObjects, nonBlockingObjects: tile.nonBlockingObjects }));
  } catch (err) {
    checks.push(check('spawn-tile-free-and-buildable', false, { error: String(err?.message || err) }));
  }

  if (requireUniqueName) {
    try {
      const raw = await api.gameCheckUniqueObjectName('spawn', name);
      evidence.spawnNameCheckRaw = raw;
      checks.push(check('spawn-name-available', true, { spawnName: name }));
    } catch (err) {
      checks.push(check('spawn-name-available', false, { spawnName: name, error: String(err?.message || err) }));
    }
  }

  try {
    const branches = await api.userBranches();
    const list = Array.isArray(branches?.list) ? branches.list : [];
    const exists = list.some(v => v?.branch === branch);
    evidence.branchList = list.map(v => v?.branch).filter(Boolean);
    checks.push(check('world-branch-present', exists, { branchName: branch }, 'warning'));
  } catch (err) {
    checks.push(check('world-branch-present', false, { branchName: branch, error: String(err?.message || err) }, 'warning'));
  }

  const failures = checks.filter(c => c.severity === 'error' && !c.pass);
  const warnings = checks.filter(c => c.severity === 'warning' && !c.pass);
  return {
    ok: failures.length === 0,
    room,
    x,
    y,
    name,
    branch,
    worldStatus,
    roomStatus,
    summary,
    tile,
    checks,
    failures,
    warnings,
    placementPreconditionsPass: failures.length === 0,
    evidence
  };
}
