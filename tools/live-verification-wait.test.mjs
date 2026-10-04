import assert from 'node:assert/strict';
import { formatWaitStatus, resolveAutoStart, waitForAutoStart } from './live-verification-wait.mjs';

const version = '0.2.18-node18';
const room = 'E8N1';

function versionChange(tick = 1000) {
  return { tick, v: version, code: 'VERSION_CHANGE', ctx: { from: '0.2.17-node18', to: version } };
}

function snapshot(eventTick, startTick, endTick) {
  return {
    tick: eventTick,
    v: version,
    code: 'STATUS_SNAPSHOT',
    ctx: {
      rooms: {
        [room]: {
          economy: { last100: { startTick, endTick, ticks: 100 } }
        }
      }
    }
  };
}

{
  const status = resolveAutoStart([versionChange(1000), snapshot(1000, 901, 1000)], version, 'live', room);
  assert.equal(status.ready, false);
  assert.equal(status.expectedStartTick, 1001);
  assert.equal(status.expectedEndTick, 1100);
  assert.match(formatWaitStatus(status), /1001-1100/);
}

{
  const first = [versionChange(1000), snapshot(1000, 901, 1000)];
  const second = [...first, snapshot(1100, 1001, 1100)];
  let reads = 0;
  let sleeps = 0;
  const messages = [];

  const result = await waitForAutoStart({
    mode: 'live',
    version,
    roomName: room,
    loadEvents() { return reads++ === 0 ? first : second; },
    sleep: async () => { sleeps++; },
    pollMs: 1,
    onWait(message) { messages.push(message); }
  });

  assert.equal(result.startTick, 1001);
  assert.equal(result.status.endTick, 1100);
  assert.equal(sleeps, 1);
  assert.equal(messages.length, 1);
}

{
  const status = resolveAutoStart([versionChange(1000)], version, 'smoke', room);
  assert.equal(status.ready, true);
  assert.equal(status.startTick, 1001);
}

console.log('live verification wait tests passed');
