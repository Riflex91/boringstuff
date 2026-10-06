import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mainSource = fs.readFileSync(path.resolve(here, '../game/main.js'), 'utf8');

assert.match(
  mainSource,
  /const\s+colonyState\s*=\s*require\(['"]colony\.state['"]\);/,
  'main.js must import colony.state before STATUS_SNAPSHOT uses colonyState.telemetrySummary()'
);
assert.match(
  mainSource,
  /colonyState\.telemetrySummary\(state\.colonyState\)/,
  'STATUS_SNAPSHOT must use the compact colonyState telemetry summary'
);

console.log('main runtime wiring tests passed');
