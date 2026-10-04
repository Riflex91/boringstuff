import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_VERIFICATION_LOG_DIR = String.raw`C:\\Users\\hansi\\AppData\\Local\\Screeps\\scripts\\screeps_newbieland_net___21025\\chatgpt\\logs`;

function safePart(value) {
  return String(value || 'default').replace(/[^a-zA-Z0-9._-]+/g, '_');
}

export function deploymentReceiptPath(logDir, server, branch) {
  return path.join(
    logDir,
    `deployment-receipt-${safePart(server)}-${safePart(branch)}.json`
  );
}

export function writeDeploymentReceipt({ logDir, server, branch, version, deploymentId }) {
  fs.mkdirSync(logDir, { recursive: true });
  const receipt = {
    createdAt: new Date().toISOString(),
    server,
    branch,
    version,
    deploymentId
  };
  const file = deploymentReceiptPath(logDir, server, branch);
  fs.writeFileSync(file, JSON.stringify(receipt, null, 2) + '\n', 'utf8');
  return { file, receipt };
}

export function readDeploymentReceipt({ logDir, server, branch, version }) {
  const file = deploymentReceiptPath(logDir, server, branch);
  if (!fs.existsSync(file)) return null;
  try {
    const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!receipt || typeof receipt !== 'object') return null;
    if (receipt.server !== server || receipt.branch !== branch) return null;
    if (version && receipt.version !== version) return null;
    if (!receipt.deploymentId) return null;
    return { file, receipt };
  } catch {
    return null;
  }
}
