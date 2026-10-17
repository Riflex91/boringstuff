import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// O63 POSIX filesystem confidentiality, complementary to cryptographic
// AEAD integrity. No key, ZIP or source bytes are ever read by this module.
// Windows access controls are a separate operator obligation: Node's
// POSIX mode bits do not certify Windows ACLs.
export const O63_PRIVATE_FILE_HOLD='O63_PRIVATE_ARCHIVE_FILE_POLICY_HOLD';
const refuse=()=>{throw new Error(O63_PRIVATE_FILE_HOLD);};
const checkout=fs.realpathSync.native(path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),'..'));
function inCheckout(p){
 const rel=path.relative(checkout,p);
 return rel===''||(!rel.startsWith('..'+path.sep)&&
   rel!=='..'&&!path.isAbsolute(rel));
}
function ensurePrivate(stat) {
 if(process.platform==='win32')return;
 if(typeof process.getuid==='function'&&stat.uid!==process.getuid())
   refuse();
 if((stat.mode&0o077)!==0)refuse();
}
export function assertPrivateArchiveDirectory(directory){
 if(typeof directory!=='string'||!path.isAbsolute(directory))refuse();
 let stat,real;
 try{stat=fs.lstatSync(directory);real=fs.realpathSync.native(directory);}
 catch{refuse();}
 if(!stat.isDirectory()||stat.isSymbolicLink()||inCheckout(real))refuse();
 ensurePrivate(stat);
 return Object.freeze({
  canonicalDirectory:real,
  posixConfidentialityVerified:process.platform!=='win32',
  windowsAclIndependentlyVerified:false,
  releaseAuthorized:false
 });
}
export function assertPrivateArchiveFiles(directory){
 const {canonicalDirectory}=assertPrivateArchiveDirectory(directory);
 // All archives contain exactly these two artifacts. Directory inventory
 // is independently enforced by the caller; this helper is about mode,
 // ownership, regular-file type and final-component symlinks.
 for(const name of ['archive.enc','archive-manifest.json']){
  const file=path.join(canonicalDirectory,name);
  let stat,real;
  try{stat=fs.lstatSync(file);real=fs.realpathSync.native(file);}
  catch{refuse();}
  if(!stat.isFile()||stat.isSymbolicLink()||
     real!==file||stat.size<=0||stat.size>33*1024*1024)refuse();
  ensurePrivate(stat);
 }
 return Object.freeze({
  archivePrivateOnPosix:process.platform!=='win32',
  windowsAclIndependentlyVerified:false,releaseAuthorized:false
 });
}
