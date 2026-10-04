import assert from 'node:assert/strict';
import {
  adjacentRemoteRouteCost,
  analyzeRoom,
  applyNeighborhoodScore,
  computeCategoryScores,
  evaluateExpansionCorridor,
  evaluateNeighborhood,
  estimateDefensePerimeter,
  simulateRcl8Blueprint,
  roomNameToXY,
  roomWithinWorldDimensions,
  roomsAround,
  summarizeRoom,
  worldBoundsFromSize,
  xyToRoomName
} from './spawn-planner-core.mjs';

assert.deepEqual(roomNameToXY('E0S0'), { x: 0, y: 0 });
assert.deepEqual(roomNameToXY('W0N0'), { x: -1, y: -1 });
assert.equal(xyToRoomName(-1, -1), 'W0N0');
assert.equal(xyToRoomName(0, 0), 'E0S0');
assert.equal(roomsAround('W0N0', 1).length, 9);
assert.deepEqual(worldBoundsFromSize(24), { min: -12, max: 11, size: 24 });
assert.equal(roomWithinWorldDimensions('W11N11', 24, 24), true);
assert.equal(roomWithinWorldDimensions('E11S11', 24, 24), true);
assert.equal(roomWithinWorldDimensions('W12N11', 24, 24), false);
assert.equal(roomWithinWorldDimensions('W11N12', 24, 24), false);

const terrain = Array(2500).fill('0');
for (let x = 0; x < 50; x++) {
  terrain[x] = '1';
  terrain[49 * 50 + x] = '1';
}
for (let y = 0; y < 50; y++) {
  terrain[y * 50] = '1';
  terrain[y * 50 + 49] = '1';
}
// Four moderate exits so the defense model has real border goals.
for (let x = 20; x <= 27; x++) {
  terrain[x] = '0';
  terrain[49 * 50 + x] = '0';
}
for (let y = 20; y <= 27; y++) {
  terrain[y * 50] = '0';
  terrain[y * 50 + 49] = '0';
}

const objects = [
  { _id: 'ctrl', type: 'controller', room: 'W1N1', x: 25, y: 40, level: 0 },
  { _id: 's1', type: 'source', room: 'W1N1', x: 12, y: 12 },
  { _id: 's2', type: 'source', room: 'W1N1', x: 38, y: 12 },
  { _id: 'min', type: 'mineral', room: 'W1N1', x: 40, y: 40 }
];
const result = analyzeRoom({ roomName: 'W1N1', encodedTerrain: terrain.join(''), objects, roomStatus: 'normal', myUserId: 'me', topN: 5 });
assert.equal(result.eligible, true);
assert.equal(result.sourceCount, 2);
assert.ok(result.best.x >= 4 && result.best.x <= 45);
assert.ok(result.best.y >= 4 && result.best.y <= 45);
assert.ok(result.candidates.length >= 1);
assert.ok(result.best.layout.effectiveSlots > 0);
assert.equal(typeof result.best.layout.labReady, 'boolean');
assert.ok(result.best.exitSides >= 1);
assert.ok(result.best.nearestExitCost >= 0);
assert.ok(result.best.sourceAccessSlots.length === 2);
assert.ok(result.best.scoreBreakdown.layoutHeadroom !== undefined);

const reserved = JSON.parse(JSON.stringify(objects));
reserved[0].reservation = { user: 'enemy' };
const result2 = analyzeRoom({ roomName: 'W1N1', encodedTerrain: terrain.join(''), objects: reserved, roomStatus: 'normal', myUserId: 'me' });
assert.equal(result2.eligible, false);
assert.equal(result2.reason, 'RESERVED_BY_OTHER');

const closed = analyzeRoom({ roomName: 'W1N1', encodedTerrain: terrain.join(''), objects, roomStatus: 'closed', myUserId: 'me' });
assert.equal(closed.eligible, false);
assert.equal(closed.reason, 'ROOM_UNAVAILABLE');

