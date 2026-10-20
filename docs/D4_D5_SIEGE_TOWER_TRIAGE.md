# D4/D5 – Siege Threat Evidence and Tower Triage

Operator objective (2026-10-20): colonies must be able to withstand
prolonged raids and keep core infrastructure and productive units alive.

## Actual gameplay behavior

Tower decisions continue **immediately after the room snapshot** as
established by D3, and before CPU-heavy planners. D5 does not add a
second Tower caller.

1. **Threat assessment**: `defense.siege.triage.js` is a bounded,
   side-effect-free module assessing at most 40 hostile Creeps, 48
   friendly Creeps and 50 enemy parts each. Active ATTACK, RANGED_ATTACK,
   HEAL and WORK parts are counted. Destroyed parts have zero effect.
   Present boost metadata is conservatively treated as 4x damage
   for emergency survival prioritization. Unknown evidence is
   reported as `UNKNOWN` or `CAP_EXCEEDED`, never silently as zero.
2. **Focus fire**: Towers maintain existing strong healer priority,
   but an attacker or dismantler actually within damage range of an
   owned Spawn/Tower/Storage receives significant additional urgency.
   Stable ID tie-breaks prevent oscillation for equal scores.
3. **Imminent friendly loss**: if the observed *current* hostile body
   parts could deal at least an injured ally's remaining HP in one
   tick, **all towers heal** the endangered ally instead of
   continuing to focus fire.
4. **Endangered but not imminently dying friendly**: with at least two
   towers, at most one Tower heals and all others continue focused
   hostile attacks; the lone Tower remains offensive when the ally
   is not about to die. A healthy or lightly wounded ally must not
   divert attacks. Peace-time healing is unchanged.
5. **Observability**: `ROOM_HEARTBEAT` and `STATUS_SNAPSHOT` add
   per-room `defenseSiege` and `defenseTowerAction`: status,
   counts of active body parts, aggregate attempted attack/heal/repair
   Tower actions, and available Tower count. No personal names,
   combat target ID, coordinates, or stored targets are emitted.
   Tower attempts are **not** proof that the Screeps engine resolved
   damage or healing and are never reported as kills.

## Safety / scope

- No Memory writes or additional game intent authority outside
  `tower.manager.run`; each Tower receives at most one action.
- All existing core-Rampart construction, Safe Mode, Creep evacuation
  and guard-rail recovery functions are preserved.
- No unverified raids or aggressive autonomous target selection.
- This policy prioritizes an observed imminent allied loss, but cannot
  mathematically guarantee survival against all boosted hostile
  formations or game mechanics.
- Actual enemy combat results require true in-game evidence after
  deployment. Synthetic multi-attacker tests and 100-game-tick
  idle-world verification must not be confused with a demonstrated
  victory over a real siege.

## Regression and deployment evidence

`tools/d5-siege-tower-triage.test.mjs` checks hostile healer vs core
breacher, lethal boosted damage, split heal/attack, noncritical
wounds, enemy scouts, sole Tower priorities, privacy whitelist,
unknown limits, and exact runtime telemetry wiring.

The full canonical Node24 `npm test`, original P3 benchmark and
branch no-secrets review gate must pass at the exact PR head before
a Main merge. Main CI then separately authorizes guarded Newbieland
and World code uploads, backups and 100-real-tick verification.
