# Offline spawn-energy reserve feasibility (NO runtime changes)

## Release and telemetry boundary

Exact current Screeps code pinned to P3.1 HEAD
`c5ef8c5a1fd2daa49793922771bf5d959c347fb8`;
deployed `0.3.0-shadow.15-node24`, marker tick `3812491`,
deployment ID `20261009200957502-9092` on
`newbieland/chatgpt`.

There are two independent, observed full/near-full body spawn starts:

| Spawn start | Role | Cost | Room energy before | First sampled energy after | E3 emergency requests after |
|---|---|---:|---:|---:|---:|
| 3826738 | hauler | 1050 | 1050/1050 at 3826725 | 12/1050 at 3826750 | 19 |
| 3826947 | upgrader | 900 | 1050/1050 at 3826925 | 153/1050 at 3826950 | 14 |

Afterward, E4 SHADOW critical assignment fell to 12.3% and
21.7%, respectively, compared with 95.5% in the intervening
window with no logged large spawn start. These are **correlations**
at sampled ticks, not proof that the starts alone caused real
consumer starvation.

The original `logger.slim` retains only the first 20 items of
arrays. Therefore the historical `SPAWN_OK hauler bodyParts=20`
is truncated and cannot provide an exact spawn duration.
The original body builder at budget 1050 generates 21 parts.

## Deterministic reference body costs (all pure Node modeling)

Scenario uses unmodified `game/body.builder.js` and exact Screeps
base costs for WORK (100), CARRY (50), MOVE (50). Room starts with
1050 spawn/extension energy. `energyImmediatelyLeft` below is
1050 minus body cost; there is **no modeled refill, worker TTL,
actual hauling, pathing, congestion, room emergency, CPU cost or
replacement lead time**.

| Role and body budget | Body parts | WORK | CARRY | MOVE | Energy spent | Left immediately | Nominal spawn ticks |
|---|---:|---:|---:|---:|---:|---:|---:|
| Hauler original, budget 1050 | 21 | 0 | 14 | 7 | 1050 | 0 | 63 |
| Hauler budget 750 | 15 | 0 | 10 | 5 | 750 | 300 | 45 |
| Upgrader original, budget 1050 | 12 | 6 | 3 | 3 | 900 | 150 | 36 |
| Upgrader naive budget 750 | 9 | 3 | 3 | 3 | 600 | 450 | 27 |
| Upgrader budget 800 | 8 | 4 | 2 | 2 | 600 | 450 | 24 |

The naive 750-budget upgrader falls below the existing 800-budget
builder threshold and switches to the generic worker body pattern.
The alternative 800-budget option yields twice-strong WORK pairs,
producing 4 WORK at equal 600 energy spent; this underscores the
**discontinuous body builder** and why a generic energy-budget
cap should not be applied blindly.

The 300-reserve hauler loses 4 of 14 CARRY parts (**28.6%**
nominal instantaneous carry capacity) but spawns 18 ticks sooner.
The budget-800 upgrader loses 2 of 6 WORK parts (**33.3%**
nominal upgrade work capacity) and spawns 12 ticks sooner.
These are body proxies, **not realized throughput or an optimized
whole-colony plan**.

## How to run

```bash
cd tools
npm test
npm run study:spawn-reserve
```

The scenario test fails if the pinned P3.1
`game/body.builder.js` or `game/spawn.manager.js` changes, and
runs the unchanged body builder in-process with test-only Screeps
constants. CI pins Node 24.21.0. Script never writes game state,
files or production config.

## Hold points (nothing deployed)

1. Do not change prespawn lead-time protection or priority classes.
2. Do not shrink an essential hauler or upgrader on the basis of
   these two events alone; check actual TTL, carry throughput,
   refill recovery and repeated windows.
3. Do not interpret E4 SHADOW slot coverage as actual haul rate.
4. A future guarded/runtime policy candidate requires explicit
   operator approval before **deployment** and new exact-release
   preflight, smoke and multiple 100-tick CPU/consumer-supply gates.
5. A merge is separately prohibited without user approval.

This PR contains **only offline test/doc/package script** changes
relative to P3.1. No runtime file changes and no deployment.


## Follow-up observed 750-energy hauler at 850 available

At tick `3827175`, the same deployed release logged
`SPAWN_OK` for a **750-energy hauler**, with 15
complete serialized body parts, projecting a nominal
45-tick spawn. The sampled room energy was
`850/1050` at tick `3827175`; the later tick
`3827200` sample reports `131/1050` and **16**
E3 emergency infrastructure requests. The number
`131` is a later sample and may include refills.

The new pure offline test demonstrates the distinction
between nominal **body budget 750** and a guaranteed
**300-energy immediate reserve**:

| Actual energy at spawn | Budget and cost | Immediate energy left | At least 300 reserved? |
|---:|---:|---:|---|
| 1050 | 750 | 300 | Yes |
| 850 | 750 | 100 | **No** |

It would be incorrect to propose a fixed 750-body budget
as a universal cure. A conditional reserve rule could
instead delay an important replacement creep or
reduce its body, and would need explicit role-urgency/
TTL safeguards as well as a full economic comparison.
No such runtime rule is implemented in this PR.

The separate real consumer-supply evidence also includes
fallback at **1050/1050 energy with three live haulers**,
demonstrating that an energy floor alone cannot solve
the observed delivery/service problem. Read-only
classification is tracked in draft PR #119.
