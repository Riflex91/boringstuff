# First World colony: manual one-shot placement and conditional activation

**Exact user authorization:** the operator selected `shard0 / W37N11 / (12,13)`, spawn name `Spawn1`, accepted the nearby foreign RCL8 presence in `W35N11`, and expressly authorized the World `chatgpt` bot to be activated automatically **after** the exact owned spawn is placed and verified. Permission does not allow picking another tile or room.

## Preconditions

- This workflow is available only through **GitHub Actions → Screeps World first spawn W37N11 and post-verification activation (manual)**. It never runs on push or PR and requires the exact current tested main SHA.
- The exact current main must pass Node24 `npm test`, paired P3 benchmark, and **an independent already completed Newbieland run with a real `LIVE_100T_PASS` covering at least 100 observed ticks**. Provide that actual run ID; code checks GitHub job logs and the commit SHA.
- World account must still be `empty`, `W37N11` normal, unowned/unreserved, exactly 2 sources, and tile `(12,13)` plain and free. The inactive World `chatgpt` branch must exactly match all checked-out `game/*.js` and `default` must be active.
- All 24 surrounding 5×5 rooms must be confirmed by live GET checks; no other foreign ownership or reservation is allowed within that radius. Foreign `W35N11` RCL8 is the *specific* accepted rival. An changed threat blocks placement.
- Screeps spawn name `Spawn1` must pass the authoritative name validation endpoint. That check is a non-placement POST; it does not place anything.

## Manual inputs

- `expected_main_sha`: current exact 40-character main commit.
- `newbieland_live_run_id`: completed live success for that exact commit, not a prior PR or unrelated main run.
- `placement_confirmation`: `PLACE_W37N11_12_13`
- `rival_confirmation`: `ACCEPT_W35N11_RCL8`
- `activation_confirmation`: `ACTIVATE_W37N11_AFTER_VERIFIED_SPAWN`

## Exactly ordered operations

1. Check user confirmations, exact current main, offline full tests, P3 benchmark and authenticated GitHub live evidence.
2. Independently recheck the World fixed site, complete 24-room rival ring, exact inactive 56-module code and name availability.
3. Recheck World state and the inactive `chatgpt` branch immediately before placement.
4. Send **one** `POST /api/game/place-spawn` pinned to `shard0 W37N11 (12,13) Spawn1`. Never retry automatically on error, timeout or uncertainty.
5. GET-read back the precise owned Spawn1 and both branch states. Persist the spawn result **before** attempting activation.
6. Again GET-verify spawn ownership, exact unmodified `chatgpt` code and current `default` activation. Then send **one** `POST /api/user/set-active-branch` to activate `chatgpt` for World.
7. GET-confirm the same owned spawn and only `chatgpt` marked `activeWorld`. Save a separate activation receipt. Never re-attempt activation on uncertain results.

The workflow uses World credentials only, and does not alter the Newbieland bot. A partially completed attempt requires reviewing its artifact and fresh GET state before any next run. After activation, the normal World release/deployment pipeline and live operational monitoring are a **separate** gated process. Do not run the first-spawn workflow twice.

**Rival risk remains real:** a foreign RCL8 colony two rooms away can attack, even when surrounding rooms are currently unowned. No live preflight proves military safety or future survival.
