import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
 ROADMAP_HISTORICAL_ARTIFACTS,sealPrivateRoadmapEvidence
} from './o57-private-roadmap-evidence-vault.mjs';

// Explicit OFFLINE command: archive historical original Actions ZIPs that
// the operator has already downloaded. This script does NOT download from
// GitHub or access Screeps, does NOT copy private RSA key into the archive,
// and does NOT claim a valid release receipt or durable remote replication.
function fail(){throw new Error('O57_ARCHIVE_ORIGINALS_HOLD');}
function parse(argv){
 const a={};
 for(let i=0;i<argv.length;i+=2){
   const k=argv[i],v=argv[i+1];
   if(!['--output-parent','--world-zip','--newbieland-zip','--public-key'].includes(k)||
     !v||a[k]||!path.isAbsolute(v))fail();
   a[k]=v;
 }
 if(Object.keys(a).length!==4||argv.length!==8)fail();
 return a;
}
function readExistingFile(name,max){
 const stat=fs.lstatSync(name);
 if(!stat.isFile()||stat.isSymbolicLink()||
    stat.size<4||stat.size>max)fail();
 const bytes=fs.readFileSync(name);
 if(!bytes.subarray(0,4).equals(Buffer.from([0x50,0x4b,0x03,0x04])))
   fail(); // No decompression/execution of untrusted ZIP
 return bytes;
}
export function archivePinnedRoadmapOriginals(args){
 const inputs=parse(args);
 const dest=inputs['--output-parent'];
 const info=fs.lstatSync(dest);
 if(!info.isDirectory()||info.isSymbolicLink())fail();
 const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const relative=path.relative(repoRoot,dest);
 if(relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&
   !path.isAbsolute(relative)))fail(); // keep even encrypted archives out of git
 const pem=fs.readFileSync(inputs['--public-key'],'utf8');
 const world=readExistingFile(inputs['--world-zip'],32*1024*1024);
 const newb=readExistingFile(inputs['--newbieland-zip'],32*1024*1024);
 // Commit the pair only after BOTH encrypted bundles exist. No backups
 // or original ZIPs are left in the destination root on failure.
 const name='o57-original-evidence-v1';
 const final=path.join(dest,name);
 if(fs.existsSync(final))fail();
 const stage=fs.mkdtempSync(path.join(dest,'.o57-private-stage-'));
 try{
   sealPrivateRoadmapEvidence({
     zipBytes:world,
     context:{repository:'Riflex91/boringstuff',...ROADMAP_HISTORICAL_ARTIFACTS.world},
     recipientPublicKeyPem:pem,
     destination:path.join(stage,'world')
   });
   sealPrivateRoadmapEvidence({
     zipBytes:newb,
     context:{repository:'Riflex91/boringstuff',...ROADMAP_HISTORICAL_ARTIFACTS.newbieland},
     recipientPublicKeyPem:pem,
     destination:path.join(stage,'newbieland')
   });
   if(fs.existsSync(final))fail();
   fs.renameSync(stage,final);
 }catch{
   fs.rmSync(stage,{recursive:true,force:true});
   fail();
 }
 return Object.freeze({
   encryptedDirectory:final,sourceArtifacts:2,
   originalReceiptAuthenticated:false,
   durableRemoteStorageVerified:false,
   releaseAuthorized:false
 });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
   const x=archivePinnedRoadmapOriginals(process.argv.slice(2));
   // Prints only an output directory and non-authorizing state.
   console.log('O57_PRIVATE_ARCHIVE_ENCRYPTED '+JSON.stringify(x));
 }catch{
   console.error('O57_ARCHIVE_ORIGINALS_HOLD');
   process.exitCode=2;
 }
}
