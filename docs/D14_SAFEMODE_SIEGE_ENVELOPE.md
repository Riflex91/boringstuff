# D14 – Safe Mode Envelope & Owned-Shield Preservation

Parent Main D13 `d5d2d55e76bcb43b6ec22494fc4d9683510fa621`.
Newbieland [#39566167772](https://github.com/Riflex91/boringstuff/actions/runs/39566167772)
and World [#39566167836](https://github.com/Riflex91/boringstuff/actions/runs/39566167836)
have both successfully passed guarded >=100 real-tick D13 deployments.

## Problem and authority

D13's physically weak 1000-hit Rampart failed under 3 persistently
boosted WORK parts in a deterministic **no Safe Mode** test. The
productive bot ALREADY includes the scarce Safe Mode intent under
`room.manager.safeModeDecision` for **actually existing owned
critical-core Ramparts** with <=8 upper-bound enemy damage ticks left.
A no-Safe-Mode mock defeat is therefore not proof of actual
live-colony defeat. This D14 review uses the true existing decision
function, not a newly invented Safe Mode caller.

Separate code audit uncovered a true avoidable Safe Mode waste:
historically damaged own Spawns/Towers/Storage were considered
directly exposed even while a **healthy, already built owned Rampart
on precisely the same square** absorbed every hostile hit. A weak
adjacent attacker could consume a limited Safe Mode charge merely
because of historic core damage despite the shield having thousands
of hits to absorb further attacks. Screeps' documented rampart rule
protects same-tile structures until the rampart breaks.

## Narrow D14 productive change

In the existing sole authoritative `safeModeDecision`:
- A critical structure must explicitly report `my===true`.
  Unowned, foreign or unknown-ownership structures cannot consume
  the colony's limited Safe Mode charge.
- If a physically **built, owned, positive-hit** Rampart overlays that
  same structure, defer the direct underlying structure-health test
  and assess the existing Rampart <=8-equivalent-active-damage-tick
  breach guard below instead. An incomplete construction site,
  foreign, remote, dead or missing shield does NOT count.
- Missing or already destroyed shields leave the original proactive
  core-loss/critical-health defense active.
- The original Safe Mode gating for safeModeAvailable, active Safe
  Mode and cooldown, active hostile weapon range, boosted upper-bound,
  early D3 defense ordering and single activation authority remain.
- D11–D13 core repairers, Towers, energy logistics, defensive creeps,
  Spawn code and raid authority are unchanged.

## D14 stress proof and evidence limitations

`tools/d14-safemode-siege-envelope.test.mjs` imports the genuine D13
multi-wave policy fixture and calls the actual `room.manager` Safe
Mode decision and activation:
- A 1000-hit owned shield with a real visible 3-WORK boosted attacker
  (600 possible damage/tick) invokes Safe Mode once before impact and
  the synthetic game prevents consequent hostile hit settlement for
  12 modeled ticks. Towers remain able to act.
- Identical attackers without an available Safe Mode charge
  still breach at simulated tick 2; no immunity assertion.
- A historically wounded Spawn beneath a 9000-hit owned shield holds
  the scarce charge until the real shield itself approaches imminent
  damage, then activates before a simulated breach.
- Scout, dead or distant attacker, non-owned or remote shield, active
  Safe Mode, controller cooldown and no available charges never
  produce phantom activations.
- When the physically owned overlay is absent, the legacy direct
  threatened-core Safe Mode trigger remains.

The synthetic world suppresses attacks after modeled Safe Mode
activation; it does NOT prove engine `Room.getEventLog()` settlement,
true hostile creep death, real enemy intent cadence, compound sieges
or server-side timing. Full exact-main canonical Node24/P3 review and
independent PR CI precede any protected Main merge and 100-actual-
tick Newbieland/World deployment checks. Actual fight outcomes
must be evaluated using D8–D10 settled in-game evidence.
