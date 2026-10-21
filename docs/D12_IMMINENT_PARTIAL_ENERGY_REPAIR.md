# D12 – Partially Energized Dedicated Repairer Acts Without Full-Load Delay

Exact live-verified predecessor: D11 Main
`117c087999ba2eef86a6634dae80f27c73a4f629`.
Successful guarded Newbieland [#39558177385](https://github.com/Riflex91/boringstuff/actions/runs/39558177385)
and World [#39558177394](https://github.com/Riflex91/boringstuff/actions/runs/39558177394)
100-real-tick release workflows.

## Failure mode addressed

D11 rescued the **already working/loaded** dedicated `repairer` before
its own ordinary energy delivery, for a currently visible, owned and
physically built critical Spawn/Tower/Storage overlay Rampart exposed
to <=3 active in-range hostile-weapon damage-equivalent ticks.

However an actual `repairer` in the ordinary **gather** state may
already be carrying 1–99 energy and can remain in its
`CONSUMER_HAULER_WAIT_TICKS` wait (default 12), instead of putting
that actual stored energy to productive emergency shield repair.

D12 narrows this gap: right BEFORE `needsEnergy()` would continue to
wait, only a real owned `repairer` in `working:false` with **positive
physically observed Creep store energy** and at least one active WORK
part may be transitioned to `working:true`, and only if **ALL**
existing D11 immediate defense gates are met:
- live owned controller, Safe Mode not currently active;
- at least one ready nonspawning Hauler for hard infrastructure supply;
- no directly critically damaged owned Spawn/Tower/Storage takes priority;
- actually owned, built critical-core Rampart at most 3 equivalent active
  in-range enemy-damage ticks from destruction;
- no hostile scout/dead weapon, remote enemy or unowned/remote shield
  can trigger it.

This only updates the **existing repairer's** `working`,
`waitingEnergyTicks`, `logisticsFallback` state. It does NOT
withdraw/harvest energy, preempt a productive last worker, reorder
Spawn/Tower energy supply, create or dispatch Creeps, authorize new
attacks or change Safe Mode. D11's ordinary preempt-for-imminent-shield
then issues the previously tested repair intent in the SAME game tick.
The existing civilian evacuation handler still runs before the worker
role. Accepted energy transfers remain unverified until engine settlement:
the emergency transition needs actual `creep.store[RESOURCE_ENERGY]>0`.

## Validation

`tools/d12-imminent-partial-repair.test.mjs` checks real partial
energy against the urgent shield, last/workless/waiting Creep limits,
zero or still-spawning Haulers, other roles, shield ownership/range,
Safe Mode, remote/destroyed attackers, direct critically damaged Spawn,
absence of energy, and noninterference with pre-existing Hauler
receipt metadata. The branch review CI executes all existing Node24
regressions, D11 tests and the original P3 four-mode benchmark.

Successful tests alone do not prove real combat results. After merging,
both Newbieland and World must independently pass exact-code guarded
upload and >=100 actual game tick verifications. D8–D10 engine-settled
defense evidence under an actual siege is still needed before claiming
that D12 saved a Rampart.
