import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import Module from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
process.env.NODE_PATH = path.resolve(here, '../game');
Module._initPaths();
const require = createRequire(import.meta.url);
global.RESOURCE_ENERGY = 'energy';
global.FIND_MY_CREEPS = 1;
global.FIND_MY_STRUCTURES = 2;
global.FIND_STRUCTURES = 3;
global.STRUCTURE_SPAWN = 'spawn';
global.STRUCTURE_EXTENSION = 'extension';
global.STRUCTURE_TOWER = 'tower';
global.OK = 0;
global.ERR_NOT_IN_RANGE = -9;
global.ERR_NO_PATH = -2;
global.ERR_INVALID_TARGET = -7;
global.ERR_FULL = -8;
global.ERR_BUSY = -4;
global.Game = { time: 2000, getObjectById: () => null };

const energy = require('../game/energy.js');
const supplyObserver = require('../game/consumer.supply.observer.js');
const role = require('../game/role.hauler.js');
const config = require('../game/config.js');

function store(capacity, amount) {
  return { energy: amount,
    getCapacity(resource) { assert.equal(resource, RESOURCE_ENERGY); return capacity; },
    getFreeCapacity() { return capacity - this.energy; }
  };
}
function room() {
  const r = {
    name: 'E8N1', energyAvailable: 1050, energyCapacityAvailable: 1050,
    creeps: [], structures: [],
    find(type, options) {
      const xs = type === FIND_MY_CREEPS ? this.creeps
        : type === FIND_MY_STRUCTURES ? this.structures : null;
      if (!xs) throw new Error('Unexpected find type ' + type);
      return options?.filter ? xs.filter(options.filter) : xs.slice();
    }
  };
  r.structures = [
    { structureType: STRUCTURE_SPAWN, store: store(300, 300) },
    { structureType: STRUCTURE_EXTENSION, store: store(50, 50) },
    { structureType: STRUCTURE_TOWER, store: store(1000, 600) }
  ];
  return r;
}
function makeHauler(id, r, energyAmount, range = 3) {
  return {
    id, name: id, room: r, spawning: false,
    memory: { role: 'hauler', delivering: false },
    store: store(300, energyAmount),
    pos: { getRangeTo() { return range; } },
    transfer() { return ERR_NOT_IN_RANGE; },
    moveTo() {}
  };
}
function consumer(id, r, waiting = 4, fallback = false) {
  return {
    id, room: r, spawning: false,
    memory: { role: 'worker', waitingEnergyTicks: waiting,
      logisticsFallback: fallback },
    store: store(100, 0),
    pos: { getRangeTo() { return 3; } }
  };
}
const r = room();
const ready = makeHauler('ready', r, 240);
ready.memory.delivering = true;
const partial = makeHauler('partial', r, 75);
const urgent = consumer('urgent', r, 4);
r.creeps = [ready, partial, urgent];
const objects = new Map([[urgent.id, urgent]]);
Game.getObjectById = id => objects.get(id) || null;

assert.equal(energy._test.haulerReadyToDeliver(partial), false);
assert.equal(energy._test.haulerReadyToDeliver(ready), true);
assert.equal(energy._test.rescueInfrastructureSafe(r), true);
// The exact selected low-load rescuer must retain its sticky critical request
// while full spawn/extensions and the tower reserve authorize its mission.
partial.memory.consumerTargetId = urgent.id;
assert.equal(energy._test.selectConsumerTarget(ready,true), null,
  'never steal a live selected partial rescuer\'s critical reservation');
assert.equal(partial.memory.consumerTargetId, urgent.id);

assert.deepEqual(energy._test.selectConsumerGuardHaulers(r).map(c => c.id), ['partial']);
assert.equal(energy.shouldRescueConsumer(partial), true);
assert.equal(energy.shouldRescueConsumer(ready), false);
assert.equal(energy.shouldPrioritizeConsumer(ready), false,
  'infrastructure-ready hauler must remain outside consumer guards');
const rescueRecord = supplyObserver._test.getRoomCounters(r.name);
assert.equal(rescueRecord.rescueChecks, 1);
assert.equal(rescueRecord.rescueSelected, 1);
assert.deepEqual(Object.keys(rescueRecord.selectedRescueHaulers), ['partial'],
  'the selected partial hauler is counted without making it a regular ready guard');
assert.equal(energy._test.haulerReadyToDeliver(partial), false,
  'recording selected rescue must not change the normal readiness threshold');

