# Consumer delivery-readiness observer (SHADOW-equivalent telemetry only)

## Why this is needed

On the live pinned `0.3.0-shadow.15-node24` deployment, at least ten
completed 100-tick economy windows (3826202–3827201) contain **682**
fallback consumer-creep-ticks in the most recently supplied rolling
ten-window view. The larger earlier overlapping view had 727/4538
consumer-creep-ticks. These two views overlap: do not add them.

Important counterexamples from ROOM_HEARTBEAT:
- At tick 3826400 room energy was **1050/1050** with **3** haulers and
  **3** fallback consumers; modeled CARRY deficit was zero.
- At tick 3826750 energy was **12/1050** with **2** haulers and
  **2** fallback consumers, with 19 E3 infrastructure emergencies.
- At tick 3826850 energy was **800/1050** with **3** haulers and
  **3** fallback consumers, again with modeled CARRY deficit zero.

So insufficient room infrastructure energy after expensive spawn starts
does not explain **all** fallback. The current live consumer guard
requires an actual *ready-to-deliver* hauler (positive carried energy
plus delivering flag or half-full threshold); it preserves at least
one hauler for infrastructure. We have no historical per-hauler
inventory or actual transfer-intent results.

## Exact scope of this draft

This is stacked on the exact deployed, unmerged P3.1 commit
`c5ef8c5a1fd2daa49793922771bf5d959c347fb8`.

Changes:
- New `game/consumer.supply.observer.js` aggregates **existing**
  guard decisions and return codes from hauler acquisitions,
  infrastructure transfers and consumer transfers. It reads hauler
  inventories and waiting/fallback consumer states **after** creep
  handlers run.
- `game/energy.js`: counts original transfer/withdraw/pickup return
  codes **after the calls**, and selected guard decisions **after the
  existing guard selector**. No change to call order, target choice,
  transfer arguments, memory-based fallback behavior, body budgets
  or CPU safety limits.
- `game/main.js`: after the critical `creeps` scheduler section,
  invokes the observer on ticks divisible by 25; it does **not** run
  during or before creep actions. The observer skips snapshots when
  CPU bucket is below `CPU_BUCKET_LOW` or remaining CPU headroom
  is less than `SHADOW_CPU_RESERVE + 1`, and skips more than
  120 Creeps or more than 3 owned rooms rather than report partial
  census as complete.
- The single `CONSUMER_SUPPLY_DIAG` event per sampled room/tick
  is version-stamped and explicitly journaled for collection.
  It contains **counts only**, no per-creep names, raw memory,
  target IDs, positions, detailed paths or bodies. Missing samples
  and missing events must never be treated as zero demand or success.

## What the event can and cannot tell us

- `haulers.readyByGuardRule`: number of active haulers with >0
  energy and either `memory.delivering` or carried CARRY at least
  50% (minimum 50 units), under the current existing rule.
- `haulers.totalCarriedEnergy`, `energyPositive`,
  `zeroEnergy`, `deliveringFlag`: aggregate *post-handler*
  memory/store snapshot. This is taken **after orders are issued but
  before Screeps resolves them**; Creep stores can still reflect the
  old tick at that point.
- `decisions.guardSelected` and `uniqueGuardHaulers`: observed
  existing priority decisions when `shouldPrioritizeConsumer` was
  actually called, **not** fabricated selections for non-delivering
  haulers.
- `consumerTransfers.accepted`: `creep.transfer` returned
  `OK`; this means a **validly accepted intent**, NOT measured
  end-of-tick settled resource quantities. `notInRange` and
  `other` are separately counted. Likewise infrastructure
  transfers and hauler pickup/withdraw intentions.
- `consumers.waiting`, `fallback`, `critical`, `empty`
  are current post-handler state counts; separate original
  100-tick `fallbackConsumerTicks` accumulators remain the
  authoritative time-window evidence. The occasional heartbeat
  must not extrapolate a new fallback transition count.

No creep movement, CARRY management, delivery priority, guard
assignment, worker self-harvest, spawn sizing, remote activation,
E4 SHADOW matching, P3 scheduler or hard gate is modified.

## Tests and release hold points

The `tools/consumer-supply-observer.test.mjs` unit test validates
a known guard, an unready hauler, mixed consumer/infrastructure
transfer results, no mutation of Creep memories/stores, sampling
only at 25-tick intervals, CPU/bucket skip, missing capacity,
strict scan bounds and per-tick counter reset. The canonical
`npm test` additionally runs the **unchanged**
`consumer-supply.test.mjs` legacy behavioral fixtures.

Node: 24.21.0. CI must pass on exact PR HEAD and the compare against
P3.1 must show no unrelated runtime changes.

**Not yet deployed or measured in real Screeps.** This draft cannot
establish live performance or CPU cost. Following explicit user
permission for a future deploy, require: new exact deployment
receipt/version and marker, 25-tick smoke, first 100-tick complete
verification, bucket/CPU health and repeated observed diagnostic
samples across both high-energy and low-energy fallback episodes.
Avoid deploying until the actual diagnostic overhead is assessed
and a rollback path is ready.

Do not merge or deploy without separate, explicit user approval.
