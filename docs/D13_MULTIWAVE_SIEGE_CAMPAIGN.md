# D13 – Multiwave siege survival lab and sustained repairer-energy discipline

Parent: D12 exact Main `e76a1d1defb61115c24cfd6cf2c3fe2a041a2880`.
Protected Newbieland [#39562612373](https://github.com/Riflex91/boringstuff/actions/runs/39562612373)
and World W37S79 [#39562612292](https://github.com/Riflex91/boringstuff/actions/runs/39562612292)
both passed real-game >=100-tick verification.

## Reproducible actual module vs synthetic engine

The new `tools/d13-multiphase-siege-campaign.test.mjs` loads the real
game modules `tower.manager`, `role.worker`, `work.priority`,
`defense.siege.triage` and `energy.deliveryTargets` and executes
deterministic hostile sequences in a MOCK/SYNTHETIC game engine.
Tower action attempts are counted; the simulator *never* pretends a
Tower attack killed a real hostile, consumes active body parts, or
invokes real Safe Mode. Likewise synthetic repair hits and transfers
are NOT Screeps Room.getEventLog() settled outcomes.

- 8 harmless scout ticks must not waste Tower attacks.
- 26 single in-range unboosted WORK hostile ticks (50 damage/tick):
  1 ready Hauler, a partly loaded dedicated repairer and 2 Towers.
- 12 high-pressure ticks with a hostile carrying 3 boosted active WORK
  parts (600 modeled damage/tick), overmatched single WORK repairer.
- 20 ticks with a lost Hauler, empty Tower energy supply and active
  boosted ranged attacks.
- 75-tick combined waves plus aftermath for contiguous state checks
  and recorded Tower/repairer/energy action attempts.

## Actual vulnerability discovered and bounded gameplay fix

D11 preempted ordinary delivery only at <=3 estimated hostile-hit
ticks until Rampart breach. D12 permitted a partially loaded
repairer to act once on imminent danger. But AFTER that first repair
the shield could rise above the 3-tick urgency threshold while the
same enemy kept attacking. When the room had only one Hauler, the
repairer's ordinary `shouldAssistInfrastructure()` immediately
donated the remaining carried repair energy to the Tower/Spawn refill
queue. By the next imminent threshold the repairer had no energy,
leaving an otherwise supportable ongoing siege under-repaired.

D13 changes ONLY `game/role.worker.js` production behavior:
when there is a **built owned core-overlay Rampart still facing actual
in-range live enemy weapon pressure** under the preexisting bounded
D6 `hasCriticalCoreShieldThreat()` verification, a dedicated own
`repairer` carrying >0 actual energy, in owned room without active
Safe Mode, and >=1 genuinely ready nonspawning Hauler, now retains its
carried energy for productive Rampart repair instead of voluntarily
supplying discretionary infrastructure top-ups. D6 normal
`repairCoreShield()` consumes the repairer's energy in the usual
work phase. The D11 specific <=3-tick override REMAINS unchanged.
Existing critical direct own Spawn/Tower/Storage damage, missing
Hauler, foreign or remote Rampart, disabled enemy weapon or no
actual carried energy preserve legacy economy priorities.
Workers/builders/upgraders and Tower attack/Spawn/Safe Mode logic are
unchanged.

## Exact offline CI observations

Review CI [#39565712427](https://github.com/Riflex91/boringstuff/actions/runs/39565712427)
**SUCCESS** on final review SHA with all canonical Node24 tests and
original P3 four-mode CPU benchmark.

1. Single WORK Dismantler: 26 simulated ticks, 21 repair attempts,
   52 Tower attack attempts, 1 D12 real-partial-energy resume;
   simulated shield survives, 1200 model hit points remain.
2. Three boosted WORK parts: simulated shield breached at tick 2
   starting at 1000 hits; 6000 model damage reaches Spawn during the
   sequence. This is a **known modeled failure**, not a live game loss.
3. Lost Hauler and low Tower ammo: no illegal D11/D12 repairer
   logistics override; 40 model Tower attack attempts, Tower ammo
   eventually reaches zero. Real Spawn-first delivery order remains.
4. Combined 75-tick campaign starting with large shield and peace-time
   Tower repairs: no modeled breach, 116 Tower attack attempts and
   17 peace-time Tower repair attempts. This is no real-world win.

No false claim of permanent survival is warranted. At this stage,
strongly boosted multi-WORK pressure remains a defensive capability
gap requiring earlier fortification, increased tower/defender fire
and/or legitimate Safe Mode readiness; those are **not** silently
enabled in D13.

## Release gates

The test-only branch CI has no Screeps credentials and performs no
live upload. Independent PR Node24 regression checks and P3 must pass
before merging. After a Main merge, both guarded Newbieland and World
pipelines perform exact-byte upload, backup and >=100 real-tick
runtime verification. Those idle-world tests are distinct from
actual observed siege survival in D8–D10 event logs.
