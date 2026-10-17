#!/usr/bin/env python3
"""Strict read-only ZIP receipt extractor for O34. Never prints a deployment ID.

This parser receives a GitHub Actions artifact ZIP via stdin, reads only the
single expected receipt JSON, and emits bounded nonsecret metadata + SHA-256
of the original ID. Its caller compares that digest to the GitHub job log.
"""
import hashlib
import io
import json
import re
import sys
import zipfile
from pathlib import PurePosixPath


def inspect(zip_bytes, server, branch):
    if len(zip_bytes) < 40 or len(zip_bytes) > 24_000_000:
        raise ValueError("ARTIFACT_ZIP_SIZE_UNVERIFIED")
    expected = f"deployment-receipt-{server}-{branch}.json"
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        entries = archive.infolist()
        if not 1 <= len(entries) <= 80:
            raise ValueError("ARTIFACT_ZIP_ENTRY_COUNT_UNVERIFIED")
        if any(
            e.file_size > 24_000_000 or
            e.filename.startswith("/") or
            "\\" in e.filename or
            ".." in PurePosixPath(e.filename).parts or
            e.flag_bits & 1
            for e in entries
        ):
            raise ValueError("ARTIFACT_ZIP_UNTRUSTED_ENTRY")
        found = [e for e in entries if not e.is_dir() and
                 PurePosixPath(e.filename).name == expected]
        if len(found) != 1 or found[0].file_size > 16384:
            raise ValueError("EXACT_RECEIPT_NOT_PRESENT_ONCE")
        data = archive.read(found[0])
    if len(data) > 16384:
        raise ValueError("RECEIPT_DATA_UNBOUNDED")
    receipt = json.loads(data)
    if not isinstance(receipt, dict):
        raise ValueError("RECEIPT_NOT_JSON_OBJECT")
    deploy_id = receipt.get("deploymentId")
    created = receipt.get("createdAt")
    version = receipt.get("version")
    if (receipt.get("server") != server or receipt.get("branch") != branch or
        not isinstance(deploy_id, str) or
        not re.fullmatch(r"[0-9]{17}-[0-9]{1,10}", deploy_id) or
        not isinstance(version, str) or not 1 <= len(version) <= 100 or
        not isinstance(created, str) or len(created) > 40):
        raise ValueError("RECEIPT_METADATA_UNVERIFIED")
    return {
        "server": server, "branch": branch, "version": version,
        "createdAt": created,
        "idDigest": hashlib.sha256(deploy_id.encode("utf8")).hexdigest()
    }


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("world", "newbieland"):
        raise ValueError("EXACT_SERVER_BRANCH_REQUIRED")
    server, branch = sys.argv[1:]
    if branch != ("chatgpt-w37s79-stage" if server == "world" else "chatgpt"):
        raise ValueError("ORIGINAL_BRANCH_UNVERIFIED")
    data = sys.stdin.buffer.read(24_000_001)
    print(json.dumps(inspect(data, server, branch), separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Never print raw ZIP, credential material, source modules or IDs.
        print("O34_RECEIPT_ARCHIVE_UNVERIFIED", file=sys.stderr)
        sys.exit(2)