const regularDeliver = energy.deliver;
const regularConsumer = energy.deliverToConsumer;
const readyCalls = [];
try {
  energy.deliver = () => { readyCalls.push('infrastructure'); return true; };
  energy.deliverToConsumer = () => { readyCalls.push('consumer'); return true; };
  role.run(ready);
  assert.deepEqual(readyCalls, ['infrastructure'],
    'protected ready hauler must actually run infrastructure-first');
} finally {
  energy.deliver = regularDeliver;
  energy.deliverToConsumer = regularConsumer;
}


let target = null, moves = [];
partial.transfer = c => { target = c; return ERR_NOT_IN_RANGE; };
partial.moveTo = (c, options) => { moves.push({ c, options }); };
const originalAcquire = energy.acquireForHauler;
let acquisitions = 0;
energy.acquireForHauler = () => { acquisitions++; return true; };
try {
  role.run(partial);
  assert.equal(target, urgent, 'partially loaded hauler must issue consumer intent');
  assert.equal(partial.memory.consumerTargetId, urgent.id,
    'target reservation should be sticky across out-of-range rescue ticks');
  assert.equal(partial.memory.delivering, false,
    'rescue must not force normal delivery mode');
  assert.equal(moves.length, 1);
  assert.equal(moves[0].c, urgent);
  assert.equal(moves[0].options.maxOps, config.PATH_MAX_OPS);
  assert.equal(acquisitions, 0);

  Game.time++;
  role.run(partial);
  assert.equal(acquisitions, 0, 'unchanged safe conditions preserve active rescue');

  // A spawn refill event must immediately abort new rescue work.
  r.energyAvailable = 750;
  Game.time++;
  assert.equal(energy._test.selectConsumerTarget(ready,true).id,urgent.id,
    'a pending partial rescue may not monopolize a consumer once infrastructure is underfilled');
  assert.equal(partial.memory.consumerTargetId,undefined,
    'recover stale sticky before an alternative ready hauler runs');
  assert.equal(energy.shouldRescueConsumer(partial), false);
  role.run(partial);
  assert.equal(partial.memory.consumerTargetId, undefined,
    'fallback to normal acquisition must release consumer reservation');
  assert.equal(acquisitions, 1);
  // Underfilled spawn/extensions means partial rescue is forbidden. The
  // only loaded ready carrier must serve hard infrastructure, not become a
  // normal starvation guard by treating the collecting hauler as a reserve.
  assert.deepEqual(energy._test.selectConsumerGuardHaulers(r), []);
  assert.equal(energy.shouldPrioritizeConsumer(ready), false);
  const protectedCalls = [];
  const infraDeliver = energy.deliver;
  const consumerDeliver = energy.deliverToConsumer;
  try {
    energy.deliver = () => { protectedCalls.push('infrastructure'); return true; };
    energy.deliverToConsumer = () => { protectedCalls.push('consumer'); return true; };
    role.run(ready);
    assert.deepEqual(protectedCalls, ['infrastructure'],
      'the only loaded ready hauler must actually try infrastructure first');
  } finally {
    energy.deliver = infraDeliver;
    energy.deliverToConsumer = consumerDeliver;
  }
  r.energyAvailable = 1050;

  r.structures[2].store.energy = 499;
  assert.equal(energy.shouldRescueConsumer(partial), false,
    'tower below 50% forbids new diversion');
  assert.equal(energy.shouldPrioritizeConsumer(ready), false,
    'tower reserve deficit also protects the sole ready infrastructure hauler');
  r.structures[2].store.energy = 600;
  r.structures[2].store.getCapacity = () => undefined;
  assert.equal(energy.shouldRescueConsumer(partial), false,
    'unknown tower capacity must fail closed');
  r.structures[2].store = store(1000, 600);
  r.structures[0].store.energy = 200;
  assert.equal(energy.shouldRescueConsumer(partial), false,
    'spawn underfilled forbids new diversion');
  r.structures[0].store.energy = 300;

  // A single live hauler always retains infrastructure priority.
  r.creeps = [partial, urgent];
  assert.equal(energy.shouldRescueConsumer(partial), false);
  role.run(partial);
  assert.equal(acquisitions, 2);

  // A ready infrastructure hauler must really exist, not merely a live one.
  const anotherPartial = makeHauler('other-partial', r, 20);
  r.creeps = [partial, anotherPartial, urgent];
  assert.equal(energy.shouldRescueConsumer(partial), false);

  // Fresh empty consumers do not meet the emergency rescue threshold.
  r.creeps = [ready, partial, urgent];
  urgent.memory.waitingEnergyTicks = 0;
  assert.equal(energy.shouldRescueConsumer(partial), false);
  urgent.memory.waitingEnergyTicks = 2;
  assert.equal(energy.shouldRescueConsumer(partial), false);
  urgent.memory.waitingEnergyTicks = 3;
  assert.equal(energy.shouldRescueConsumer(partial), true);
  urgent.memory.waitingEnergyTicks = 0;
  urgent.memory.logisticsFallback = true;
  assert.equal(energy.shouldRescueConsumer(partial), true,
    'existing fallback remains urgent even when waiting ticks reset');
  urgent.memory.logisticsFallback = false;
  urgent.memory.waitingEnergyTicks = 4;

  // Too-small load must collect, not divert a 1-energy carrier.
  partial.store.energy = 20;
  assert.equal(energy.shouldRescueConsumer(partial), false);
  partial.store.energy = 75;

  // If an existing ready hauler reserved the only urgent consumer, do not
  // create a duplicate rescue assignment.
  ready.memory.consumerTargetId = urgent.id;
  assert.equal(energy.shouldRescueConsumer(partial), false);
  ready.memory.consumerTargetId = undefined;

  // A zero-energy sticky hauler must not monopolize an urgent consumer or
  // block the one safe partial-load rescuer. Guard selection stays read-only;
  // stale claim cleanup happens during actual consumer target selection.
  const depleted = makeHauler('depleted-sticky', r, 0);
  depleted.memory.consumerTargetId = urgent.id;
  r.creeps = [ready, partial, depleted, urgent];
  assert.deepEqual(energy._test.selectConsumerGuardHaulers(r).map(c => c.id),
    [partial.id], 'ready infrastructure reserve must remain untouched');
  assert.equal(depleted.memory.consumerTargetId, urgent.id,
    'guard selection must not mutate another creep Memory');
  assert.equal(energy._test.selectConsumerTarget(partial, true).id, urgent.id);
  assert.equal(depleted.memory.consumerTargetId, undefined,
    'actual assignment selection reclaims the depleted sticky claim');
  r.creeps = [ready, partial, urgent];

  // Same-tick simultaneous candidates choose exactly one stable rescuer.
  const closer = makeHauler('closer', r, 75, 1);
  partial.pos.getRangeTo = () => 7;
  r.creeps = [ready, partial, closer, urgent];
  assert.deepEqual(energy._test.selectConsumerGuardHaulers(r).map(c => c.id),
    ['closer']);
  assert.equal(energy.shouldRescueConsumer(partial), false);
  assert.equal(energy.shouldRescueConsumer(closer), true);
  closer.memory.consumerTargetId = urgent.id;
  assert.equal(energy.shouldRescueConsumer(closer), true,
    'an existing valid rescue reservation outranks geometrical selection');
  closer.memory.consumerTargetId = undefined;

  r.creeps = [ready, partial, urgent];
  r.energyAvailable = undefined;
  assert.equal(energy.shouldRescueConsumer(partial), false,
    'unobservable infrastructure capacity must fail closed');

  // Without a safe rescuer, a lone ready hauler remains protected even
  // when a consumer is critically waiting and infrastructure is underfilled.
  r.energyAvailable = 750;
  ready.memory.consumerTargetId = undefined;
  assert.deepEqual(energy._test.selectConsumerGuardHaulers(r), []);

  // Once a SECOND hauler is genuinely delivery-ready, a normal guard may
  // operate while one loaded ready carrier still handles spawn/extensions.
  partial.store.energy = 160;
  assert.deepEqual(energy._test.selectConsumerGuardHaulers(r).map(c => c.id),
    ['ready']);
  assert.equal(energy._test.haulerReadyToDeliver(partial), true);
} finally {
  energy.acquireForHauler = originalAcquire;
}
// Infrastructure-first haulers must not lock indefinitely onto a single
// path-impossible spawn. Retry at most one extension/tower target, without
// diverting the infrastructure reserve to consumer logistics.
{
  const infraRoom = room();
  infraRoom.structures[0].store.energy = 200;
  infraRoom.structures[1].store.energy = 20;
  const carrier = makeHauler('infrastructure-terminal-route', infraRoom, 250);
  carrier.memory.delivering = true;
  infraRoom.creeps = [carrier];
  const spawn = infraRoom.structures[0];
  const extension = infraRoom.structures[1];
  let transferCalls = [], moveCalls = [];
  carrier.transfer = target => {
    transferCalls.push(target);
    return ERR_NOT_IN_RANGE;
  };
  carrier.moveTo = (target, opts) => {
    moveCalls.push({target, opts});
    return target === spawn ? ERR_NO_PATH : OK;
  };
  assert.equal(energy.deliver(carrier), true);
  assert.deepEqual(transferCalls, [spawn, extension],
    'one terminal spawn path must allow the alternate extension');
  assert.equal(moveCalls.length, 2);
  assert.ok(moveCalls.every(x => x.opts.maxOps === config.PATH_MAX_OPS),
    'both attempts remain bounded by the existing PathFinder budget');

  // A race that made a filtered spawn target full/invalid may redirect the
  // transfer intent, but cannot schedule more than one accepted transfer.
  transferCalls = [];
  moveCalls = [];
  carrier.transfer = target => {
    transferCalls.push(target);
    return target === spawn ? ERR_FULL : OK;
  };
  assert.equal(energy.deliver(carrier), true);
  assert.deepEqual(transferCalls, [spawn, extension]);
  assert.equal(moveCalls.length, 0);

  // Busy movement is transient: do not create a conflicting second movement.
  transferCalls = [];
  moveCalls = [];
  carrier.transfer = target => { transferCalls.push(target); return ERR_NOT_IN_RANGE; };
  carrier.moveTo = (target, opts) => {
    moveCalls.push({target, opts}); return ERR_BUSY;
  };
  assert.equal(energy.deliver(carrier), true);
  assert.deepEqual(transferCalls, [spawn]);
  assert.equal(moveCalls.length, 1);

  // Both candidates permanently unreachable: cap at exactly TWO targets,
  // leave infrastructure as the priority, never issue a consumer diversion.
  transferCalls = [];
  moveCalls = [];
  carrier.moveTo = (target, opts) => {
    moveCalls.push({target, opts}); return ERR_INVALID_TARGET;
  };
  assert.equal(energy.deliver(carrier), true);
  assert.deepEqual(transferCalls, [spawn, extension]);
  assert.equal(moveCalls.length, 2);
}

