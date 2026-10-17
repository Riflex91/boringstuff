# O60 – ZIP data descriptors and physical layout integrity

Date: 2026-10-17. The O58 parser already enforces the exact downloaded
GitHub Actions ZIP SHA256 and byte length for World artifact 12007967018
and Newbieland artifact 12024822115, checks expected file names, backup
module count, deployment receipts, deflate inflation and CRC32.

## Further defect found

Both **actual downloaded original ZIPs** use the ZIP data-descriptor
flag 0x0008. For each file, the local header has zero CRC/size fields
and a **16-byte signed data descriptor** (0x08074b50, CRC32, compressed
size, uncompressed size) immediately follows compressed data.

The prior generic parser checked the central directory and decompressed
payload but **did not validate those signed descriptors**, nor enforce
that the local records were laid out without concealed prefix/gap
bytes. An altered archive could have internally inconsistent ZIP
metadata yet pass the generic structural checks. The separately pinned
SHA256 still protected the two exact original ZIPs, so this is a
defense-in-depth correction, not proof that originals were corrupted.

## Implementation

In tools/o58-original-artifact-integrity.mjs:
- Require every local-file offset to equal the next expected byte.
- For descriptor-based entries require exact signed 16-byte records,
  with CRC and both sizes matching the corresponding central entry.
- For entries without descriptors require the local CRC/size fields to
  match central values.
- Reject leading/prefix data and any gap, shadow local record or
  trailing unclaimed bytes before the central directory.
- Preserve decompression upper bounds, CRC32, path checks and
  independently pinned original ZIP SHA256 validation.

The existing O58 synthetic ZIP test generator now covers both stored
local-metadata and signed descriptor variants, with adversarial
CRC/length/signature corruption, hidden prefix and gap rejection.
A dedicated O60 regression provides an independent minimal signed ZIP
fixture. Neither test embeds historical backup code or credentials.

The genuine historical World and Newbieland ZIPs were independently
re-read from the two previously downloaded files **outside CI** and
were both accepted by the stricter parser (World: 3 entries/82 source
modules; Newbieland: 2 entries/82 source modules). CI intentionally
tests synthetic ZIPs, not the original file contents.

No cryptographic source authentication is gained by parsing ZIP alone.
No new canonical World receipt, operator-owned encrypted off-runner
durable archive or private RSA recovery-key custody was created.

**Release remains HOLD_EXACT_PREDECESSOR_PAIR_MISSING**: the historical
World 166-tick PASS belongs to commit 3f145905... rather than pinned
current Main bc43f2fa.... No server write, branch activation, spawn,
reset, GitHub writer ref mutation or merge was performed.
