import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  deploymentReceiptPath,
  readDeploymentReceipt,
  writeDeploymentReceipt
} from './deployment-receipt.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screeps-deploy-receipt-'));
try {
  const written = writeDeploymentReceipt({
    logDir: dir,
    server: 'newbieland',
    branch: 'chatgpt',
    version: '0.2.20-node18',
    deploymentId: 'deploy-new'
  });

  assert.equal(written.file, deploymentReceiptPath(dir, 'newbieland', 'chatgpt'));
  assert.equal(written.receipt.deploymentId, 'deploy-new');

  const loaded = readDeploymentReceipt({
    logDir: dir,
    server: 'newbieland',
    branch: 'chatgpt',
    version: '0.2.20-node18'
  });
  assert.equal(loaded.receipt.deploymentId, 'deploy-new');

  assert.equal(readDeploymentReceipt({
    logDir: dir,
    server: 'newbieland',
    branch: 'chatgpt',
    version: '0.2.19-node18'
  }), null);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('deployment receipt tests passed');
