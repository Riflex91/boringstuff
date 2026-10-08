# D0.1 — bounded threat observation

This is the first D0 implementation slice, not completion of D0 or of the
Ultimate Autonomous Roadmap. It introduces `threat.model.shadow` after the
authoritative room and creep executors. It cannot issue gameplay intents.

## Implemented

- Active/damaged body and observed boost strength, including effective TOUGH HP.
- Terrain-dependent mobility and carried-resource fatigue.
- Energy/activation-aware tower falloff and nearby hostile healing diagnostics.
- Current-structure access checks, including real ramparts over critical assets.
- Bounded PathFinder work (four searches of at most 200 operations per room).
- Explicit unknown access on unavailable, incomplete or failing path searches.
- NORMAL/WATCH/ALERT/DEFENSE/EMERGENCY classification.
- Conservative asset-loss horizon and an observational Safe Mode recommendation.
- Compact STATUS_SNAPSHOT evidence and an independent BACKGROUND CPU process.
- No durable D0 cache: recompute from visible state, so ownership changes,
  global resets and schema changes cannot leave stale combat decisions.

The implementation uses Screeps runtime constants and observed BOOSTS. API basis:
https://docs.screeps.com/api/#Creep and https://docs.screeps.com/api/#StructureTower.

## Boundaries before authoritative defense

The loss horizon deliberately assumes no future tower energy, repair or defender
intervention. It is an early-loss bound, not a calibrated probability; therefore
`coreLossProbability` is null. It can overestimate danger. Mixed melee/ranged
bodies are conservatively evaluated at their earliest attack range. Healing and
tower coverage are diagnostics, not a claimed tactical simulation. Tower power
effects, dismantling a path through a perimeter, multiple attackers focusing an
asset, and mobile defenders need subsequent combat-model slices.

Truncated observations, unknown boosts, and incomplete paths produce PARTIAL,
never a claim that the room is safe. A hostile CLAIM body creates ALERT but is
not modeled as structural damage. An unarmed scout only creates WATCH. No
unbuilt P3 proposal is treated as an existing defense.

`AUTO_SAFE_MODE`, legacy tower/spawn execution, remote activation and construction
authority remain unchanged. D1 must not treat D0.1 conservative estimates as
validated authoritative defense requirements.

## Verification

`npm test` includes attack fixtures for boosted attackers, damaged parts, TOUGH,
mobility, tower falloff, protected assets, absent APIs, exhausted search budgets,
mutation safety and live-verifier failure cases.

`npm run verify:d0 -- --start-tick N` requires the exact current deployment
receipt and marker, a complete 100-tick window, current D0 snapshot data,
SHADOW/NONE/LEGACY_UNCHANGED authority, valid contracts and isolated CPU <= 5.
Combat absence is WATCH, not proof of combat performance. Run the general smoke
and live verifiers plus P2/P3/I2 on the same release. Do not relax their gates.
