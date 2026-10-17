import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {archivePinnedRoadmapOriginals} from './o57-archive-historical-originals.mjs';

// O58 changed the production archival CLI to accept only the exact two
// cryptographically pinned, authenticated original GitHub ZIP byte streams.
// Synthetic ZIPs must now HOLD, instead of being mislabeled as originals.
// Positive synthetic encryption/decryption remains covered by
// o57-private-roadmap-evidence-vault.test.mjs.
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'o58-originals-no-spoof-'));
try{
 const keys=crypto.generateKeyPairSync('rsa',{
  modulusLength:3072,
  publicKeyEncoding:{format:'pem',type:'spki'},
  privateKeyEncoding:{format:'pem',type:'pkcs8'}
 });
 const publicFile=path.join(tmp,'recipient.pub.pem');
 fs.writeFileSync(publicFile,keys.publicKey,{mode:0o600});
 const spoofZip=Buffer.from([0x50,0x4b,0x03,0x04,1,2,3,4]);
 const world=path.join(tmp,'synthetic-world.zip');
 const newb=path.join(tmp,'synthetic-newb.zip');
 fs.writeFileSync(world,spoofZip);fs.writeFileSync(newb,spoofZip);
 const args=['--output-parent',tmp,'--world-zip',world,
   '--newbieland-zip',newb,'--public-key',publicFile];
 assert.throws(()=>archivePinnedRoadmapOriginals(args),
   /O58_ORIGINAL_ARCHIVE_HOLD/);
 assert.equal(fs.existsSync(path.join(tmp,'o57-original-evidence-v1')),false);
 const other=path.join(tmp,'another');fs.mkdirSync(other);
 fs.writeFileSync(newb,Buffer.from('NOT_ZIP'));
 assert.throws(()=>archivePinnedRoadmapOriginals([
   '--output-parent',other,'--world-zip',world,
   '--newbieland-zip',newb,'--public-key',publicFile
 ]),/O57_ARCHIVE_ORIGINALS_HOLD/);
 assert.deepEqual(fs.readdirSync(other),[]);
 assert.throws(()=>archivePinnedRoadmapOriginals([
   ...args,'--force','DANGEROUS'
 ]),/O57_ARCHIVE_ORIGINALS_HOLD/);
 console.log('O58 operator original archive CLI refuses unlabeled or spoofed ZIP bytes before any destination write: PASS');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
