# D6 – Critical core Rampart repairs under actual siege

Review-only development from Main 596dddfe805d4866c293b2b5d13fcd6a37a57371.

## Objective

Tower attacks and rescues during battle override Tower repairs. Ordinary
workers can meanwhile spend time repairing roads, distant walls or
building low-priority structures. A damaged Rampart directly over a
Spawn, Tower or Storage requires a separate targeted repair priority.

## Behavior

The new bounded work-priority predicate checks only existing owned
Ramparts physically on owned Spawn/Tower/Storage tiles. Actual in-range
enemy ATTACK, WORK and RANGED_ATTACK parts produce a conservative
per-tick damage estimate (x4 upper bound when boost metadata is
present). Unknown, inactive, distant, scouting and non-owned targets
are not accepted. A shield is urgent only below 30,000 hits or below
12 estimated ticks of incoming damage. Highest breach urgency wins.

Funded workers, builders and repairers attempt an urgent shield repair
after an existing emergency Spawn/Tower repair but before optional
building or maintenance. If out of range, move only toward repair range
3, within the same room, respecting the existing civilian evacuation
handler. The legacy survival/hauler refill branch remains ahead of this
stage. The live defender and harvester prioritization remain unchanged.

One additional repairer is requested under verified RCL4+ siege
pressure without overriding the existing workforce emergency hold.
No second Tower combat caller, Safe Mode changes, external raiding
or speculative construction placement are introduced.

## Evidence and release status

Canonical Node24 regression tests cover target ownership, weapon
reach, boost, safe range, no enemy/no threat, worker energy, peacetime
and existing role demand. Exact-base secretless CI also runs the
original P3 four-mode benchmark.

D6 remains in review while D4/D5 Main 596dddfe805d4866c293b2b5d13fcd6a37a57371
finishes exact 100-real-game-tick verification on Newbieland and World.
Do not count mock repairs as real Rampart durability gains. Even a
verified repair pipeline cannot guarantee survival against every siege.
