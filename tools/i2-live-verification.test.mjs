import assert from 'node:assert/strict';
import {
  evaluateI2Shadow,
  I2_CPU_WATCH,
  I2_CPU_FAIL
} from './i2-live-verification-core.mjs';

function status(tick, options = {}) {
  const evaluatedTick = options.evaluatedTick ?? 1001;
  const candidateCount = options.candidateCount ?? 2;
  const state = options.recommendedState ?? 'CANDIDATE';
  const candidate = {
    roomName: 'E8N2',
    depth: 1,
    status: 'READY',
    reason: null,
    score: 70,
    netEnergyPerTick: 12.5,
    economicallyViable: true,
    capacityBudgetEligible: true,
    recommendedState: state,
    routeHops: 1,
    sourceCount: 2,
    grossIncomePerTick: 20,
    totalCostPerTick: 7.5,
    confidence: 1
  };
  const topCandidates = candidateCount > 0 ? [candidate] : [];
  return {
    tick,
    code: 'STATUS_SNAPSHOT',
    ctx: {
      scheduler: {
        processes: {
          'remote-roi-shadow': {
            lastRunTick: evaluatedTick,
            lastCpu: options.lastCpu ?? 1.5,
            cpuEMA: options.lastCpu ?? 1.5,
            runCount: 1,
            skippedCount: 0,
            lastDecision: 'READY',
            lastSkipReason: null
          }
        }
      },
      rooms: {
        E8N1: {
          remoteRoi: {
            schemaVersion: 1,
            authority: options.authority ?? 'SHADOW',
            activationAuthority: options.activationAuthority ?? 'NONE',
            remoteMiningEnabled: options.remoteMiningEnabled ?? false,
            homeRoom: 'E8N1',
            evaluatedTick,
            status: options.status ?? 'READY',
            reason: null,
            candidateCount,
            readyCount: candidateCount,
            viableCount: candidateCount,
            recommendedCandidateCount: state === 'CANDIDATE' ? candidateCount : 0,
            bestCandidate: candidateCount > 0 ? candidate : null,
            topCandidates,
            assumptions: {
              maxDepth: 2,
              maxRouteHops: 3,
              intelMaxAge: 1500,
              ticksPerRoom: 50,
              localEndpointTicks: 25
            }
          }
        }
      }
    }
  };
}

{
  const events = [
    status(1050),
    { tick: 1099, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateI2Shadow({ events, roomName: 'E8N1', startTick: 1000, tickCount: 100 });
  assert.equal(result.complete, true);
  assert.equal(result.outcome, 'PASS');
  for (const id of [
    'roi-evidence',
    'shadow-authority',
    'roi-ready',
    'roi-contract',
    'no-activation',
    'candidate-observation',
    'scheduler-isolation',
    'roi-cpu',
    'roi-freshness'
  ]) {
    assert.equal(result.checks.find(item => item.id === id).status, 'PASS', id);
  }
}

{
  const events = [
    status(2050, { authority: 'ACTIVE' }),
    { tick: 2099, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateI2Shadow({ events, startTick: 2000, tickCount: 100 });
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.checks.find(item => item.id === 'shadow-authority').status, 'FAIL');
}

{
  const events = [
    status(3050, { remoteMiningEnabled: true }),
    { tick: 3099, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateI2Shadow({ events, startTick: 3000, tickCount: 100 });
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.checks.find(item => item.id === 'shadow-authority').status, 'FAIL');
}

{
  const events = [
    status(4050, { recommendedState: 'ACTIVE' }),
    { tick: 4099, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateI2Shadow({ events, startTick: 4000, tickCount: 100 });
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.checks.find(item => item.id === 'roi-contract').status, 'FAIL');
  assert.equal(result.checks.find(item => item.id === 'no-activation').status, 'FAIL');
}

{
  const bad = status(5050);
  bad.ctx.rooms.E8N1.remoteRoi.viableCount = 3;
  const events = [
    bad,
    { tick: 5099, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateI2Shadow({ events, startTick: 5000, tickCount: 100 });
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.checks.find(item => item.id === 'roi-contract').status, 'FAIL');
}

{
  const events = [
    status(6050, { evaluatedTick: 6001, lastCpu: I2_CPU_WATCH + 0.5 }),
    { tick: 6099, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateI2Shadow({ events, startTick: 6000, tickCount: 100 });
  assert.equal(result.outcome, 'WATCH');
  assert.equal(result.checks.find(item => item.id === 'roi-cpu').status, 'WATCH');
}

{
  const events = [
    status(7050, { evaluatedTick: 7001, lastCpu: I2_CPU_FAIL + 0.5 }),
    { tick: 7099, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateI2Shadow({ events, startTick: 7000, tickCount: 100 });
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.checks.find(item => item.id === 'roi-cpu').status, 'FAIL');
}

{
  const events = [
    status(8050, { candidateCount: 0 }),
    { tick: 8099, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateI2Shadow({ events, startTick: 8000, tickCount: 100 });
  assert.equal(result.outcome, 'WATCH');
  assert.equal(result.checks.find(item => item.id === 'candidate-observation').status, 'WATCH');
}

{
  const events = [
    status(9050, { evaluatedTick: 8000 }),
    { tick: 9099, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateI2Shadow({ events, startTick: 9000, tickCount: 100 });
  assert.equal(result.outcome, 'WATCH');
  assert.equal(result.checks.find(item => item.id === 'roi-freshness').status, 'WATCH');
}

// I2 cached before deployment may appear in a new-version STATUS_SNAPSHOT.
for (const cpu of [1.13, 11]) {
  const result = evaluateI2Shadow({
    events: [status(10450, { evaluatedTick: 10199, lastCpu: cpu }),
      { tick: 10499, code: 'BOT_HEARTBEAT', ctx: {} }],
    startTick: 10400
  });
  assert.equal(result.outcome, 'WATCH');
  assert.equal(result.checks.find(c => c.id === 'scheduler-isolation').status, 'WATCH');
  assert.equal(result.checks.find(c => c.id === 'roi-cpu').status, 'WATCH');
}
{
  const row = status(10550, { evaluatedTick: 10510 });
  row.ctx.scheduler.processes['remote-roi-shadow'].lastRunTick = 10399;
  const result = evaluateI2Shadow({
    events: [row, { tick: 10599, code: 'BOT_HEARTBEAT', ctx: {} }], startTick: 10500
  });
  assert.equal(result.checks.find(c => c.id === 'scheduler-isolation').status, 'WATCH');
}
console.log('I2 live verification tests passed');
