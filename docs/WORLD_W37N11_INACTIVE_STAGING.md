# World shard0 W37N11 – inactive code staging (operator runbook)

**World target:** `shard0 / W37N11`, initial spawn candidate `(12,13)` / `Spawn1`. Decision in [Issue #172](https://github.com/Riflex91/boringstuff/issues/172).

## What is authorized by this runbook

Only a manually gated upload of current tested `game/*.js` into an **inactive** World code branch `chatgpt`. It does not place a spawn, activate that World branch, or switch Newbieland. Do not run the stage action twice: the flow is intentionally create-once and fails closed if `chatgpt` already exists.

## Preconditions and evidence

1. GitHub Actions *Screeps World W37N11 targeted preflight (GET only)* has succeeded on the newest current `main` SHA with **`siteChecksPass:true`**, **`inactiveStageGate.preconditionsPass:true`**, zero gate failures, `worldStatus:empty` and `W37N11 (12,13)` free. The read-only World preflight never authorizes placement, even on success.
2. Known rival `W35N11` is a foreign RCL8 colony nearby (two rooms), confirmed in fresh evidence. Risk review remains outstanding; do not reinterpret staging as acceptance of that risk.
3. The exact current `main` SHA passes the full Node **24.21.0** `npm test` and `npm run bench:p3` checks, plus an exact-main Newbieland `LIVE_100T_PASS` with >=100 observed ticks.
4. The World `chatgpt` branch does **not** exist, the World `default` branch is active, and the `default` code backup is readable. These are checked again by the stage process.
5. The GitHub Actions secret `SCREEPS_TOKEN_WORLD` must be configured (never copy credentials to a GitHub issue, chat, output log, or workflow input).

## Trigger the existing manual staging workflow

1. Open [Screeps World code preparation (inactive branch only)](https://github.com/Riflex91/boringstuff/actions/workflows/screeps-world-bootstrap.yml).
2. Choose **Run workflow**, branch **main**.
3. Set `expected_main_sha` to the exact 40-character latest `main` SHA verified above (not an older SHA, do not guess or copy one from this static document).
4. Enter `STAGE_WORLD_CODE` in the `approval` field.
5. Execute only after reviewing the preconditions. Successful job log MUST contain `WORLD_CODE_STAGED` with `activeWorld:default`, `exactByteMatch:true`, `spawnPlaced:false` and an uploaded `world-code-stage-receipt.json`.

**Stop immediately** if the workflow fails any gate. Do not bypass the checks with local manual API uploads or enable another World branch.

## Separate future steps (not performed by this workflow)

- Obtain and explicitly review fresh rival/ownership/threat evidence, broader than just two known rooms.
- Verify the intended World spawn name and exact tile against the World API immediately before placement.
- Obtain separate operator authorization for the irreversible first spawn at `shard0/W37N11 (12,13)` using an independently gated placement procedure.
- Only after a real owned World spawn exists, use the separate manual `DEPLOY_WORLD` workflow with exact-current-SHA checks, code backup/readback and >=100-tick live acceptance.

**Current operator decision:** TARGET_SELECTED. **No placement authority and no deployment authority.**
