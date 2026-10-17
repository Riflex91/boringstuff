# O59 — independent original GitHub deploy-job witness review

On **2026-10-17**, the actual original GitHub Actions job metadata and decoded job logs were fetched **read-only**, alongside the actual ZIP bytes retrieved in O58. Full historical logs (potentially sensitive) and artifact ZIPs are not committed to the repository.

| | World | Newbieland |
|---|---|---|
| Run | 38808493499 | 38848802082 |
| Successful deploy job | 116675425473 | 116805212652 |
| Historical commit | 3f14590592d30dded0b6f61ab0e301e475ed6bf3 | bc43f2faf1f345e63d9bfe78b6bbaa59e5eaab0c |
| Deployment ID | 20261015211553693-2342 | 20261016040542647-2155 |
| Artifact ID | 12007967018 | 12024822115 |
| Original ZIP SHA256 | 257ad662770e5b425c1f7322b5d240d8e3ca84aa76517f78d967ee29a21bb944 | 6a7b2db73798fd47a894c8741f830a97436cf9b19c7249ba74e0f81aa35cb685 |
| Actual LIVE_100T_PASS ticks | **166** | **131** |
| Deployment tick | 78327634 | 3956969 |
| Snapshot tick | 78327800 | 3957100 |
| CPU snapshots | 2 | 2 |
| Max sampled CPU | 12.445 | 13.637 |
| Minimum bucket | 10000 | 10000 |
| Deployed branch | chatgpt-w37s79-stage | chatgpt |
| Matches pinned current Main SHA? | **NO** | **YES** |

Original GitHub Actions runs:
- World: https://github.com/Riflex91/boringstuff/actions/runs/38808493499
- Newbieland: https://github.com/Riflex91/boringstuff/actions/runs/38848802082
- Original byte-check details: [O58](./O58_ORIGINAL_ACTIONS_ARTIFACT_ATTESTATION.md)

## Actual independent observations

Both GitHub deploy jobs completed with success. The full original job logs contain one timestamped LIVE_100T_PASS JSON marker each. The marker's snapshot tick minus deployment tick equals the observed tick count. Both record a server-side deployment verification before the marker and a later actions/upload-artifact SHA256 digest followed by successful finalization with the corresponding historical artifact ID. These original uploaded-artifact ZIP hashes are **exactly identical** to the SHA256 values of the actual downloaded ZIP bytes checked in O58, and those ZIPs' backup and deployment receipt share the correct deployment IDs.

This establishes a stronger historical provenance chain than assuming PASS from a workflow conclusion or trusting a hand-written release summary. It does NOT establish a new exact-Main World pass.

## O59 code and risk boundaries

New tools/o59-historical-original-live-log-witness.mjs structurally checks the precise historic run/job IDs, run SHA, artifact metadata, success status, server and branch, 82 modules, deploy ID, tick count and CPU/bucket samples, sequence of deployment verification, PASS marker, artifact upload digest and finalized artifact ID. Duplicate/missing or swapped markers and altered logs are rejected. Original bytes/logs are not shipped into Node24 Actions: test fixtures are synthetic reconstructions only.

The validator receives caller-provided text and metadata and **does not itself authenticate the input source**. Its outputs explicitly set originalJobSourceAuthenticatedByThisFunction:false and releaseAuthorized:false. The historical source claims in this report are instead grounded in the separate authenticated GitHub read-only connector inspection.

**World's original run was on commit 3f145905..., not pinned Main bc43f2fa...** despite identical gameplay module bytes. The Newbieland 131-tick historical pass is on the current Main. The two historical successes cannot be treated as one exact-SHA canonical pair. A future new World canonical witness still requires an independently approved/secure process; no mutation or relabeling of original data is authorized.

The exact-Main World receipt, independently controlled durable encrypted archive/storage and private recovery-key custody, reviewed World at-most-once write executor and global writer reconciliation are still not established. Neither a successful static check nor a historical source citation grants permission to upload, respawn, place a spawn, activate a branch, delete Git refs or merge.

**Release: HOLD_EXACT_PREDECESSOR_PAIR_MISSING.**
