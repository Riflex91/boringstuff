# O65 – Spawn job stall watchdog (passive game telemetry)

Date: 2026-10-20. Independent **gameplay** Draft PR from the pinned original
Main commit `bc43f2faf1f345e63d9bfe78b6bbaa59e5eaab0c`.
Unlike O39–O64 (archive/release safety only), O65 intentionally adds a
**new in-game read-only observer** and integrates it into `game/main.js`.
It is **not deployed** or merged.

## Why – Newbieland E8N1 incident #369

Authenticated GET-only observations on 2026-10-16 showed repeated
`spawnBusy:true` over 400 real game ticks, zero defenders, an active
hostile, and an apparently very old repairer spawning name. But the
retained HTTP snapshots did not include valid `remainingTime` or a
proven same-game-tick mapping between the spawn job, `Memory.creeps`
and the journal. The same job continuously active for >150 game ticks
was **not** proven. Automatically cancelling or modifying a spawn
would be unjustified and dangerous.

## What the bot now does in this unmerged candidate

`game/spawn.job.stall.shadow.js` is called **once each executed game
tick**, after normal room management, from `game/main.js`. It reads
the actual in-game `Game.spawns[name].spawning` object, its job name,
`needTime`, `remainingTime`, and the authoritative `Game.time`.
It stores a bounded continuity ledger only under
`Memory.bot.spawnJobStallWatch`. It retains at most 64 own spawns and
caps counters at 151.

A **SUSPECT_STALLED** event requires **151 consecutive observed real
game ticks** of the same spawn ID and same spawning job name, with
each sample containing valid live timing evidence. A skipped tick,
invalid/missing timer, unowned spawn, destroyed spawn, new job, new
spawn ID, or restarted game clock resets the continuous witness.
Declining timers are recorded; timer stalls/resets are counted as
anomalies but are never interpreted as a reason to mutate game state.

Only when the threshold is first crossed does the bot emit one
`SPAWN_JOB_STALL_SUSPECT` journal warning with room, observation
count, timer sample count and anomalies. The warning calls for human
review: **not** proof of root cause. Neither spawn job name nor spawn
ID nor creep name is placed in journal entries or public snapshots.
The per-room `STATUS_SNAPSHOT.rooms[room].spawnJobStall` summary
reports `OBSERVING`, `IDLE`, `TIMER_UNKNOWN`, `UNOBSERVED` or
`SUSPECT_STALLED` plus bounded counts. No extra network reads.

## Explicit gameplay safeguards

- Does **not** cancel a job, issue `spawnCreep` or override defender
  priority. `game/spawn.manager.js` remains byte-identical to Main.
- Does **not** delete `Memory.creeps` or rewrite creep jobs, branch
  selection, body composition, emergency recovery or combat intent.
- Does not manufacture historical in-game evidence from old HTTP
  snapshots, `Memory.creeps[name].born`, or elapsed wall-clock time.
- All failures of optional observation are caught; they cannot prevent
  critical room, creep or defense work.
- Main version and critical gameplay configuration are not modified.
  There is no new live authorization to deploy, merge, spawn or recover.

## Tests

`tools/spawn-job-stall-shadow.test.mjs` exercises valid countdown,
151 consecutive ticks and a single warning, timing gaps, false
continuity after a serialized memory reload, missing/invalid timings,
spawn replacement, job replacement, destroyed/unowned spawn, 64-spawn
memory bound and leak-free log/snapshot presentation. It asserts the
observer has no spawn mutations and defender priority is unchanged.
O65's branch-specific workflow runs the full canonical Node24 tests
and P3 benchmark and permits exactly `game/main.js` and the new
observer as gameplay deltas against pinned Main.

**Release remains `HOLD_EXACT_PREDECESSOR_PAIR_MISSING`.**
The user-verified local original ZIPs and encrypted C:/D: replica
do not provide a new World canonical exact-Main `LIVE_100T_PASS`
or permit automated game deployment. All actual live observations
of the new observer must wait for the separately authorized release.
