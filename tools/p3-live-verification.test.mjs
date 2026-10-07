import assert from 'node:assert/strict';
import {
  evaluateP3Shadow,
  P3_CPU_WATCH,
  P3_CPU_FAIL
} from './p3-live-verification-core.mjs';

function status(tick, options = {}) {
  const plannerTick = options.plannerTick ?? 1000;
  const defenseTick = options.defenseTick ?? 1001;
  const lastCpu = options.lastCpu ?? 6.5;
  const breachRouteCount = options.breachRouteCount ?? 0;
  const exposedAssetCount = options.exposedAssetCount ?? 0;
  const authority = options.authority ?? 'SHADOW';
  const constructionAuthority = options.constructionAuthority ?? 'NONE';
  const legacyPlannerAuthority = options.legacyPlannerAuthority ?? 'UNCHANGED';
  const defenseStatus = options.status ?? 'READY';

  return {
    tick,
    code: 'STATUS_SNAPSHOT',
    ctx: {
      scheduler: {
        processes: {
          'defense-mincut-shadow': {
            lastRunTick: defenseTick,
            lastCpu,
            cpuEMA: lastCpu,
            runCount: 1,
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
            authority: 'SHADOW',
            status: 'READY',
            roomName: 'E8N1',
            planTick: options.observedPlannerTick ?? plannerTick,
            phase: 'ANCHOR_AND_CORE_GEOMETRY',
            legacyPlannerAuthority: 'UNCHANGED'
          },
          defenseMinCut: {
            schemaVersion: 1,
            authority,
            status: defenseStatus,
            reason: defenseStatus === 'READY' ? null : 'TEST_REASON',
            roomName: 'E8N1',
            planTick: defenseTick,
            sourcePlannerTick: plannerTick,
            phase: 'DEFENSE_MINCUT',
            bounds: {
              minX: 12,
              minY: 18,
              maxX: 30,
              maxY: 36,
              width: 19,
              height: 19,
              area: 361
            },
            protectedAssetCount: 42,
            trafficTileCount: 31,
            graph: {
              walkableTiles: 333,
              nodeCount: 668,
              edgeCount: 3100,
              augmentations: 18,
              maxFlow: 1800,
              complete: true
            },
            rampartCount: 18,
            ramparts: [
              { x: 12, y: 20, trafficCrossing: false, existingRampart: false }
            ],
            rampartGroupCount: 1,
            metrics: {
              repairBurdenIndex: 21.4,
              towerCount: 4,
              towerMinimumDamage: 600,
              towerAverageDamage: 1200,
              towerMinimumCoverageScore: 100,
              towerAverageCoverageScore: 100,
              breachRouteCount,
              exposedAssetCount,
              exitExposedWithin5: 0,
              exitExposureRatio: 0,
              averageExitDistance: 12,
              trafficCrossings: 1
            },
            score: {
              total: 88.5,
              components: {
                rampartEconomy: 46,
                repairBurden: 57,
                towerCoverage: 100,
                breachResistance: breachRouteCount === 0 ? 100 : 60,
                exitExposure: 100,
                traffic: 94
              }
            },
            phaseEvidence: [],
            legacyPlannerAuthority,
            constructionAuthority
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
  const result = evaluateP3Shadow({ events, startTick: 1000, tickCount: 100, roomName: 'E8N1' });
  assert.equal(result.complete, true);
  assert.equal(result.outcome, 'PASS');
  assert.equal(result.checks.find(c => c.id === 'mincut-evidence').status, 'PASS');
  assert.equal(result.checks.find(c => c.id === 'shadow-authority').status, 'PASS');
  assert.equal(result.checks.find(c => c.id === 'mincut-ready').status, 'PASS');
  assert.equal(result.checks.find(c => c.id === 'mincut-contract').status, 'PASS');
  assert.equal(result.checks.find(c => c.id === 'p2-dependency-order').status, 'PASS');
  assert.equal(result.checks.find(c => c.id === 'scheduler-isolation').status, 'PASS');
  assert.equal(result.checks.find(c => c.id === 'mincut-cpu').status, 'PASS');
  assert.equal(result.checks.find(c => c.id === 'plan-freshness').status, 'PASS');
}

{
  const events = [
    status(2050, { authority: 'VNEXT' }),
    { tick: 2099, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateP3Shadow({ events, startTick: 2000, tickCount: 100 });
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.checks.find(c => c.id === 'shadow-authority').status, 'FAIL');
}

{
  const events = [
    status(3050, { breachRouteCount: 2, exposedAssetCount: 2 }),
    { tick: 3099, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateP3Shadow({ events, startTick: 3000, tickCount: 100 });
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.checks.find(c => c.id === 'mincut-contract').status, 'FAIL');
}

{
  const events = [
    status(4050, { plannerTick: 4001, defenseTick: 4001 }),
    { tick: 4099, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateP3Shadow({ events, startTick: 4000, tickCount: 100 });
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.checks.find(c => c.id === 'p2-dependency-order').status, 'FAIL');
}

{
  const events = [
    status(5050, {
      plannerTick: 5000,
      observedPlannerTick: 5025,
      defenseTick: 5001
    }),
    { tick: 5099, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateP3Shadow({ events, startTick: 5000, tickCount: 100 });
  assert.equal(result.outcome, 'WATCH');
  assert.equal(result.checks.find(c => c.id === 'p2-dependency-order').status, 'WATCH');
}

{
  const events = [
    status(6050, { lastCpu: P3_CPU_WATCH + 0.5 }),
    { tick: 6099, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateP3Shadow({ events, startTick: 6000, tickCount: 100 });
  assert.equal(result.outcome, 'WATCH');
  assert.equal(result.checks.find(c => c.id === 'mincut-cpu').status, 'WATCH');
}

{
  const events = [
    status(7050, { lastCpu: P3_CPU_FAIL + 0.5 }),
    { tick: 7099, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateP3Shadow({ events, startTick: 7000, tickCount: 100 });
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.checks.find(c => c.id === 'mincut-cpu').status, 'FAIL');
}

{
  const events = [
    status(8050, { status: 'INCOMPLETE' }),
    { tick: 8099, code: 'BOT_HEARTBEAT', ctx: {} }
  ];
  const result = evaluateP3Shadow({ events, startTick: 8000, tickCount: 100 });
  assert.equal(result.outcome, 'FAIL');
  assert.equal(result.checks.find(c => c.id === 'mincut-ready').status, 'FAIL');
}

console.log('P3 live verification tests passed');
