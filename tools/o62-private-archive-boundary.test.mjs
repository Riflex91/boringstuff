import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {assertPrivateArchiveParent,readPinnedArchiveInput,
 O62_PRIVATE_ARCHIVE_FS_HOLD}
 from './o62-private-archive-fs-boundary.mjs';
import {smokeOriginalPairOffline,O62_ORIGINAL_PAIR_SMOKE_HOLD}
 from './o62-local-original-pair-smoke.mjs';
import {archivePinnedRoadmapOriginals}
 from './o57-archive-historical-originals.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'o62-private-fs-test-'));
const hold=new RegExp(O62_PRIVATE_ARCHIVE_FS_HOLD);
try{
 if(process.platform!=='win32')fs.chmodSync(tmp,0o700);
 assert.equal(assertPrivateArchiveParent(tmp),fs.realpathSync.native(tmp));
 for(const unsafe of [
   root,path.join(root,'tools'),path.join(root,'docs'),
   '.',path.relative(process.cwd(),tmp)
 ]){
  assert.throws(()=>assertPrivateArchiveParent(unsafe),hold,
   'Refuse repo/internal/relative archive destination '+unsafe);
 }
 // The O57 check previously used path.relative() against the literal
 // path only. A child of an OUTSIDE symlinked ancestor resolved inside
 // the checkout and could make a Git-internal encrypted archive.
 if(process.platform!=='win32'){
  const fakeOutside=path.join(tmp,'alias-inside-repo');
  fs.symlinkSync(root,fakeOutside,'dir');
  assert.throws(()=>assertPrivateArchiveParent(
   path.join(fakeOutside,'tools')),hold);
  assert.throws(()=>assertPrivateArchiveParent(fakeOutside),hold);
  const symlinkToSafe=path.join(tmp,'alias-outside');
  fs.symlinkSync(tmp,symlinkToSafe,'dir');
  assert.throws(()=>assertPrivateArchiveParent(symlinkToSafe),hold);
 }
 if(process.platform!=='win32'){
  fs.chmodSync(tmp,0o755);
  assert.throws(()=>assertPrivateArchiveParent(tmp),hold,
   'Publicly searchable archive parent is not private');
  fs.chmodSync(tmp,0o700);
  fs.chmodSync(tmp,0o770);
  assert.throws(()=>assertPrivateArchiveParent(tmp),hold,
   'Group-writable archive parent enables destination replacement');
  fs.chmodSync(tmp,0o700);
 }
 const fake=Buffer.from('PK\x03\x04O62_NOT_A_REAL_GITHUB_ARCHIVE');
 const sample=path.join(tmp,'fixture.zip');
 fs.writeFileSync(sample,fake,{mode:0o600});
 assert.deepEqual(readPinnedArchiveInput(sample,1024),fake,
  'Read the same pinned file descriptor rather than reopening');
 const bad=path.join(tmp,'not-zip');
 fs.writeFileSync(bad,'INVALID ZIP');
 assert.throws(()=>readPinnedArchiveInput(bad,1024),hold);
 assert.throws(()=>readPinnedArchiveInput(sample,3),hold);
 assert.throws(()=>readPinnedArchiveInput(sample,4),hold);
 assert.throws(()=>readPinnedArchiveInput(sample,32*1024*1024+1),hold);
 if(process.platform!=='win32'){
  const sym=path.join(tmp,'symlink.zip');
  fs.symlinkSync(sample,sym);
  assert.throws(()=>readPinnedArchiveInput(sym,1024),hold);
  const inRepoFile=path.join(root,'tools','o57-archive-historical-originals.mjs');
  assert.throws(()=>readPinnedArchiveInput(inRepoFile,1024*1024),hold);
 }
 // The archiver must fail BEFORE writing when the parent is unsafe;
 // no temporary/archive directories are allowed inside Git.
 const inRepo=path.join(root,'tools');
 assert.throws(()=>archivePinnedRoadmapOriginals([
  '--output-parent',inRepo,'--world-zip',sample,
  '--newbieland-zip',sample,
  '--public-key',sample
 ]),hold);
 assert.equal(fs.existsSync(path.join(inRepo,'o57-original-evidence-v1')),false);
 const before=fs.readdirSync(os.tmpdir()).filter(n=>
   n.startsWith('o62-real-original-e2e-')).sort();
 assert.throws(()=>smokeOriginalPairOffline({
  worldZip:sample,newbielandZip:sample
 }),new RegExp(O62_ORIGINAL_PAIR_SMOKE_HOLD));
 const after=fs.readdirSync(os.tmpdir()).filter(n=>
   n.startsWith('o62-real-original-e2e-')).sort();
 assert.deepEqual(after,before,'Temporary RSA key and archives must be removed');
 const script=fileURLToPath(new URL('./o62-local-original-pair-smoke.mjs',
  import.meta.url));
 const child=spawnSync(process.execPath,[script,
  '--world-zip',sample,'--newbieland-zip',sample],
  {encoding:'utf8',timeout:12000,
   env:{PATH:process.env.PATH||''}});
 assert.equal(child.status,2,child.stderr);
 assert.equal(child.stdout,'');
 assert.match(child.stderr,new RegExp(O62_ORIGINAL_PAIR_SMOKE_HOLD));
 assert.equal(child.stderr.includes('PRIVATE KEY'),false);
 console.log('O62 canonical external-only private path, secret parent mode, fd-nofollow ZIP input, synthetic original rejection and ephemeral temp cleanup: PASS');
}finally{
 fs.rmSync(tmp,{recursive:true,force:true});
}
