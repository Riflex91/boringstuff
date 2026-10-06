import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECTED_BOT_VERSION } from './live-verification-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const configSource = fs.readFileSync(path.join(root, 'game', 'config.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(root, 'game', 'main.js'), 'utf8');
const deploySource = fs.readFileSync(path.join(here, 'deploy-live.mjs'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));

const match = configSource.match(/VERSION\s*:\s*['"]([^'"]+)['"]/);
assert.ok(match, 'config VERSION must exist');
assert.equal(match[1], '0.3.0-shadow.8-node24');
assert.equal(EXPECTED_BOT_VERSION, match[1]);
assert.equal(pkg.version, '0.3.0-shadow.8');
assert.match(mainSource, /DEPLOYMENT_MARKER/);
assert.match(mainSource, /config\.DEPLOYMENT_ID/);
assert.match(deploySource, /writeDeploymentReceipt/);
assert.match(deploySource, /DEPLOYMENT_ID/);
assert.match(deploySource, /server config does not contain deployment ID/);

console.log('release identity tests passed');