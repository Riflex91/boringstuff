// One-shot GET-only D6 World verification after intermittent API timeout.
// Pin expected game deployment ID from signed GitHub upload logs. No POST,
// no game intents, no account changes, no exposure of secret tokens.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ScreepsHttpClient} from './screeps-client.mjs';
import {parseBotMemory,inspectDeployment} from './ci-deployment-guard.mjs';
import {buildWorldConfig} from './world-deployment-profile.mjs';

const expected='20261020210752885-4119';
const home='W37S79',shard='shard0';
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'screeps-d6-world-get-only-'));
try {
 const config=path.join(folder,'world.json');
 fs.writeFileSync(config,JSON.stringify(buildWorldConfig(process.env)),
   {flag:'wx',mode:0o600});
 const api=await ScreepsHttpClient.fromConfig('world',{file:config,shard});
 const [account,room]=await Promise.all([
  api.authMe(),api.gameRoomObjects(home,shard)
 ]);
 const id=account?._id||account?.id;
 const rows=Array.isArray(room?.objects)?room.objects:[];
 const ownSpawns=rows.filter(s=>s && 
   (s.type==='spawn'||s.structureType==='spawn') &&
   id && String(s.user)===String(id));
 const ownController=rows.some(s=>s &&
   (s.type==='controller'||s.structureType==='controller') &&
   id && String(s.user)===String(id));
 const towers=rows.filter(s=>s &&
   (s.type==='tower'||s.structureType==='tower') &&
   id && String(s.user)===String(id));
 console.log('D6_WORLD_CORE_GET '+JSON.stringify({
   ownedController:ownController,ownedSpawns:ownSpawns.length,
   activeSpawnJobs:ownSpawns.filter(s=>s.spawning).length,
   ownedTowers:towers.length,
   totalTowerEnergy:towers.reduce((sum,s)=>sum+
     (Number.isFinite(s.store?.energy)?s.store.energy:0),0)
 }));
 if(!ownController||ownSpawns.length<1)
   throw new Error('WORLD_OWNERSHIP_OR_SPAWN_MISSING');
 let inspection=null,transportError=null;
 for(let attempt=1;attempt<=2;attempt++){
   try {
     const payload=await api.userMemory('bot',shard);
     const bot=parseBotMemory(payload);
     inspection=inspectDeployment(bot,expected,100);
     transportError=null;
     break;
   }catch(err){
     transportError=err;
     if(attempt<2)await new Promise(resolve=>setTimeout(resolve,3000));
   }
 }
 if(transportError)throw new Error('WORLD_MEMORY_GET_UNAVAILABLE_AFTER_RETRIES');
 console.log('D6_WORLD_REAL_GAME_WITNESS '+JSON.stringify({
   status:inspection.status,
   reason:inspection.reason||null,
   deploymentTick:inspection.deploymentTick||null,
   observedTicks:inspection.observedTicks||0,
   rcl:inspection.rcl??null,
   cpu:inspection.cpu??null,
   bucket:inspection.bucket??null,
   roles:inspection.roles||null
 }));
 if(inspection.status!=='PASS')
   throw new Error('WORLD_REAL_GAME_100T_NOT_YET_VERIFIED_'+inspection.status);
}finally{
 fs.rmSync(folder,{recursive:true,force:true});
}
