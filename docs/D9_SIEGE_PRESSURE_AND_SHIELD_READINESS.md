# D9 – Live shield-pressure prognosis and fortress readiness

Parent / live-predecessor: D8 Main
`230981f051dd654fb946346ad9cd40e9a6265aea`.
Both D8 deployments passed their guarded real-tick verification:
Newbieland [#39500916486](https://github.com/Riflex91/boringstuff/actions/runs/39500916486)
and World W37S79 [#39500916463](https://github.com/Riflex91/boringstuff/actions/runs/39500916463).

## Purpose

D8 proves prior-tick **settled** damage/healing/repairs, but cannot identify
whether the *same* protective Rampart is trending toward destruction.
D9 adds a separate bounded and purely observational assessment of the
current physically owned infrastructure. It never issues gameplay actions.

- Inspect only actual owned Spawn, Tower and Storage (max 16) and own
  built Ramparts directly over their coordinates. Missing construction,
  an unfinished Rampart or a foreign Rampart provides NO claimed protection.
- Against actual visible hostile active ATTACK, WORK or RANGED_ATTACK
  parts, compute a conservative **in-range potential damage estimate**
  with up-to-4x boosted-part multiplier. This is NOT settled damage,
  actual attack intent or a forecast that enemies stay still.
- Rank explicitly: `CORE_UNSHIELDED_UNDER_FIRE`,
  `CORE_SHIELD_BREACH_IMMINENT` (<=3 equivalent current-hit ticks),
  `CORE_SHIELD_AT_RISK` (<=12), `CORE_UNDER_PRESSURE`,
  `ARMED_HOSTILES_PRESENT`, `CORE_EXPOSED`, `QUIET`.
  Unknown input does not downgrade to QUIET.
- Private `Memory.bot.d9SiegePressure` holds exact Spawn-Rampart IDs and
  hits ONLY to match **the same owned Rampart in consecutive game ticks**.
  A different weaker shield cannot falsely produce reported prior damage.
  Public `STATUS_SNAPSHOT.rooms[room].defenseSiegePressure` exposes
  ONLY aggregate net observed shield hits lost/gained, number of matched
  shields, observed shield coverage, low-energy Towers, defender count,
  energy and Safe Mode status. A missing tick yields
  `NO_PREDECESSOR`; a stale observation yields `STALE_OR_UNKNOWN`.
  Damage estimates and observed net changes are labeled separately from
  D8 settled event evidence.
- Aggregate critical risk also generates a deduplicated
  `D9_CORE_SIEGE_PRESSURE` warning. It carries no enemy identities,
  no target IDs, no attack/repair/move orders and no automatic raids.
- CPU-reserve gated AFTER the D3 immediate Tower + Safe Mode/creep phase.
  Missing CPU headroom or unsupported body/structure identity does not
  prevent actual defense; it breaks D9 telemetry continuity.
- Max three rooms, 600 structures per room, 16 core buildings, 40
  hostiles, 50 body parts per hostile. Memory is an optional bounded
  private witness, not an authority for gameplay commands.

## Verification
`tools/d9-siege-pressure-watch.test.mjs`: at-risk vs imminent vs unshielded
under real in-range threat; boosted weapons and dead parts; exact same-ID
loss/gain across ticks; shield replacement; skipped tick, corrupted data,
per-room storage bounds and privacy; no gameplay actions and exact
D9 phase after early defense.

Review CI: full canonical Node24 tests + original P3 4-mode benchmark,
no Screeps credentials and a strict D8-Main predecessor check.
Postmerge guards must independently upload exact new Main code and
verify 100 real ticks on BOTH servers.

This improves warning and measurement, **not survival guarantees**.
A meaningful siege victory needs actual hostile combat evidence, energy
sustainability and proof that critical buildings remained owned.
