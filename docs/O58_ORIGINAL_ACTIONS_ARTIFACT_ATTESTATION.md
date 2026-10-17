# O58 original Actions artifact bytes — source attestation

On 2026-10-17 the connected GitHub Actions integration downloaded the
original ZIP bytes for the exact historical artifact IDs below. The
downloaded original ZIPs were then inspected locally, **without**
executing or extracting any ZIP content into the working tree.

| Server | Run | Artifact | SHA256 of ZIP | Bytes | Original run SHA |
| --- | --- | --- | --- | --- | --- |
| world | 38808493499 | 12007967018 | 257ad662770e5b425c1f7322b5d240d8e3ca84aa76517f78d967ee29a21bb944 | 193951 | 3f14590592d30dded0b6f61ab0e301e475ed6bf3 |
| newbieland | 38848802082 | 12024822115 | 6a7b2db73798fd47a894c8741f830a97436cf9b19c7249ba74e0f81aa35cb685 | 192120 | bc43f2faf1f345e63d9bfe78b6bbaa59e5eaab0c |

GitHub reported both ZIPs unexpired during retrieval. The original
artifact expiry dates recorded in Roadmap #172 are 2026-10-29 21:26:02
UTC (World) and 2026-10-30 04:16:49 UTC (Newbieland).

Original contents reviewed without printing private game code:
- World: three files (backup 790627 bytes, diagnostics 18108 bytes,
  deployment receipt 186 bytes). 82 source modules, branch
  chatgpt-w37s79-stage, deployment ID 20261015211553693-2342.
- Newbieland: two files (backup 790619 bytes, deployment receipt
  178 bytes). 82 source modules, branch chatgpt, deployment ID
  20261016040542647-2155.

The ZIP entries passed CRC validation. These byte hashes are pinned
in tools/o58-original-artifact-integrity.mjs. O58 validates the exact
ZIP SHA256 and size, central-directory/local-file agreement, duplicate
or traversing names, decompression limits, CRC, historical entry names,
JSON schema and backup/receipt deployment-ID continuity. It also
protects the operator O57 archive command: arbitrary ZIP files that
happen to begin with PK can no longer be stored and labeled as the
historical originals.

IMPORTANT: The actual historic original ZIP contents are **not**
checked into Git and are **not** put in GitHub Actions; the independent
CI exercises synthetic ZIP fixtures plus pinned SHA256 values. The
authenticated original bytes were separately inspected during O58.
Keep the original ZIP files in a private, durable destination selected
by the operator; using O57 to create a private encrypted vault still
requires a real RSA >=3072 public key with its private key held off
runner and a writable directory outside the repository. The original
ZIPs can be encrypted by the O57 command only when they match O58 pins.
Independently replicate the encrypted vault and test private-key
recovery. The ChatGPT conversation container is **not** independent
long-term storage.

These original artifacts do NOT contain a qualifying World original
LIVE_100T_PASS for exact current Main. The World's receipt is for an
older source commit, even though game files are byte-equivalent. No
fresh canonical World proof has been created, no live server modified,
and no production deployment/release/merge authorized.

Formal release: HOLD_EXACT_PREDECESSOR_PAIR_MISSING.
