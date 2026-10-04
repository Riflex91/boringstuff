'use strict';

const config = require('config');
const spawnManager = require('spawn.manager');

function draw(state) {
  if (!config.VISUALS) return;
  const room = state.room;
  const want = spawnManager.desired(state);
  let y = 1.2;
  room.visual.text('🤖 ' + config.BOT_NAME + ' v' + config.VERSION, 1, y, { align: 'left', font: 0.7 }); y += 0.8;
  room.visual.text('RCL ' + state.rcl + ' | Energy ' + state.energyAvailable + '/' + state.energyCapacityAvailable + ' | CPU ' + Game.cpu.getUsed().toFixed(2), 1, y, { align: 'left', font: 0.6 }); y += 0.7;
  room.visual.text('Creeps ' + JSON.stringify(state.byRole), 1, y, { align: 'left', font: 0.5 }); y += 0.6;
  room.visual.text('Target ' + JSON.stringify(want), 1, y, { align: 'left', font: 0.5 });
  if (state.hostileCreeps.length) room.visual.text('⚠ HOSTILES ' + state.hostileCreeps.length, 25, 2, { font: 1.0 });
}

module.exports = { draw };
