# D15 – Core Rampart fortification before optional Tower maintenance

Exact live-verified predecessor: D14 Main
`8c7114250e8942581262771bb38a9695f3a18b3d`.
Both Newbieland [#39570631835](https://github.com/Riflex91/boringstuff/actions/runs/39570631835)
and World W37S79 [#39570631897](https://github.com/Riflex91/boringstuff/actions/runs/39570631897)
passed guarded exact-code and >=100 actual game ticks.

## Why change this?

The D14 `tower.manager.run()` peace phase searched **all**
structures except walls/Ramparts for any object below 35% hits,
repaired that object with **every Tower >500 energy** and returned
before even attempting the D3 protected-core Rampart repair
(target 120,000 hits at RCL6 and energyStored >=3k).
A badly worn noncritical Road/Container could therefore consume
the peace-time repair budget on every tick while a built owned
Spawn/Tower/Storage Rampart stayed dangerously thin. Road maintenance
could also engage both Towers simultaneously at energy just over 500,
leaving insufficient ammunition for a sudden raid. Structures with
unknown or explicitly false ownership were not guarded.

## Narrow D15 actual gameplay correction

Only `game/tower.manager.js` runtime behavior changes.
In peaceful conditions (after the exact existing active hostile
attack and injured own-Creep heal phases):

1. Direct, **explicitly owned** Spawn/Tower/Storage with positive
   health below 35% is still immediately repaired with every
   available Tower carrying >500 energy. Existing direct critical
   core protection remains ahead of the overlay shield.
2. Next, fortify the weakest actually **built, owned, overlaid
   critical-core Rampart** below the original RCL-dependent
   target, using at most one Tower with >=800 energy and only if
   real colony storage >=3k. D3 target, energy gates and target
   identity checks remain unchanged.
3. Only after no damaged critical core or under-target core
   shield exists, ordinary maintenance of damaged owned
   Extension/Link/etc and road/container infrastructure is allowed
   with **storage >=5k** and **only one Tower >=900 energy**.
   Foreign buildings, roads explicitly marked `my:false`,
   remote generic Ramparts and walls never divert ammo.
   If energy is insufficient, status is `RESERVE_ENERGY`.
4. A harmless scout still cannot consume combat ammunition.
   Genuine combat still immediately outranks peaceful repair.
   Injured friendlies retain their original healing behavior.
5. The D11–D14 repairer, Safe Mode, Spawn, Tower threat-targeting
   and energy-Hauler modules are not changed.

## Verification

`tools/d15-core-fortify-maintenance-priority.test.mjs`
exercises the actual tower manager module against two rich Towers,
a critically damaged Spawn, weak owned Spawn Rampart and worse
noncritical Road/Container/Extension, stores at 1.2k/3.1k/5.5k,
Tower reserves 500–1,000, hostile damage, scout, wounded own
Creep, foreign maintenance objects and stable one-intent accounting.

The branch-only secretless CI enforces the exact D14 parent,
the sole `game/tower.manager.js` runtime delta, full canonical
Node24 regressions and original P3 4-mode benchmark. Independent PR
CI must pass before merging. The guarded Main deployment must still
pass backup, exact-module upload and >=100 **real game ticks**
independently on both servers.

Higher priority for fortification does NOT create an absent shield:
`room.planner.fortifyCore()` must first place an owned site,
and workers must construct it. Neither an offline model nor a quiet
100-tick game run proves successful resistance to a boosted
three-WORK siege with no available Safe Mode. D8–D10 must validate
the settled Tower and Rampart effects under actual battle.
