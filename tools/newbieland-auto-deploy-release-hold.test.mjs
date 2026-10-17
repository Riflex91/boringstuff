import assert from 'node:assert/strict';
import fs from 'node:fs';
const wf=fs.readFileSync(
  new URL('../.github/workflows/screeps-auto-deploy.yml',import.meta.url),'utf8'
);
const ci=wf.indexOf('Prevent deploying stale commits over newer main');
const hold=wf.indexOf('Block Newbieland upload without paired canonical predecessor LIVE_100T_PASS');
const cfg=wf.indexOf('Create short-lived HTTPS Screeps API config');
const upload=wf.indexOf('Upload exact tested game code and verify every module');
const verify=wf.indexOf('Verify active 100-tick release and fatal/CPU guards');
assert.ok(ci>=0&&hold>ci&&cfg>hold&&upload>cfg&&verify>upload,
  'release gate must execute before config creation and code upload');
const guarded=wf.slice(hold,cfg);
assert.match(guarded,/NEWBIELAND_AUTO_DEPLOY_RELEASE_HOLD/);
assert.match(guarded,/if: steps.credentials.outputs.present == 'true'/);
assert.match(guarded,/exit 1/);
assert.doesNotMatch(guarded,/continue-on-error: true/);
assert.ok(wf.includes('github.event.workflow_run.head_sha'),
  'workflow must pin exact CI-tested predecessor code');
assert.ok(wf.includes('git rev-parse origin/main'),
  'stale successful CI cannot authorize a newer Main');
assert.equal(wf.match(/run: node deploy-live\.mjs/g)?.length,1);
assert.equal(wf.match(/Block Newbieland upload without paired canonical predecessor LIVE_100T_PASS/g)?.length,1);
assert.match(wf,/^permissions:\n  contents: read/m);
console.log('O33 Newbieland release HOLD occurs before automatic code upload: PASS');
