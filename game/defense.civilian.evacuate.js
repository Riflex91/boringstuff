'use strict';

const config=require('config');

// D1 executable, room-local civilian escape: do not abandon work for harmless
// scouts, distant hostiles, a protected safe-mode room or unverifiable paths.
// Pioneers/claimers/raiders manage their mission-specific withdrawal already.
const CIVILIAN=new Set(['harvester','hauler','worker','builder',
  'repairer','upgrader']);
function active(part,type) {
  return !!part && part.hits>0 && part.type===type;
}
function dangerRange(hostile,creep) {
  if(!hostile?.pos || !Array.isArray(hostile.body) ||
     !creep?.pos || typeof creep.pos.getRangeTo!=='function')return 0;
  const distance=creep.pos.getRangeTo(hostile);
  if(!Number.isFinite(distance) || distance<0)return 0;
  let threat=0;
  for(const p of hostile.body) {
    if(active(p,'ranged_attack'))threat=Math.max(threat,5);
    else if(active(p,'attack'))threat=Math.max(threat,3);
    else if(active(p,'work'))threat=Math.max(threat,2);
  }
  return threat>=distance?6:0;
}
function run(creep,game) {
  if(!creep || !CIVILIAN.has(creep.memory?.role) ||
     !creep.room?.controller?.my ||
     (Number(creep.room.controller.safeMode)||0)>0 ||
     !creep.pos || typeof creep.move!=='function' ||
     typeof creep.pos.getDirectionTo!=='function' ||
     typeof creep.room.find!=='function' ||
     typeof FIND_HOSTILE_CREEPS==='undefined' ||
     typeof MOVE==='undefined' ||
     typeof creep.getActiveBodyparts!=='function' ||
     creep.getActiveBodyparts(MOVE)<1)return false;
  // The room manager has already performed high-priority tower/defender work.
  // CPU cap is per fleeing creep, never a global new process scheduler.
  const cpu=game?.cpu;
  if(!cpu || !Number.isFinite(cpu.limit) ||
     typeof cpu.getUsed!=='function' ||
     cpu.limit-cpu.getUsed()<3 ||
     typeof PathFinder==='undefined' ||
     typeof PathFinder.search!=='function')return false;
  let hostiles;
  try{hostiles=creep.room.find(FIND_HOSTILE_CREEPS);}
  catch(_){return false;}
  if(!Array.isArray(hostiles) || !hostiles.length)return false;
  const adjacent=hostiles.filter(h=>dangerRange(h,creep)>0);
  if(!adjacent.length)return false;
  let result;
  try{
    result=PathFinder.search(creep.pos,
      adjacent.slice(0,5).map(h=>({pos:h.pos,range:6})),
      {flee:true,maxRooms:1,maxOps:Math.min(120,config.PATH_MAX_OPS||120),
        roomCallback:name=>name===creep.room.name?undefined:false});
  }catch(_){return false;}
  if(!result || result.incomplete!==false ||
     !Array.isArray(result.path) || !result.path.length ||
     result.path[0]?.roomName!==creep.room.name)return false;
  const direction=creep.pos.getDirectionTo(result.path[0]);
  if(!Number.isInteger(direction) || direction<1 || direction>8)return false;
  try {
    const rc=creep.move(direction);
    return rc===OK || (typeof ERR_TIRED!=='undefined' && rc===ERR_TIRED);
  }catch(_){return false;}
}
module.exports={run,_test:{dangerRange}};