const summaries = new Map();
summaries.set('E1S0', summarizeRoom({
  roomName: 'E1S0', myUserId: 'me', valid: true,
  objects: [
    { type: 'controller', x: 25, y: 25, level: 0 },
    { type: 'source', x: 10, y: 10 },
    { type: 'source', x: 40, y: 40 }
  ]
}));
summaries.set('W0S0', summarizeRoom({
  roomName: 'W0S0', myUserId: 'me', valid: true,
  objects: [
    { type: 'controller', x: 25, y: 25, level: 3, user: 'enemy' },
    { type: 'source', x: 10, y: 10 }
  ]
}));
const neighborhood = evaluateNeighborhood('E0S0', summaries, 1);
assert.equal(neighborhood.adjacentRemoteSources, 2);
assert.equal(neighborhood.hostileOwned, 1);
assert.ok(neighborhood.expansionPotential > 0);
assert.ok(neighborhood.details.length >= 2);

const withStrategy = applyNeighborhoodScore(result, { score: 123.4, adjacentRemoteSources: 3 });
assert.equal(withStrategy.strategicScore, Math.round((result.baseRoomScore + 123.4) * 10) / 10);
assert.equal(withStrategy.neighborhood.adjacentRemoteSources, 3);


assert.ok(result.best.blueprint);
assert.equal(typeof result.best.blueprint.complete, 'boolean');
assert.ok(result.best.blueprint.structureRequired >= 80);
assert.ok(result.best.defensePerimeter.rampartTiles >= 0);
assert.ok(result.categoryScores.layoutScore >= 0 && result.categoryScores.layoutScore <= 100);

const bp = simulateRcl8Blueprint({ encodedTerrain: terrain.join(''), objects, x: result.best.x, y: result.best.y });
assert.ok(bp.structureFit > 0);
const perimeter = estimateDefensePerimeter({ encodedTerrain: terrain.join(''), objects, x: result.best.x, y: result.best.y });
assert.ok(perimeter.radius >= 5 && perimeter.radius <= 10);

const corridorSummaries = new Map(summaries);
corridorSummaries.set('E0S1', summarizeRoom({ roomName: 'E0S1', myUserId: 'me', valid: true, objects: [
  { type: 'controller', x: 25, y: 25, level: 0 }, { type: 'source', x: 10, y: 10 }, { type: 'source', x: 40, y: 40 }
] }));
const corridor = evaluateExpansionCorridor('E0S0', corridorSummaries, 2);
assert.ok(corridor.claimableRooms >= 1);
assert.ok(corridor.twoSourceRooms >= 1);

const enemyProfiles = new Map([['enemy', { roomCount: 8, maxRcl: 8, activity: { observed: true } }]]);
const dangerous = evaluateNeighborhood('E0S0', summaries, 1, enemyProfiles);
assert.ok(dangerous.score < neighborhood.score);
assert.ok(dangerous.opponentStrengthPenalty > 0);

const remoteTerrain = terrain.join('');
const homeObjects = [
  { type: 'controller', x: 25, y: 40, level: 0 },
  { type: 'source', x: 12, y: 12 },
  { type: 'source', x: 38, y: 12 }
];
const remoteObjects = [
  { type: 'controller', x: 25, y: 25, level: 0 },
  { type: 'source', x: 12, y: 25 },
  { type: 'source', x: 38, y: 25 }
];
const route = adjacentRemoteRouteCost({ homeRoom: 'E0S0', remoteRoom: 'E1S0', homeTerrain: remoteTerrain, remoteTerrain, homeObjects, remoteObjects, spawn: { x: 25, y: 25 } });
assert.equal(route.sourceCount, 2);
assert.ok(route.reachableSources >= 1);
const categories = computeCategoryScores(result, dangerous, { remoteRoutes: { reachableSources: route.reachableSources }, corridor });
assert.ok(categories.safetyScore >= 0 && categories.safetyScore <= 100);

console.log('spawn planner tests passed');
