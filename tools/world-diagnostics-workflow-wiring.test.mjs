import assert from 'node:assert/strict';
import fs from 'node:fs';

const yaml=fs.readFileSync(new URL(
  '../.github/workflows/screeps-world-next-runtime-diagnostics.yml',
  import.meta.url),'utf8');
for(const path of [
  'tools/world-next-runtime-diagnostics.mjs',
  'tools/world-next-runtime-diagnostics.test.mjs',
  'tools/world-recovery-evidence.mjs',
  'tools/world-recovery-evidence.test.mjs'
])assert.ok(yaml.includes('      - '+path),
  'GET-only World workflow must run when exact observed evidence changes: '+path);
assert.match(yaml,/node world-next-runtime-diagnostics\.test\.mjs/);
assert.match(yaml,/node world-recovery-evidence\.test\.mjs/);
assert.match(yaml,/node world-next-runtime-diagnostics\.mjs/);
assert.match(yaml,/permissions:\s*\n  contents: read/);
assert.match(yaml,/workflow_dispatch:/);
assert.match(yaml,/concurrency:/);
assert.match(yaml,/ref: main/);
assert.doesNotMatch(yaml,/\/api\/user\/code|\/api\/game\/create-construction-site|\/api\/user\/activate/);
console.log('GET-only World expansion/Spawn evidence workflow path triggers and fixture tests PASS');
