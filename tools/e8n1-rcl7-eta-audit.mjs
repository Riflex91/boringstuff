// One-shot authenticated GET-only RCL7 ETA evidence for Newbieland E8N1.
// Only sanitized controller numeric fields and in-game STATUS_SNAPSHOT
// upgrades are printed. No game/intents, memory writes, or credential logs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ScreepsHttpClient} from './screeps-client.mjs';
import {parseBotMemory} from './ci-deployment-guard.mjs';
import {buildScreepsConfig} from './ci-deployment-credentials.mjs';

const safe=n=>Number.isSafeInteger(n)&&n>=0&&n<=1e12?n:null;
const room='E8N1';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'e8n1-get-only-eta-'));
try {
 const filename=path.join(tmp,'creds.json');
 fs.writeFileSync(filename,JSON.stringify(buildScreepsConfig(process.env)),
   {mode:0o600,flag:'wx'});
 const api=await ScreepsHttpClient.fromConfig('newbieland',{file:filename});
 const [account,roomData,memoryData]=await Promise.all([
   api.authMe(),api.gameRoomObjects(room),api.userMemory('bot')]);
 const own=account?._id||account?.id;
 const objects=Array.isArray(roomData?.objects)?roomData.objects:[];
 const controller=objects.find(x=>x?.type==='controller')||null;
 const bot=parseBotMemory(memoryData);
 const snapshots=Array.isArray(bot?.telemetryJournal?.snapshots)
   ?bot.telemetryJournal.snapshots:[];
 const measured=snapshots.filter(x=>
   x?.c==='STATUS_SNAPSHOT'&&safe(x.t)!==null&&
   x?.x?.rooms?.[room]&&typeof x.x.rooms[room]==='object')
   .map(x=>{
     const s=x.x.rooms[room];
     return {tick:x.t,rcl:safe(s.rcl),
       progress:safe(s.controllerProgress),
       progressTotal:safe(s.controllerProgressTotal),
       upgraders:safe(s.creeps?.upgrader),
       storedEnergy:safe(s.energyStored)}
   }).filter(x=>x.progress!==null&&x.progressTotal!==null&&
       x.progress<=x.progressTotal&&x.rcl!==null)
   .sort((a,b)=>a.tick-b.tick).slice(-20);
 const current={
   rcl:safe(controller?.level),
   progress:safe(controller?.progress),
   progressTotal:safe(controller?.progressTotal),
   ownController:controller?.user===own,
   ticksToDowngrade:safe(controller?.downgradeTime)
 };
 const sameRcl=measured.filter(x=>x.rcl===current.rcl ||
   current.rcl===null&&x.rcl===6);
 let windows=[];
 for(let i=1;i<sameRcl.length;i++){
   const a=sameRcl[i-1],b=sameRcl[i];
   if(b.tick>a.tick&&b.progress>=a.progress&&
      a.progressTotal===b.progressTotal){
     const delta=b.progress-a.progress;
     windows.push({startTick:a.tick,endTick:b.tick,ticks:b.tick-a.tick,
       progressGained:delta,progressPerTick:+(delta/(b.tick-a.tick)).toFixed(5)});
   }
 }
 const recent=windows.slice(-5);
 const total=recent.reduce((n,x)=>n+x.ticks,0);
 const gain=recent.reduce((n,x)=>n+x.progressGained,0);
 const mean=total>0?gain/total:null;
 const latest=sameRcl.at(-1)||null;
 const progress= current.progress??latest?.progress??null;
 // Screeps room-objects can omit progressTotal or return zero even
 // when current room telemetry verifies the RCL6 requirement as 3,645,000.
 // Never treat an invalid zero target as a completed upgrade.
 const target= current.progressTotal>0?current.progressTotal:
   (latest?.progressTotal>0?latest.progressTotal:null);
 const targetSource=current.progressTotal>0?'ROOM_OBJECTS':
   latest?.progressTotal>0?'BOT_STATUS_SNAPSHOT':'UNKNOWN';
 const remaining=progress!==null&&target!==null?Math.max(0,target-progress):null;
 const approxTicks=mean>0&&remaining!==null?Math.ceil(remaining/mean):null;
 console.log('E8N1_RCL7_ETA_GET '+JSON.stringify({
   server:'newbieland',room,
   source:'GAME_ROOM_OBJECTS_AND_EXISTING_AUTHENTIC_STATUS_SNAPSHOTS',
   ownerVerified:current.ownController,
   controller:current,
   latestMemorySnapshot:latest,
   latestSamples:sameRcl.slice(-10),
   observedWindows:recent,
   observedTotalTicks:total,observedProgressGain:gain,
   observedMeanProgressPerTick:mean===null?null:+mean.toFixed(5),
   progressTargetUsed:target,progressTargetSource:targetSource,
   remainingProgress:remaining,
   projectedTicksAtObservedMean:approxTicks,
   gameWrites:0
 }));
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
