import assert from 'node:assert/strict';
import { evaluateI1Shadow } from './i1-live-verification-core.mjs';

function heartbeat(tick, {
  scoutCount = 0,
  targets = [],
  authority = 'SHADOW',
  byDomain = {},
  assignmentRequestCount = 1,
  unfilledCount = 1,
  totalUnfilled = 2
} = {}) {
  return {
    tick,
    code: 'ROOM_HEARTBEAT',
    ctx: {
      room: 'E8N1',
      scoutingFrontier: {
        authority,
        homeRoom: 'E8N1',
        requestCount: scoutCount,
        maxDepth: 3,
        topRequests: targets.map((roomName, i) => ({
          roomName,
          fromRoom: 'E8N1',
          depth: i + 1,
          score: 90 - i,
          urgency: 25,
          unknown: true,
          stale: false,
          threatDue: false
        }))
      },
      requests: {
        byDomain: { economy: 1, ...byDomain, scouting: scoutCount }
      },
      assignments: {
        requestCount: assignmentRequestCount,
        unfilledCount,
        totalUnfilled
      }
    }
  };
}

{
  const events = [
    heartbeat(100, { scoutCount: 2, targets: ['E8N2', 'E9N1'] }),
    heartbeat(125, { scoutCount: 2, targets: ['E8N2', 'E9N1'] }),
    heartbeat(150, { scoutCount: 1, targets: ['E9N1'] }),
    heartbeat(175, { scoutCount: 1, targets: ['E9N1'] }),
    { tick: 199, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateI1Shadow({ events, roomName: 'E8N1', startTick: 100, tickCount: 100 });

  assert.equal(result.complete, true);
  assert.equal(result.outcome, 'PASS');
  assert.equal(result.latestFrontier.requestCount, 1);
  assert.equal(result.checks.find(x => x.id === 'shadow-authority').status, 'PASS');
  assert.equal(result.checks.find(x => x.id === 'frontier-bounds').status, 'PASS');
  assert.equal(result.checks.find(x => x.id === 'registry-sync').status, 'PASS');
  assert.equal(result.checks.find(x => x.id === 'request-reconciliation').status, 'PASS');
  assert.equal(result.checks.find(x => x.id === 'e1-isolation').status, 'PASS');
}

{
  const events = [
    heartbeat(200, { scoutCount: 1, targets: ['E8N2'], authority: 'ACTIVE' }),
    heartbeat(225, { scoutCount: 1, targets: ['E8N2'], authority: 'ACTIVE' }),
    heartbeat(250, { scoutCount: 1, targets: ['E8N2'], authority: 'ACTIVE' }),
    { tick: 299, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateI1Shadow({ events, roomName: 'E8N1', startTick: 200, tickCount: 100 });
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.checks.find(x => x.id === 'shadow-authority').status, 'FAIL');
}

{
  const bad = heartbeat(300, { scoutCount: 7, targets: ['E8N2'] });
  bad.ctx.scoutingFrontier.maxDepth = 1;
  bad.ctx.scoutingFrontier.topRequests[0].depth = 2;
  bad.ctx.requests.byDomain.scouting = 7;
  const events = [
    bad,
    heartbeat(325),
    heartbeat(350),
    { tick: 399, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateI1Shadow({ events, roomName: 'E8N1', startTick: 300, tickCount: 100 });
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.checks.find(x => x.id === 'frontier-bounds').status, 'FAIL');
}

{
  const events = [
    heartbeat(400, { scoutCount: 1, targets: ['E8N2'] }),
    heartbeat(425, { scoutCount: 1, targets: ['E8N2'] }),
    heartbeat(450, { scoutCount: 1, targets: ['E8N2'] }),
    heartbeat(475, { scoutCount: 1, targets: ['E8N2'] }),
    { tick: 499, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateI1Shadow({ events, roomName: 'E8N1', startTick: 400, tickCount: 100 });
  assert.equal(result.outcome, 'WATCH');
  assert.equal(result.checks.find(x => x.id === 'request-reconciliation').status, 'WATCH');
  assert.equal(result.checks.find(x => x.id === 'e1-isolation').status, 'WATCH');
}

console.log('I1 live verification tests passed');
