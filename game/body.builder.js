'use strict';

function repeatPattern(pattern, energy, maxParts) {
  const cost = pattern.reduce((sum, p) => sum + BODYPART_COST[p], 0);
  const body = [];
  maxParts = maxParts || 50;
  while (energy >= cost && body.length + pattern.length <= maxParts) {
    body.push.apply(body, pattern);
    energy -= cost;
  }
  return body;
}

function worker(energy, emergency) {
  if (emergency || energy < 300) return [WORK, CARRY, MOVE];
  let body = repeatPattern([WORK, CARRY, MOVE], energy, 18);
  return body.length ? body : [WORK, CARRY, MOVE];
}

function harvester(energy, hasContainer) {
  if (energy < 300) return [WORK, CARRY, MOVE];

  // Phase 2B: even before containers exist, a bootstrap harvester benefits
  // more from mining throughput than from a second CARRY. [2W,1C,1M] costs
  // exactly 300 and doubles source throughput versus the old [W,C,M] body.
  const body = [WORK, WORK, CARRY, MOVE];
  let remaining = energy - 300;
  let workParts = 2;

  while (remaining >= 150 && workParts < 5 && body.length + 2 <= 50) {
    body.push(WORK, MOVE);
    remaining -= 150;
    workParts++;
  }

  // Spare capacity becomes CARRY+MOVE. This helps mobile staging before
  // containers and gives stationary replacements some logistics resilience.
  while (remaining >= 100 && body.length + 2 <= 50) {
    body.push(CARRY, MOVE);
    remaining -= 100;
  }
  return body;
}

function hauler(energy) {
  const body = repeatPattern([CARRY, CARRY, MOVE], energy, 30);
  return body.length ? body : [CARRY, CARRY, MOVE];
}

function upgrader(energy) {
  if (energy >= 800) return repeatPattern([WORK, WORK, CARRY, MOVE], energy, 20);
  return worker(energy, false);
}

function defender(energy) {
  if (energy >= 390) {
    const body = repeatPattern([TOUGH, MOVE, ATTACK, MOVE], energy, 20);
    if (body.length) return body;
  }
  return [MOVE, ATTACK];
}

function scout() { return [MOVE]; }

module.exports = { worker, harvester, hauler, upgrader, defender, scout };
