# Automated Screeps deployment after successful main CI

**Target:** private server `newbieland`, code branch `chatgpt`,
room `E8N1`. Never changes active branch or launches a second collector.

## One-time browser setup (no local scripts)

The private server exposes a Steam-linked API password form over HTTPS,
at https://screeps.newbieland.net/authmod/password/ .
Use **Sign in with Steam** there, and choose a **new password specifically
for the private server API**. It is not your Steam account password.

In https://github.com/Riflex91/boringstuff/settings/secrets/actions
create the following **two repository Actions secrets**:

- `SCREEPS_USERNAME_NEWBIELAND`: your Screeps player username on
  newbieland (not your Steam password or necessarily your Steam email).
- `SCREEPS_PASSWORD_NEWBIELAND`: the new private-server API password
  you set with the Steam-linked form.

Alternatively, the already-supported single secret
`SCREEPS_TOKEN_NEWBIELAND` can contain a persistent Screeps API token.
The token takes precedence if both methods are configured.

Do **not** commit credentials, save them in the public repository,
send them through ChatGPT, or copy your actual Steam account password
into any API-secret field. Neither method requires installing a local
script or providing ChatGPT with a password.

**Verified public endpoints (without logging in):**

- `https://screeps.newbieland.net/authmod/password/` responds with the
  Steam-linked password form.
- `https://screeps.newbieland.net/api/game/world-size` responds with a
  valid Screeps API JSON world-size object.

The deployment workflow uses **only**
`https://screeps.newbieland.net/` (TLS, default port 443), never the
original plaintext `http://screeps.newbieland.net:21025/` endpoint.
The private-server authentication flow is `POST /api/auth/signin`
with username in the `email` parameter and the separately set
API password, followed by token headers on authenticated API calls.

Credentials are made into a temporary per-run config file on the
GitHub runner with permissions 0600, and are not printed or included
in artifacts. If neither credential method is configured, the workflow
marks `DEPLOYMENT_SKIPPED`; no upload or live verification is performed.

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

## Live proof and operational boundaries

GitHub CI success is not a game deployment. Only a completed upload and
matching 100-tick runtime receipt establish basic live activation.
The GitHub Actions job intentionally skips without secrets and explains
this in its job summary. Steam does not need to remain running for the
HTTPS API deployment flow after browser-based password setup.

No local PowerShell script, downloadable ZIP, or direct ChatGPT access
to the user's Windows machine is required. The Windows collector is
separate from the GitHub-hosted smoke check, and this workflow never
reconfigures or restarts it.