// A stale sticky claim held by a collecting, below-minimum-energy hauler
// must not block a different authorized partial rescue. A delivery-ready
// competing sticky claim, however, must still block rescue.
{
  const safe = room();
  const urgentRequest = consumer('stale-partial-rescue-request', safe, 8, true);
  const infrastructure = makeHauler('stale-partial-infra-ready', safe, 220);
  infrastructure.memory.delivering = true;
  const stale = makeHauler('stale-partial-ineligible', safe, 10);
  stale.memory.consumerTargetId = urgentRequest.id;
  const candidate = makeHauler('stale-partial-eligible', safe, 75);
  safe.creeps = [urgentRequest, infrastructure, stale, candidate];
  assert.deepEqual(energy._test.selectConsumerGuardHaulers(safe).map(h => h.id),
    [candidate.id],
    'positive energy below rescue minimum cannot monopolize urgent demand');
  assert.equal(energy.shouldRescueConsumer(candidate), true);
  assert.equal(energy.shouldRescueConsumer(stale), false);
  assert.equal(energy.shouldPrioritizeConsumer(infrastructure), false,
    'sole ready hauler remains protected for infrastructure');
  assert.equal(energy._test.selectConsumerTarget(candidate, true).id, urgentRequest.id);
  assert.equal(stale.memory.consumerTargetId, undefined,
    'obsolete competing sticky claim is reclaimed at target selection');

  // The same reservation becomes authoritative when the competing hauler
  // can actually deliver; no partial rescue may steal it.
  infrastructure.memory.consumerTargetId = urgentRequest.id;
  assert.deepEqual(energy._test.selectConsumerGuardHaulers(safe), []);
  assert.equal(energy.shouldRescueConsumer(candidate), false);
}


