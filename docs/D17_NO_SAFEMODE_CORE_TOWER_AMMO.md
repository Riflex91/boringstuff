# D17 – No-Safe-Mode authentic core-siege Tower ammunition reserve

Predecessor D16 exact Main `aa96362ebef73126a075bd1f7d5d4ec835efd44c`, successfully guarded deployed on Newbieland
[#39623163133](https://github.com/Riflex91/boringstuff/actions/runs/39623163133)
and World W37S79
[#39623163104](https://github.com/Riflex91/boringstuff/actions/runs/39623163104),
with 100+ actual game ticks and CPU/fatal checks on each server.
D16 above-baseline physical shield hardening stays dormant at
previously measured ~5k storage energy; E8N1's RCL7 controller growth
remains more urgent than discretionary shield hits.

## Threat and existing safeguards

D7 delivery target routing already prioritizes an actually depleted
Tower below 50% before extension energy during any armed assault, and
refills Tower 50–80% before extensions only with **>=80% of room energy
capacity** ready for spawning. The Spawn always remains first.
Under a long direct core attack with **Safe Mode charges demonstrably
exhausted**, a Tower at 60% could continue depleting while extensions
consume incoming energy, even though the room still has >=50% of its
capacity and a genuine Spawn/harvester minimum is preserved.
When towers fall below 50%, the old rescue rule eventually acts, but
there is less ammunition to survive sustained pressure.

## Restricted D17 adaptation

Only production runtime `game/energy.js` changes. In
`deliveryTargets`, a room may bring its 50–80% Tower ammunition
ahead of routine extensions at **>=50% room available spawn/extension
energy** (and >=300 actual room energy), ONLY when ALL conditions hold:

- Live room is explicitly owned and `safeModeAvailable === 0`;
  Safe Mode is not currently active. Cooldown alone or missing charge
  data never implies zero charges.
- Both `energyAvailable` and `energyCapacityAvailable` are real
  finite values; at least 50% capacity remains available. The spawned
  room's own Spawn still gets absolute delivery priority before
  any Tower.
- The engine currently shows an explicitly owned Spawn/Tower/Storage,
  and a living hostile ATTACK/WORK part at distance 1 or active
  RANGED_ATTACK part at distance <=3 from such a **real** core
  building. Scouts, HEAL-only creeps, disabled parts, remote hostiles,
  foreign/unknown structures and stale data never activate it.
- Room scans are bounded (<=400 owned structures, <=16 owned critical
  buildings, <=40 hostiles and <=50 hostile body parts). The expensive
  full proximity check runs at most once per actual hauler's delivery
  target decision, **not once per candidate structure**.

Existing ordinary D7 logic stays identical when Safe Mode remains
available or unverified, room energy falls below 50% or an enemy is
not in real core-attack range. Towers with <50% ammo still receive the
original emergency refill under any active armed attacker. Tower
commands, repairs, defenders, Safe Mode, CPU reserve, spawning and
automatic raids are untouched. This is routing existing delivered
hauler energy, not creating new energy or assuming accepted transfers
have settled.

## Verification

`tools/d17-no-safemode-core-tower-refill.test.mjs` exercises the
real `energy.deliveryTargets` helper under many threat/charge/energy
states, preserving Spawn-first energy transfer and no-world-intent
regressions. A deterministic 12-tick simulated-hauler sequence
verifies the routing can supply an initially 600/1000-energy Tower
without inventing Screeps transfer settlement. The exact-head
secretless full canonical Node24 suite and original P3 four-mode
benchmark must pass on review and independent PR CI before protected
Main merge. Both Newbieland and World require exact-byte module
verification and >=100 **real game ticks** after deployment.

No lack-of-Safe-Mode real battle win or survival against permanently
boosted dismantlers is claimed without actual D8/D10 engine-settled
combat events and survival of the critical structures.
