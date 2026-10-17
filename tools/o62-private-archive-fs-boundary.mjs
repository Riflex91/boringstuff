import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// O62: the old archiver tested only path.relative(repo, userInput).
// An apparent directory outside Git may contain a symlinked parent
// that canonically resolves inside the checkout. Fail closed before
// creating an archive. Parent ownership and mode protect against other
// local users racing with the stage/rename operation; processes using
// the SAME UID still require operator coordination.
export const O62_PRIVATE_ARCHIVE_FS_HOLD='O62_PRIVATE_ARCHIVE_FS_HOLD';
const deny=()=>{throw new Error(O62_PRIVATE_ARCHIVE_FS_HOLD);};
const checkout=fs.realpathSync.native(
 path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
function insideRepo(canonical) {
 const rel=path.relative(checkout,canonical);
 return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&
  !path.isAbsolute(rel));
}
export function assertPrivateArchiveParent(directory) {
 if(typeof directory!=='string'||!path.isAbsolute(directory))deny();
 let resolved,stat;
 try{
  stat=fs.lstatSync(directory);
  resolved=fs.realpathSync.native(directory);
 }catch{deny();}
 if(!stat.isDirectory()||stat.isSymbolicLink()||
    insideRepo(resolved))deny();
 if(process.platform!=='win32'){
  const real=fs.statSync(resolved);
  if((real.mode&0o077)!==0||
     (typeof process.getuid==='function'&&real.uid!==process.getuid()))
    deny();
 }
 return resolved;
}
export function readPinnedArchiveInput(source,maxBytes) {
 if(typeof source!=='string'||!path.isAbsolute(source)||
    !Number.isSafeInteger(maxBytes)||maxBytes<4||
    maxBytes>32*1024*1024)deny();
 let resolved,fd;
 try{
  resolved=fs.realpathSync.native(source);
  const leaf=fs.lstatSync(source);
  if(leaf.isSymbolicLink()||insideRepo(resolved))deny();
  // O_NOFOLLOW rejects final-component symlinks; we read and fstat the
  // SAME open descriptor instead of lstat(path) then re-opening a path.
  const flags=fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0);
  fd=fs.openSync(source,flags);
  const stat=fs.fstatSync(fd);
  if(!stat.isFile()||stat.size<4||stat.size>maxBytes)deny();
  const bytes=fs.readFileSync(fd);
  if(bytes.length!==stat.size||
     !bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04])))
    deny();
  return bytes;
 }catch{deny();}
 finally{if(fd!==undefined)fs.closeSync(fd);}
}
