"""Adversarial offline regressions for archived deployment receipts."""
import importlib.util
import io
import json
import os
from pathlib import Path
import zipfile

path = Path(__file__).with_name("o34-artifact-receipt.py")
spec = importlib.util.spec_from_file_location("o34_artifact_receipt", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

secret_id = "20261016040545000-12345"
def create(files):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in files:
            z.writestr(name, data)
    return stream.getvalue()

def receipt(server="newbieland", branch="chatgpt", **changes):
    record = {
        "createdAt": "2026-10-16T04:05:45.400Z",
        "server": server,
        "branch": branch,
        "version": "0.3.0-shadow.15-node24",
        "deploymentId": secret_id
    }
    record.update(changes)
    return json.dumps(record).encode("utf8")

filename = "deployment-receipt-newbieland-chatgpt.json"
valid = create([(filename, receipt())])
report = module.inspect(valid, "newbieland", "chatgpt")
assert report["server"] == "newbieland"
assert len(report["idDigest"]) == 64
assert secret_id not in json.dumps(report)
assert report["createdAt"] == "2026-10-16T04:05:45.400Z"

world_file = "deployment-receipt-world-chatgpt-w37s79-stage.json"
world = create([("nested/"+world_file,
                 receipt("world", "chatgpt-w37s79-stage"))])
assert module.inspect(world, "world", "chatgpt-w37s79-stage")["server"] == "world"

bad = [
    b"", b"no-zip-here",
    create([]),
    create([(filename, receipt()), (filename, receipt())]),
    create([("../"+filename, receipt())]),
    create([(filename, receipt(branch="other"))]),
    create([(filename, receipt(deploymentId="unverified-id"))]),
    create([(filename, receipt(createdAt=None))]),
    create([(filename, receipt(server="world"))]),
    create([(filename, b"not JSON")]),
    create([(filename, b"x"*16385)])
]
for item in bad:
    try:
        module.inspect(item, "newbieland", "chatgpt")
        raise AssertionError("unsafe archive unexpectedly accepted")
    except (ValueError, zipfile.BadZipFile, json.JSONDecodeError):
        pass

print("O34 bounded original receipt ZIP integrity and no-secret regressions: PASS")
