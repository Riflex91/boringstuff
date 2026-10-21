# D16 – Surplus-only owned core shield hardening without consuming RCL7 economy

Parent Main: D15 exact `ae094b8f675f9ea48e03a1d296ea39bfbd113949`.
Both D15 guarded deployments passed >=100 actual game ticks:
Newbieland [#39585137327](https://github.com/Riflex91/boringstuff/actions/runs/39585137327)
102 ticks, RCL6, CPU 14.286/bucket 10000; World W37S79
[#39585137308](https://github.com/Riflex91/boringstuff/actions/runs/39585137308)
113 ticks, RCL5, CPU 11.741/bucket 10000.

D16 real GET-only core audit
[#39585406885](https://github.com/Riflex91/boringstuff/actions/runs/39585406885)
confirms BOTH rooms currently have **three actual built owned core-overlay
Ramparts**, covering one Spawn and two Towers:
E8N1 150401/150201/150101 hits; World W37S79
125301/125401/125301 hits. Neither currently requires construction
and both exceed their existing baseline at RCL6 (120k) / RCL5 (100k).
Observed saved storage 5248 / 5443 energy and no hostile during audit.

## The constrained gap

D13 synthetic 3x boosted WORK assault with 600 maximum hypothetical
hitpoints/tick demonstrated that a very weak 1k-hit core overlay
breaches in 2 synthetic ticks when Safe Mode is not available. The
real D14 Safe Mode behavior may stop this; however charges/cooldown
are finite, and under more sustained stronger raids a larger
physical shield is a valuable second layer.

D15 already protects the *baseline* Rampart repair before roads.
It caps maintenance at 150k max and never makes use of future storage
surplus to prepare for a siege with no Safe Mode.

## New D16 real game policy

Change only `game/tower.manager.js` under the existing combat ->
friendly healing -> true damaged own Spawn/Tower/Storage ->
owned core-shield -> discretionary maintenance hierarchy:

- Preserve the original RCL-based core shield baseline, the
  >=3k real stored energy requirement and a single Tower with >=800
  energy for below-baseline strengthening.
- For RCL5+ **actually owned** room with **>=20,000 real stored energy**
  and a real completed owned core Rampart below 300k hits, allow
  a second reserve-safe peaceful fortification band, with exactly
  **one** Tower carrying >=900 energy.
- If controller `safeModeAvailable === 0` explicitly, allow the
  same 300k hardening at **>=12,000 real stored energy**. Unknown
  charges, active cooldown without confirmed zero charges and a
  mere belief of danger do not activate this lower threshold.
- Never fortify absent, unbuilt, unowned, zero-health, remote
  or generic perimeter Ramparts. No arbitrary construction sites.
  Enforce the existing weak-shield-first deterministic order.
- Never spend energy from low-ammo Towers on this surplus
  strengthening. A genuine hostile or wounded own Creep always
  takes priority. Direct critically damaged own Spawn/Tower/Storage
  retains priority. No extra defensive Creep, Safe Mode, expansion,
  parallel Spawn or attack authority is added.
- At the *current measured 5k storage in both rooms*, the 300k
  hardening is **inactive**. This intentionally prevents
  slowing E8N1's RCL7 progress or draining World bootstrap reserves.

## CI and limits

`tools/d16-surplus-core-hardening.test.mjs` covers the
actual current 5k no-op, explicit zero-Safe-Mode at 12k,
no charge information, 20k upper surplus threshold,
baseline 800 vs advanced 900 Tower ammo, limit at
300k, ownership/damaged/remote/foreign core shield,
original combat and ally heal priorities, non-owned room/RCL4
guard, and deterministic victim choice.

Full canonical Node24 tests (including D13–D15 stress) and
original P3 four-mode paired benchmark must pass before
merging. The existing guarded deployments to Newbieland and
World must both pass actual >=100 game ticks afterward.
Raising an offline hit target improves potential buffer but
does not prove a real enemy defeat or true time to breach,
since DPS/healing/Tower effective range/energy supply change.
