# D8 – Authenticated settled combat and core shield durability evidence

Parent Main: `0b07dda51c4ebe15d4706133b1c98b1cd3a90f28` (D7).
This is a **non-deploying review branch** until the predecessor passes
both guarded real-world 100-tick checks and its exact-head tests pass.

## Actual Screeps evidence
- `Room.getEventLog()` exposes **the previous tick's game-resolved events**,
  not an accepted `tower.attack()`, `tower.heal()` or `creep.repair()`
  intent. Verified against the current Screeps API documentation.
- D8 checks event actor IDs against the room state's **still-visible
  owned Towers** for settled attack damage/healing. Actual repair events
  by still-visible owned actors against **currently visible owned
  Ramparts** over actual owned Spawn/Tower/Storage count as settled
  core-shield repair. Incoming damage is a **lower bound** only when the
  target is a still-visible owned Creep or structure and actor is
  not a recognized currently owned actor.
- Destroyed Tower/Spawn/Rampart/creep may be absent when the next
  tick is inspected. Consequently zero is NOT proof of zero combat,
  zero raid deaths or victory. Enemy identities and object IDs are
  never persisted to snapshots.
- Per-room observations include the physically witnessed count of
  owned critical Spawn/Tower/Storage, how many have an owned overlay
  Rampart, and the **minimum observed remaining Rampart hits**.
  A construction site does not count as protection.
- Last 100 **consecutive** successfully sampled game ticks are
  published as a `COMPLETE` window (with exact previous-tick event
  bounds). No evidence emitted for missing, over-cap (>250), malformed
  or CPU-skipped tick; continuity is reset. One sample is PARTIAL,
  never a 100-tick pass. Sampled events are lower-bound numbers,
  and action-attempt counts from D4/D5 are not mixed with settlement.
- All cumulative counters, room counts (max 3), memory contents
  and event logs (max 250 per room) are bounded. One re-entry into
  an observed game tick cannot double-count. Persistence supports a
  Screeps global reset without repeating the prior sample.

## Game safety
- `defense.combat.settlement.js` is **read-only** with respect to
  gameplay. It uses event observation and private bounded Memory
  aggregate storage, no Tower/Creep/Spawn/Walls/Attack/Movement
  actions, no counterattack authority, no memory of enemy players.
- Observation occurs only after the early D3 Tower+Safe Mode phase,
  when spare CPU/headroom is sufficient. It is exception-isolated.
  Under CPU pressure the fight still continues, but the evidence
  window becomes incomplete.
- Actual D8-gameplay behavior is unchanged. The standalone telemetry
  cannot prove the bot has survived a real coordinated siege or that
  two active Spawns are available (RCL restrictions still apply).
- Before deployment: canonical Node24 `npm test`, full P3 four-mode
  benchmark, exact-head CI and active Main predecessor 100-tick
  evidence. Postmerge real data must contain relevant event samples
  before settled combat outcomes may be claimed.
