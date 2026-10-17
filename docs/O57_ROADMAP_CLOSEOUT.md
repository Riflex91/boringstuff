# O57 Roadmap-Closeout — offline implementation versus external blockers

Scope: OFFLINE / REVIEW ONLY, stacked on O56 PR #403. Main pinned to
bc43f2faf1f345e63d9bfe78b6bbaa59e5eaab0c. A green Node24/P3 test
is not evidence that a canonical production LIVE_100T_PASS took place.

## Developed and tested in O57
1. Private retention: tools/o57-archive-historical-originals.mjs takes two
   already-downloaded Actions artifact ZIPs and an operator RSA 3072+ PUBLIC
   key, encrypts each with AES-256-GCM and wraps the key using RSA-OAEP/SHA256.
   It writes exclusive private encrypted output, hashes and provenance
   manifests, and supports offline private-key restoration. Both ciphertexts
   are staged before publishing the output directory. It does not fetch
   artifacts, publish secrets, archive to a cloud location or authorize release.
2. Historical source pin:
   World run 38808493499, artifact 12007967018, prior SHA
   3f14590592d30dded0b6f61ab0e301e475ed6bf3,
   expiry 2026-10-29 21:26:02 UTC;
   Newbieland run 38848802082, artifact 12024822115,
   exact current Main SHA, expiry 2026-10-30 04:16:49 UTC.
3. tools/o57-roadmap-release-closeout.mjs: fail-closed, review-only ledger
   for SHA-exact paired proofs, read-only World, remote backup, separately
   held recovery key, single writer, private original archive, reviews and
   specific operator approval. It ALWAYS returns releaseAuthorized:false.
4. tools/o57-world-writer-resolution-review.mjs: monotonic incident record
   hashes, owner drift and uncertain POST decision holds. Never calls
   GitHub ref DELETE; O45's non-atomic lock deletion remains disabled.
5. Incident no-write assessor: flags World account/Spawn gaps and
   Newbieland E8N1 spawn-job/defender observations. Never cancels spawns,
   force-spawns defenders, changes in-game state or resets World.
6. Full Node24 and exact P3 secretless CI; pinned original Main/game equality
   check. Offline cryptography uses synthetic keys and synthetic ZIP fixtures.

## Archive instructions (operator action, not automatic)

Before their October 29/30 expiry times, download the original ZIP
artifacts from these exact historical GitHub runs:
World https://github.com/Riflex91/boringstuff/actions/runs/38808493499
Newbieland https://github.com/Riflex91/boringstuff/actions/runs/38848802082

Supply an RSA 3072+ PUBLIC key and keep its private counterpart OFF
GitHub Actions, source control, runner logs and shared machines.
Create a private folder OUTSIDE the Git checkout, for example
C:\PrivateScreepsEvidence. Windows PowerShell example:

node .\tools\o57-archive-historical-originals.mjs --output-parent C:\PrivateScreepsEvidence --world-zip C:\PrivateDownloads\world-original.zip --newbieland-zip C:\PrivateDownloads\newb-original.zip --public-key C:\PrivateKeys\archive-recipient.pub.pem

Output: private folder o57-original-evidence-v1 with encrypted world
and newbieland directories. Retain the original download separately,
copy ciphertext to an independently controlled private durable store,
validate archive hashes and test offline decryption with the operator's
private key. The tool does NOT authenticate the original receipt or
guarantee durable remote storage. ZIP magic and encryption alone are NOT
original Actions run/job authenticity.

## Still blocked by real-world inputs / human approvals

1. World exact-current-Main canonical original >=100 game-tick PASS is
   absent. The historical World 166-tick run is on an older different
   commit despite byte-identical game modules. Newbieland current-Main
   131-tick historical original PASS is valid. Strict SHA requirement
   has not been waived. A new World provenance-generating deployment
   requires a separately authorized and reviewed production executor.
2. O43 recoverable escrow has only been tested with synthetic fixtures.
   External operator-controlled RSA private-key custody, independently
   retained encrypted remote backup and verified restoration on actual
   original server modules are still not established. Real World writes
   remain hard-HOLD and require separate exact-specific approval.
3. The O44 fixed GitHub ref serializes only cooperating clients.
   REST cannot compare-and-delete safely; O45 disables all ref release.
   A reviewed atomic cleanup strategy and noncooperating-writer strategy
   remain unresolved. The new review module does not unlock anything.
4. O56 GitHub log redirect retrieval was exercised only with fake fetch.
   True source artifacts, CDN compatibility and separate durable private
   archive location need human-selected storage and authenticated
   read-only external checks before October 29/30.
5. Require exact same SHA on both servers, genuine >=100 game ticks,
   CPU/bucket/fatal gates, exact-head Node24/P3, clean reviews/behind0.
   Then merge ONE candidate PR at a time and validate new Main.
6. Incident #367 World historical loss and #369 E8N1 reported persistent
   spawnBusy/0 defenders still require fresh synchronized GET/in-game
   observations. Do not claim stale logs prove a current incident,
   invoke cancel(), respawn, force-spawn or override parent veto.

Status: HOLD_EXACT_PREDECESSOR_PAIR_MISSING. No real World POST, code
upload, spawn placement, branch activation, reset, respawn, GitHub ref
creation/deletion, Main merge or fabricated receipt is performed here.