// E4: the spare partially loaded THIRD carrier may serve a distinct urgent
// consumer alongside ONE sticky ready guard only while hard infrastructure
// remains safely covered by ANOTHER ready carrier.
{
  const safe=room();
  const first=consumer('first-sticky-critical',safe,8,true);
  const second=consumer('second-uncovered-critical',safe,7,true);
  const sticky=makeHauler('sticky-critical-guard',safe,220,2);
  sticky.memory.delivering=true;
  sticky.memory.consumerTargetId=first.id;
  const infrastructure=makeHauler('preserved-infrastructure',safe,250,4);
  infrastructure.memory.delivering=true;
  const extra=makeHauler('partial-spare-rescuer',safe,75,1);
  safe.creeps=[sticky,infrastructure,extra,first,second];
  const oldGet=Game.getObjectById;
  Game.getObjectById=id=>id===first.id?first:id===second.id?second:null;
  const selected=()=>energy._test.selectConsumerGuardHaulers(safe).map(h=>h.id);
  try {
    assert.deepEqual(selected(),[sticky.id,extra.id],
      'second distinct critical request may use the available partial carrier');
    assert.equal(energy.shouldPrioritizeConsumer(sticky),true);
    assert.equal(energy.shouldPrioritizeConsumer(infrastructure),false,
      'one completely loaded ready carrier remains infrastructure-first');
    assert.equal(energy.shouldRescueConsumer(extra),true);
    assert.equal(energy.shouldRescueConsumer(infrastructure),false);
    assert.equal(energy._test.haulerReadyToDeliver(extra),false);
    assert.equal(energy._test.selectConsumerTarget(extra,true).id,second.id,
      'extra rescuer never duplicates sticky ready guard assignment');
    let deliveredTo=null,transferCount=0;
    const savedAcquire=energy.acquireForHauler;
    extra.transfer=target=>{deliveredTo=target;transferCount++;return ERR_NOT_IN_RANGE;};
    extra.moveTo=()=>OK;
    energy.acquireForHauler=()=>{throw Error('authorized extra rescuer must not collect');};
    try {
      role.run(extra);
      assert.equal(deliveredTo,second);
      assert.equal(transferCount,1);
      assert.equal(extra.memory.consumerTargetId,second.id);
      assert.equal(extra.memory.delivering,false,
        'bounded extra rescue must not force regular delivery');
    } finally {
      energy.acquireForHauler=savedAcquire;
    }
    // Empty or under-minimum loads cannot claim extra consumer coverage.
    extra.memory.consumerTargetId=undefined;
    extra.store.energy=24;
    assert.deepEqual(selected(),[sticky.id]);
    extra.store.energy=0;
    assert.deepEqual(selected(),[sticky.id]);
    extra.store.energy=75;

    // No second urgent request: the existing ready guard is enough.
    second.memory.waitingEnergyTicks=1;
    second.memory.logisticsFallback=false;
    assert.deepEqual(selected(),[sticky.id]);
    second.memory.waitingEnergyTicks=7;
    second.memory.logisticsFallback=true;

    // Full infrastructure is mandatory for partial-load diversion.
    safe.energyAvailable=1000;
    assert.deepEqual(selected(),[sticky.id]);
    assert.equal(energy.shouldRescueConsumer(extra),false);
    safe.energyAvailable=1050;
    safe.structures[2].store.energy=499;
    assert.deepEqual(selected(),[sticky.id],
      'defensive towers below half capacity block new rescue');
    safe.structures[2].store.energy=600;

    // The extra assignment must not race another ready sticky carrier.
    infrastructure.memory.consumerTargetId=second.id;
    assert.deepEqual(selected(),[sticky.id]);
    infrastructure.memory.consumerTargetId=undefined;

    // No verified sticky ready assignment means we cannot establish that
    // a new partial rescuer will target a different critical consumer.
    sticky.memory.consumerTargetId=undefined;
    assert.equal(selected().includes(extra.id),false);
    sticky.memory.consumerTargetId=first.id;

    // Only one ready hauler: retain the existing 2-hauler rescue mode;
    // NEVER divert the one ready carrier from infrastructure.
    safe.creeps=[sticky,extra,first,second];
    assert.deepEqual(selected(),[extra.id]);
    assert.equal(energy.shouldPrioritizeConsumer(sticky),false);
    assert.equal(energy.shouldRescueConsumer(extra),true);
    safe.creeps=[sticky,infrastructure,extra,first,second];

    // A genuinely ready third carrier returns to the old ready-guard
    // selection, always reserving at least one ready infrastructure unit.
    extra.store.energy=160;
    const guards=selected();
    assert.equal(guards.length,2);
    assert.equal(guards.includes(sticky.id),true);
    assert.equal(guards.includes(extra.id)||guards.includes(infrastructure.id),true);
    assert.equal(energy.shouldRescueConsumer(extra),false);
  } finally {
    Game.getObjectById=oldGet;
  }
}
console.log('active consumer rescue behavior and infrastructure interlocks PASS');
