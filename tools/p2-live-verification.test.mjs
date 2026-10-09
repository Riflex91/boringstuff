import assert from 'node:assert/strict';
import { evaluateP2Shadow } from './p2-live-verification-core.mjs';

function status(tick, options = {}) {
  const candidateAnchorCount = options.candidateAnchorCount ?? 4;
  const pathSearchBudget = options.pathSearchBudget ?? 24;
  const pathSearches = options.pathSearches ?? 16;
  const exactRouteCount = options.exactRouteCount ?? 4;
  const fallbackRouteCount = options.fallbackRouteCount ?? 0;
  const plannerStatus = options.status ?? 'READY';
  const selectedValid = options.selectedValid ?? true;
  return {
    tick,
    code: 'STATUS_SNAPSHOT',
    ctx: {
      scheduler: {
        processes: {
          'planner-vnext-shadow': {
            lastRunTick: options.planTick ?? tick,
            lastCpu: 1.25,
            cpuEMA: 1.1,
            runCount: options.runCount ?? 3,
            skippedCount: 0,
            lastDecision: 'READY',
            lastSkipReason: null
          }
        }
      },
      rooms: {
        E8N1: {
          plannerVNext: {
            schemaVersion: 1,
            authority: options.authority ?? 'SHADOW',
            status: plannerStatus,
            roomName: 'E8N1',
            planTick: options.planTick ?? tick,
            phase: 'ANCHOR_AND_CORE_GEOMETRY',
            candidateAnchorCount,
            evaluatedCandidateCount: candidateAnchorCount * 2,
            pathSearchBudget,
            pathSearches,
            selected: {
              anchor: { x: 25, y: 25, roomName: 'E8N1', source: 'ECONOMIC_CENTROID' },
              variant: 'CORE_COMPACT',
              score: 88.4,
              valid: selectedValid,
              components: {
                openness: 90,
                sourceLogistics: 85,
                upgradeLogistics: 82,
                legacySpawnContinuity: 100,
                extensionFeasibility: 95,
                futureStructureFeasibility: 92,
                towerCoverage: 100,
                traffic: 86
              },
              feasibility: {
                ratio: 0.94,
                extensionRatio: 0.93,
                criticalBlocked: 0,
                blocked: []
              },
              routes: {
                sourceAverageCost: 20,
                controllerCost: 12,
                spawnCost: 0,
                exactRouteCount,
                fallbackRouteCount,
                pathSearches
              }
            },
            topCandidates: [],
            legacyPlannerAuthority: options.legacyPlannerAuthority ?? 'UNCHANGED',
            nextPhase: 'P3_DEFENSE_PERIMETER_NOT_IMPLEMENTED'
          }
        }
      }
    }
  };
}

{
  const events = [
    status(1000),
    { tick: 1099, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateP2Shadow({ events, startTick: 1000, tickCount: 100, roomName: 'E8N1' });
  assert.equal(result.complete, true);
  assert.equal(result.outcome, 'PASS');
  assert.equal(result.checks.find(c => c.id === 'planner-evidence').status, 'PASS');
  assert.equal(result.checks.find(c => c.id === 'shadow-authority').status, 'PASS');
  assert.equal(result.checks.find(c => c.id === 'plan-ready').status, 'PASS');
  assert.equal(result.checks.find(c => c.id === 'plan-contract').status, 'PASS');
  assert.equal(result.checks.find(c => c.id === 'p1-route-evidence').status, 'PASS');
  assert.equal(result.checks.find(c => c.id === 'scheduler-isolation').status, 'PASS');
  assert.equal(result.checks.find(c => c.id === 'plan-freshness').status, 'PASS');
}

{
  const events = [
    status(2000, { authority: 'ACTIVE' }),
    { tick: 2099, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateP2Shadow({ events, startTick: 2000, tickCount: 100 });
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.checks.find(c => c.id === 'shadow-authority').status, 'FAIL');
}

{
  const events = [
    status(3000, { candidateAnchorCount: 7, pathSearches: 30 }),
    { tick: 3099, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateP2Shadow({ events, startTick: 3000, tickCount: 100 });
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.checks.find(c => c.id === 'plan-contract').status, 'FAIL');
}

{
  const events = [
    status(4000, { status: 'NO_FEASIBLE_ANCHOR', selectedValid: false }),
    { tick: 4099, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateP2Shadow({ events, startTick: 4000, tickCount: 100 });
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.checks.find(c => c.id === 'plan-ready').status, 'FAIL');
}

{
  const events = [
    status(5000, { exactRouteCount: 0, fallbackRouteCount: 4 }),
    { tick: 5099, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateP2Shadow({ events, startTick: 5000, tickCount: 100 });
  assert.equal(result.outcome, 'WATCH');
  assert.equal(result.checks.find(c => c.id === 'p1-route-evidence').status, 'WATCH');
}

{
  const sample = status(6200, { planTick: 5600 });
  const events = [sample, { tick: 6299, code: 'BOT_HEARTBEAT', ctx: {} }];
  const result = evaluateP2Shadow({ events, startTick: 6200, tickCount: 100 });
  assert.equal(result.outcome, 'WATCH');
  assert.equal(result.checks.find(c => c.id === 'plan-freshness').status, 'WATCH');
}

// Pre-release plans serialized into current-version snapshots cannot
// satisfy the release scheduler check even when their age is acceptable.
{
  const row = status(9150, { planTick: 8999 });
  const result = evaluateP2Shadow({ events: [row, { tick: 9199, code: 'BOT_HEARTBEAT', ctx: {} }], startTick: 9100 });
  assert.equal(result.outcome, 'WATCH');
  assert.equal(result.checks.find(c => c.id === 'scheduler-isolation').status, 'WATCH');
  assert.equal(result.checks.find(c => c.id === 'plan-freshness').status, 'PASS');
}
// A new plan tick without the corresponding scheduler run is also insufficient.
{
  const row = status(9250, { planTick: 9250 });
  row.ctx.scheduler.processes['planner-vnext-shadow'].lastRunTick = 9249;
  const result = evaluateP2Shadow({ events: [row, { tick: 9299, code: 'BOT_HEARTBEAT', ctx: {} }], startTick: 9200 });
  assert.equal(result.checks.find(c => c.id === 'scheduler-isolation').status, 'WATCH');
}

console.log('P2 live verification tests passed');
