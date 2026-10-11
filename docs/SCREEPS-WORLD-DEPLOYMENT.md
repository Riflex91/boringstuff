# Screeps World second-server preparation

**Status: OFFLINE PREPARATION ONLY.** The current Newbieland workflow remains the only automatic deployment. Nothing in this preparation changes the active World branch or uploads code.

## Target

- Official API: https://screeps.com/
- Local deployment profile name: `world`
- Proposed code branch: `chatgpt` (must be verified to exist and be active before any live verification)
- GitHub Actions secret: `SCREEPS_TOKEN_WORLD` (never commit or paste its value)
- Shard and owned room: **not yet identified**; do not reuse Newbieland room E8N1.

## Activation prerequisites (manual)

1. Generate an API auth token in Screeps World account settings with only the permissions required for code upload, branch inspection and verification. Store it as repository Actions secret `SCREEPS_TOKEN_WORLD`.
2. Identify the active World shard, owned room, and target code branch. Verify World API compatibility for shard-aware memory and room verification. No default shard or room is assumed.
3. Add a separate, explicitly enabled World workflow with isolated concurrency, short-lived credentials, pre-upload backup, exact-byte verification, receipt, and post-deploy live gate. It must not change Newbieland's existing deployment.
4. Perform a read-only World preflight before enabling any upload; get explicit authorization for the first live World deployment.

## Offline test

`node tools/world-deployment-profile.test.mjs`

The World profile helper has no network access and does not write files or make deployment requests. Its presence is not activation.
