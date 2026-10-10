# Automated Screeps deployment after successful main CI

**Target:** private server `newbieland`, code branch `chatgpt`,
room `E8N1`. Never changes active branch or launches a second collector.

## One-time credential setup (manual)

Create a **GitHub Actions repository secret** named
`SCREEPS_TOKEN_NEWBIELAND`, containing an API token permitted to read
branches/code/memory and write code on the private server. Do not commit
the token or `tools/screeps.json`. Do not paste it into a chat or log.

[Repository Actions secrets settings](https://github.com/Riflex91/boringstuff/settings/secrets/actions)

The secret is not exposed to ChatGPT. The repo does not contain this
token, and the CI test workflow intentionally does not use it.
If the secret does not exist, the deployment workflow reports
`SKIP`, and **there is no deployment**.

## Automatic flow

`.github/workflows/screeps-auto-deploy.yml` runs only after
`npm test` **successfully completes on a push to `main`**.
It rejects stale tested commits if a newer `main` exists, requires
the matching activeWorld `chatgpt` target and reachable authenticated
API, confirms it can read the old code, then runs the existing
`tools/deploy-live.mjs`. That uploader writes a full backup before
upload, injects a distinct deployment ID, reads back every uploaded
module and confirms exact content equality.

The workflow waits up to 15 minutes for 100 game ticks with an exact
`DEPLOYMENT_MARKER`, persisted journal evidence, a room
`STATUS_SNAPSHOT`, positive RCL, and valid CPU/bucket status. It fails
on MAIN_FATAL/FATAL or critically low CPU events after the deployment
tick. No automated rollback is performed: automatic rollback without
confirmed old deployment state could conceal regressions or overwrite a
newer release. Every backup and deployment receipt is uploaded to the
matching workflow run's artifact list and retained for 14 days.

**Limitations:** A passing 100-tick smoke gate confirms the release
started and basic telemetry/room operation survived. It is **not proof**
that consumer rescue, construction/repair behavior, or combat improved.
Real comparative effectiveness must still be evaluated from the
Windows collector's independent historical evidence.

The same-version bot version `0.3.0-shadow.15-node24` can be deployed
from multiple Git commits. Therefore all tracking is based on the
unique deployment marker, exact uploaded module bytes and workflow-run
commit, not the VERSION field alone.

## Manual local fallback

The previously configured Windows workstation can still use:

```powershell
cd <repository-path>\tools
npm test
npm run bench:p3
npm run doctor
npm run deploy
npm run verify:smoke
npm run verify:live
```

Do not launch an additional collector if one is already running.
Use Node 24.21.0. The local Screeps API configuration is stored at
`tools/screeps.json` (ignored from the repository). The verification
commands read the existing Windows collector logs; they do not mutate
the game. GitHub deployment receipts are archived on the runner, not
copied into Windows automatically.
