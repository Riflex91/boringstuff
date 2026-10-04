'use strict';

const logger = require('logger');

function run(state) {
  if (!state.towers.length) return;
  const hostile = state.hostileCreeps[0];
  if (hostile) {
    state.towers.forEach(t => t.attack(hostile));
    logger.warn('TOWER_ENGAGE', 'Tower engaging hostile', { room: state.room.name, hostile: hostile.owner && hostile.owner.username, hostileId: hostile.id, count: state.hostileCreeps.length }, { dedupeTicks: 3 });
    return;
  }

  const hurt = state.room.find(FIND_MY_CREEPS, { filter: c => c.hits < c.hitsMax })[0];
  if (hurt) {
    state.towers.forEach(t => t.heal(hurt));
    return;
  }

  const repair = state.structures
    .filter(s => s.hits !== undefined && s.hits < s.hitsMax * 0.35 && s.structureType !== STRUCTURE_WALL && s.structureType !== STRUCTURE_RAMPART)
    .sort((a, b) => (a.hits / a.hitsMax) - (b.hits / b.hitsMax))[0];
  if (repair) state.towers.filter(t => (t.store[RESOURCE_ENERGY] || 0) > 500).forEach(t => t.repair(repair));
}

module.exports = { run };
