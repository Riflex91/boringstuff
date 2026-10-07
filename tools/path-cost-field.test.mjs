import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

global.FIND_STRUCTURES = 1;
global.FIND_CREEPS = 2;
global.STRUCTURE_ROAD = 'road';
global.STRUCTURE_CONTAINER = 'container';
global.STRUCTURE_RAMPART = 'rampart';
global.STRUCTURE_EXTRACTOR = 'extractor';
global.OBSTACLE_OBJECT_TYPES = ['spawn', 'extension', 'tower', 'constructedWall'];

const costField = require('../game/path.cost.field.js');

class FakeCostMatrix {
  constructor() {
    this.values = Object.create(null);
  }

  key(x, y) {
    return x + ':' + y;
  }

  set(x, y, cost) {
    this.values[this.key(x, y)] = cost;
  }

  get(x, y) {
    return this.values[this.key(x, y)] || 0;
  }

  clone() {
    const next = new FakeCostMatrix();
    Object.assign(next.values, this.values);
    return next;
  }
}

function pos(x, y, roomName = 'E1N1') {
  return { x, y, roomName };
}

{
  const p = costField.normalizeProfile({
    plainCost: 3.2,
    swampCost: 9,
    roadCost: 0,
    creepCost: 999,
    hostileRange: -5,
    keeperRange: 20
  });

  assert.equal(p.plainCost, 3);
  assert.equal(p.swampCost, 9);
  assert.equal(p.roadCost, 1);
  assert.equal(p.creepCost, 254);
  assert.equal(p.hostileRange, 0);
  assert.equal(p.keeperRange, 10);
  assert.equal(p.obstacleCost, 255);

  const described = costField.describe({ plainCost: 4 });
  assert.equal(described.schemaVersion, 1);
  assert.equal(described.profile.plainCost, 4);
}

{
  const structures = [
    { structureType: 'road', pos: pos(10, 10) },
    { structureType: 'spawn', pos: pos(11, 10) },
    { structureType: 'container', pos: pos(12, 10) },
    { structureType: 'rampart', my: true, isPublic: false, pos: pos(13, 10) },
    { structureType: 'rampart', my: false, isPublic: false, pos: pos(14, 10) },
    { structureType: 'extractor', pos: pos(15, 10) },
    { structureType: 'road', pos: pos(16, 10, 'E1N2') }
  ];
  const creeps = [
    { pos: pos(23, 20) },
    { pos: pos(24, 20, 'E1N2') }
  ];
  const room = {
    name: 'E1N1',
    find(type) {
      if (type === FIND_STRUCTURES) return structures;
      if (type === FIND_CREEPS) return creeps;
      return [];
    }
  };

  const matrix = costField.buildRoomCostMatrix(room, {
    CostMatrix: FakeCostMatrix,
    profile: {
      roadCost: 1,
      stationaryCost: 20,
      congestionCost: 8,
      creepCost: 10,
      hostileCost: 60,
      hostileRange: 1,
      keeperCost: 40,
      keeperRange: 2
    },
    includeCreeps: true,
    plannedRoads: [{ pos: pos(20, 20) }],
    plannedStructures: [{ pos: pos(21, 20) }],
    stationaryTiles: [{ pos: pos(10, 10) }],
    congestion: [
      { pos: pos(22, 20), cost: 7 },
      { pos: pos(22, 21) }
    ],
    hostiles: [{ pos: pos(25, 25) }],
    keepers: [{ pos: pos(30, 30) }]
  });

  // Built structures.
  assert.equal(matrix.get(10, 10), 20); // road + stationary work tile penalty
  assert.equal(matrix.get(11, 10), 255);
  assert.equal(matrix.get(12, 10), 0);
  assert.equal(matrix.get(13, 10), 0);
  assert.equal(matrix.get(14, 10), 255);
  assert.equal(matrix.get(15, 10), 0);
  assert.equal(matrix.get(16, 10), 0); // other room ignored

  // Planner / operational overlays.
  assert.equal(matrix.get(20, 20), 1);
  assert.equal(matrix.get(21, 20), 255);
  assert.equal(matrix.get(22, 20), 7);
  assert.equal(matrix.get(22, 21), 8);
  assert.equal(matrix.get(23, 20), 10);
  assert.equal(matrix.get(24, 20), 0);

  // Chebyshev threat ranges.
  assert.equal(matrix.get(24, 24), 60);
  assert.equal(matrix.get(25, 25), 60);
  assert.equal(matrix.get(26, 26), 60);
  assert.equal(matrix.get(27, 27), 0);

  assert.equal(matrix.get(28, 28), 40);
  assert.equal(matrix.get(30, 30), 40);
  assert.equal(matrix.get(32, 32), 40);
  assert.equal(matrix.get(33, 33), 0);

  // Hard blockers always win over later soft overlays.
  const blocked = costField.buildRoomCostMatrix(room, {
    CostMatrix: FakeCostMatrix,
    plannedRoads: [{ pos: pos(11, 10) }],
    congestion: [{ pos: pos(11, 10), cost: 3 }],
    hostiles: [{ pos: pos(11, 10) }],
    profile: { hostileRange: 0 }
  });
  assert.equal(blocked.get(11, 10), 255);
}

{
  const options = costField.pathfinderOptions(
    { plainCost: 3, swampCost: 12 },
    roomName => roomName === 'E1N1' ? 'matrix' : false
  );
  assert.equal(options.plainCost, 3);
  assert.equal(options.swampCost, 12);
  assert.equal(options.roomCallback('E1N1'), 'matrix');
  assert.equal(options.roomCallback('W9N9'), false);
}

{
  // The service can also operate from explicit arrays, which keeps planner
  // fixtures independent from Room.find and supports future cached snapshots.
  const room = { name: 'E2N2' };
  const matrix = costField.buildRoomCostMatrix(room, {
    CostMatrix: FakeCostMatrix,
    structures: [{ structureType: 'road', pos: pos(4, 4, 'E2N2') }],
    creeps: [{ pos: pos(5, 4, 'E2N2') }],
    includeCreeps: true
  });
  assert.equal(matrix.get(4, 4), 1);
  assert.equal(matrix.get(5, 4), 10);
}

console.log('path cost field tests passed');
