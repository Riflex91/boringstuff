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
