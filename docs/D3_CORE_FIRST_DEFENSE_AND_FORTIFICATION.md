# D3 – Core-first defense, standing garrison and protective ramparts

Status: 2026-10-20, reviewed as a gameplay development PR on top of
Main `c063d812d9e0fa2baaba5a972f4ef6a5c923233c`.

## Threat model

One Spawn in each currently observed colony is a single point of failure;
the old `spawn.manager.desired()` made no peacetime defender demand, and
`room.manager.run()` invoked Tower/Safe Mode **after** optional economy,
capacity, logistics and shadow work. Against a high-damage raid this
can leave the colony with no live defender and an unissued defensive
action on a CPU-constrained tick.

## Live behavior introduced

1. The first room state is followed immediately by Safe Mode and Tower
   actions **before all optional economics and SHADOW stages**. Each
   engine call is individually exception-isolated. No repeated Tower
   calls occur in `room.legacy`. Safe Mode still requires owned
   controller, actual in-range active offensive enemy body parts and
   a true endangered critical structure. New additional trigger:
   a nearly breached owned Rampart directly overlaying an owned Spawn,
   Tower or Storage, when actual in-range enemies could destroy its
   remaining hits in at most eight observed-damage-equivalent ticks.
   A distant/disabled enemy or non-core Rampart is not authorization.
2. Towers focus active armed/healing/dismantling hostile creeps; harmless
   scouts and destroyed offensive parts do not spend defensive energy.
   While safe, heal injured own creeps before noncritical repairs.
   A single healthy-energy Tower may maintain the weakest existing
   **owned critical-core-overlay Rampart** up to an RCL-bounded ceiling,
   only when at least 3000 stored energy is physically observed and the
   selected Tower has >=800 energy. Combat always preempts maintenance.
3. `room.planner.plan` places at most **two** verified Rampart sites
   per scheduled plan directly on real owned Spawn/Tower/Storage tiles,
   after essential source/controller infrastructure, extensions and
   Towers, before optional roads. Requires an owned room at RCL4+,
   3000+ stored energy, no hostiles/emergency, clear construction
   site capacity, no existing Rampart/site on that tile, and an
   identical occupied owned structure in `room.lookForAt`. The normal
   blocked-tile building method is not bypassed for any other building.
   Accepted construction intent is not evidence of a completed shield.
4. Standing garrison is one defender when a live owned RCL4+ colony
   has >=550 room capacity, 3000+ stored energy, >=1 worker, >=1
   source-matched Harvester and >=1 Hauler. At RCL6+, 10000+
   stored energy, >=2 owned Towers and >=2 Haulers, target two
   defenders. A survival emergency disables *peacetime*
   standing garrison, but actually armed hostiles still trigger
   existing capped live defender demand of up to three.
   No attack on nonhostile neighbors or unverified target selection.
5. As soon as an owned colony reaches **RCL7** (the first level
   allowing a second Spawn), the existing room planner attempts
   **at most one** legal duplicate-capacity Spawn construction site,
   3–5 tiles from the observed original Spawn. Preconditions:
   12000+ genuinely stored energy, no active hostiles, no room
   survival emergency, owned controller, available controller
   Spawn quota, available site slots, verified walkable/nonoccupied
   destination. Any already pending Spawn site counts toward the
   quota. No attempt to create a second Spawn at RCL5/6, and no
   speculative World Spawn placement or resetting an existing Spawn.

## Tests and limits

`tools/d3-core-defense-first.test.mjs` checks exact ordering,
Safe-Mode/Tower failure isolation, active enemy vs harmless scout,
critical-core shield imminent-loss trigger, peace-time reserve-safe
Tower rampart repairs, bounded verified rampart placement and legal
RCL7+ second-Spawn site creation.

`tools/d3-standing-defense.test.mjs` proves peacetime reserves,
a RCL6 defensive pair, economic failure holds, and active raid scale-up.

The canonical Node24 test chain and original P3 benchmark run in the
no-credentials branch review workflow. The Main merge can
automatically deploy to Newbieland and World. Real World
`LIVE_100T_PASS` must be observed at the exact new Main SHA; synthetic
regressions cannot establish zero attack risk or guarantee survival.

Further hardening (not part of D3): verified second Spawn redundancy,
battle-time Tower healing allocation vs focus fire, dismantle/heal
counterplay, logistics buffer under prolonged siege, attack-response
telemetry and controlled hostile simulation in the live environment.
