# P3.2 topology snapshot reuse — offline candidate

## Live observation motivating the experiment

On `newbieland/chatgpt` with unchanged `0.3.0-shadow.15-node24`, receipt
`20261009200957502-9092`, marker tick `3812491`:

| Source | Run tick | Scheduler CPU | PROTECTED_TOPOLOGY | MINCUT | DEFENSE_SCORE | Not directly attributed |
|---|---:|---:|---:|---:|---:|---:|
| P3.1 observed | 3812915 | 11.190 | 4.821 | 4.434 | 1.364 | 0.571 |
| P3.1 observed | 3813415 | 4.796 | 0.674 | 2.719 | 0.856 | 0.547 |

P3 verdicts: 7 PASS / 1 WATCH / 0 FAIL, then 8 PASS / 0 WATCH /
0 FAIL. Overall release evidence is WATCH; the 10 observed geometry
counters matched. That does **not** establish complete input identity,
constant cold/warm VM state, or P3.1 CPU causality. Neither these two
runs nor Node wall-clock benchmarks prove an improvement over D0.6.

## Exact candidate and boundary

Stacked after P3.1 draft PR #117 at commit
`c5ef8c5a1fd2daa49793922771bf5d959c347fb8`.
Do **not** deploy P3.2 while its benchmark/CI and explicit approval
are pending.

Previously the `buildGrid` call performed `naturalObstacleSet(state)`
once inside `protectedAssets` and again for grid tile exclusion. It
could query `room.find(FIND_MINERALS)` twice, even though game state
is immutable during a single synchronous evaluation.

P3.2 computes this natural blocker set once in `buildGrid` and passes
it to the optional `protectedAssets(..., knownNaturalSet)` parameter.
Direct `protectedAssets` calls remain backward compatible. No changes
to graph edges/capacities, solver, cut, breach scoring, authority,
version, config, runtime cadence, thresholds or telemetry schemas.

## Regression and benchmark

- `npm test`: deterministic mineral lookup call-count test ensures
  one query during P3 evaluation; validates mineral exclusion and direct
  API compatibility. Existing P3 safety tests remain unchanged.
- `npm run bench:p3`: original exact D0.6 parity across open, swamp,
  walls, corridor. Uses full Git history and Node 24.21.0.
- `npm run bench:p3:topology`: loads **exact P3.1** source using
  `git show` and compares full stable P3 results across four fixtures,
  while asserting mineral lookups drop from two to one. Reports
  first invocation timing and 9 alternating 20-run warm medians.
  **Node wall-clock is not Screeps CPU**; a first invocation in an
  already-running Node process does not emulate Screeps's cold V8 isolate.

## Hold points

- [ ] CI all tests, D0.6 parity and exact P3.1 parity on final SHA
- [ ] Inspect timings; do not assume improved speed from removing one call
- [ ] After independent explicit deploy approval, require new marker,
  distinct release CPU windows and SHADOW authority verification
- [ ] No merge into main without separate explicit approval


## First GitHub Actions measurements (#94, candidate SHA 906612dd)

[GitHub Actions #94](https://github.com/Riflex91/boringstuff/actions/runs/37992172972)
passed Node v24.21.0 canonical tests, exact D0.6 parity, and exact
P3.1 parity. Topology benchmark used nine alternating batches with
20 iterations each per variant/fixture, and one **non-isolated**
first invocation per variant before warm-up:

| Fixture | Tiles | P3.1 first ms | P3.2 first ms | P3.1 warm median ms | P3.2 warm median ms | Warm ratio |
|---|---:|---:|---:|---:|---:|---:|
| Open | 840 | 13.161 | 9.456 | 0.987 | 0.916 | 1.08× |
| Swamp | 840 | 1.354 | 1.123 | 0.886 | 0.894 | 0.99× |
| Walls | 730 | 1.205 | 1.043 | 0.937 | 0.913 | 1.03× |
| Corridor | 60 | 0.175 | 0.101 | 0.058 | 0.058 | 1.01× |

All four output identities PASS; P3.1 `find(FIND_MINERALS)` count 2,
P3.2 count 1. The changes are **not consistently faster when warm**;
timing variance is large relative to the small optimization. The
observed first-call timing difference does not recreate live Screeps
V8 isolate startup, and cannot explain the first live topology
measurement of 4.821 Screeps CPU.

**Conclusions:** correctness and reduced redundant query are supported;
a meaningful live CPU improvement is **not yet supported**. Preserve
existing P3 WATCH threshold 10 and hard FAIL threshold 20. No live
deployment without fresh operator authorization.
