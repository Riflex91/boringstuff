// D16 preliminary one-shot authenticated GET-only owned core overlay audit.
// No Screeps POST, console intents, code deployments, construction or memory writes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {ScreepsHttpClient} from './screeps-client.mjs';
import {buildScreepsConfig} from './ci-deployment-credentials.mjs';
import {buildWorldConfig} from './world-deployment-profile.mjs';
import {parseBotMemory} from './ci-deployment-guard.mjs';
const targets=[
 {server:'newbieland',room:'E8N1',shard:null,build:()=>buildScreepsConfig(process.env)},
 {server:'world',room:'W37S79',shard:'shard0',build:()=>buildWorldConfig(process.env)}
];
const num=v=>Number.isSafeInteger(v)&&v>=0?v:null;
const type=o=>o?.type||o?.structureType;
const tile=o=>Number.isSafeInteger(o?.x)&&Number.isSafeInteger(o?.y)?
  {x:o.x,y:o.y}:null;
const mine=(o,id)=>id&&String(o?.user||'')===String(id);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'screeps-d16-core-get-'));
try {
 for(const target of targets){
  try {
   const cfg=path.join(tmp,target.server+'.json');
   fs.writeFileSync(cfg,JSON.stringify(target.build()),{mode:0o600,flag:'wx'});
   const api=await ScreepsHttpClient.fromConfig(target.server,
     {file:cfg,shard:target.shard});
   const [me,data,raw]=await Promise.all([
    api.authMe(),api.gameRoomObjects(target.room,target.shard),
    api.userMemory('bot',target.shard)]);
   const id=me?._id||me?.id;
   const objects=Array.isArray(data?.objects)?data.objects:null;
   if(!id||!objects||objects.length>2000||!objects.some(o=>type(o)==='controller'))
      throw Error('UNVERIFIED_OBJECTS');
   const ctrl=objects.find(o=>type(o)==='controller');
   const owned=objects.filter(o=>mine(o,id));
   const core=owned.filter(o=>['spawn','tower','storage'].includes(type(o)));
   const ramps=owned.filter(o=>type(o)==='rampart');
   const sites=owned.filter(o=>type(o)==='constructionSite'||
     type(o)==='construction_site');
   if(core.length>16||ramps.length>600)throw Error('UNBOUNDED_CORE');
   const result=core.map(o=>{
    const p=tile(o);
    if(!p) return {type:type(o),position:'UNVERIFIED'};
    const overlay=ramps.filter(x=>x.x===p.x&&x.y===p.y);
    const matchingSites=sites.filter(x=>x.x===p.x&&x.y===p.y);
    const blockers=objects.filter(x=>x!==o && x.x===p.x&&x.y===p.y &&
      type(x)!=='road'&&type(x)!=='rampart'&&
      type(x)!=='constructionSite'&&type(x)!=='construction_site');
    return {type:type(o),position:p,
      ownedRampartsBuilt:overlay.length,
      ownedRampartHits:overlay.length===1?num(overlay[0].hits):null,
      pendingOwnRampartSite:matchingSites.some(x=>x.structureType==='rampart'),
      onPlannerExcludedEdge:p.x<=1||p.x>=48||p.y<=1||p.y>=48,
      otherBuildingOnTileTypes:blockers.map(type).slice(0,6)};
   });
   const bot=parseBotMemory(raw);
   const snaps=Array.isArray(bot?.telemetryJournal?.snapshots)?
     bot.telemetryJournal.snapshots:[];
   const valid=snaps.filter(s=>s?.c==='STATUS_SNAPSHOT'&&
     num(s.t)!==null&&s?.x?.rooms?.[target.room])
     .sort((a,b)=>b.t-a.t);
   const latest=valid[0],home=latest?.x?.rooms?.[target.room];
   const observations={
    tick:num(latest?.t),rcl:num(home?.rcl),
    energyStored:num(home?.energyStored),
    hostiles:num(home?.hostiles),
    constructionSites:num(home?.constructionSites),
    snapshotAgeRelativeToDeployment: num(bot?.deploymentTick)!=null&&
      num(latest?.t)!=null?latest.t-bot.deploymentTick:null
   };
   console.log('D16_OWNED_CORE_GET '+JSON.stringify({
    server:target.server,room:target.room,shard:target.shard,
    authenticated:true,rcl:num(ctrl?.level),
    ownedCoreCount:core.length,ownedRampartCount:ramps.length,
    ownedRampartSiteCount:sites.filter(o=>o.structureType==='rampart').length,
    protectedCoreCount:result.filter(x=>x.ownedRampartsBuilt===1).length,
    coreTiles:result,observations,
    status:'AUTHENTIC_GET_ONLY',gameWrites:0}));
  }catch(_){
   console.log('D16_OWNED_CORE_GET '+JSON.stringify({
    server:target.server,room:target.room,
    status:'UNVERIFIED_GET_UNAVAILABLE',gameWrites:0}));
  }
 }
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
