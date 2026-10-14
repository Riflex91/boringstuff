'use strict';

const config=require('config');
const parentStability=require('expansion.parent.stability.shadow');

const MAX_PIONEER_ORDERS=2;
const ROOM=/^[WE][0-9]+[NS][0-9]+$/;
function hold(reason) {
  return {status:'HOLD',reason,spawnIntentAccepted:false};
}

// I4 second-colony supply only AFTER ownership confirmation. Two bounded,
// self-harvesting pioneer bodies; no scheduler authority unless separately
// enabled. The home spawn/economy/defense reserve is always first.
function provision(states,game,memory,continuity) {
  if(config.AUTO_EXPANSION_CLAIM!==true ||
     config.AUTO_EXPANSION_BOOTSTRAP!==true)
    return hold('AUTO_EXPANSION_BOOTSTRAP_DISABLED');
  const tick=game?.time;
  const m=memory?.bot?.expansionClaim;
  if(!Number.isSafeInteger(tick) || !m || m.schemaVersion!==1 ||
     m.phase!=='CLAIMED' || !ROOM.test(m.parent||'') ||
     !ROOM.test(m.target||'') || m.parent===m.target ||
     !Number.isSafeInteger(m.confirmedTick) ||
     m.confirmedTick>tick || tick-m.confirmedTick>2000 ||
     !Array.isArray(m.route) || m.route.length<2 ||
     m.route.length>4 || m.route[0]!==m.parent ||
     m.route.at(-1)!==m.target ||
     new Set(m.route).size!==m.route.length ||
     m.route.some(name=>!ROOM.test(name)) ||
     !Number.isSafeInteger(m.estimatedClaimTravelTicks) ||
     m.estimatedClaimTravelTicks<1 ||
     m.estimatedClaimTravelTicks>300 ||
     !m.verifiedSpawnSite ||
     m.verifiedSpawnSite.roomName!==m.target ||
     !Number.isInteger(m.verifiedSpawnSite.x) ||
     !Number.isInteger(m.verifiedSpawnSite.y) ||
     m.verifiedSpawnSite.x<5 || m.verifiedSpawnSite.x>44 ||
     m.verifiedSpawnSite.y<5 || m.verifiedSpawnSite.y>44)
    return hold('CONFIRMED_CLAIM_OR_ROUTE_UNVERIFIED');

  if(m.lastPioneerSpawnIntentTick!==undefined &&
     (!Number.isSafeInteger(m.lastPioneerSpawnIntentTick) ||
      m.lastPioneerSpawnIntentTick>tick ||
      tick-m.lastPioneerSpawnIntentTick<25))
    return hold('PIONEER_ORDER_COOLDOWN');
  const count=m.pioneerOrders===undefined?0:m.pioneerOrders;
  if(!Number.isSafeInteger(count) ||
     count<0 || count>=MAX_PIONEER_ORDERS)
    return hold('PIONEER_ORDER_LIMIT_REACHED');

  const parent=Array.isArray(states)?states.find(s=>s?.room?.name===m.parent):null;
  const home=game?.rooms?.[m.parent],target=game?.rooms?.[m.target];
  if(!parent || parent.room!==home || !parent.spawn ||
     parent.spawn.spawning || parent.emergency ||
     parent.health?.status!=='HEALTHY' ||
     !home?.controller?.my || !target?.controller?.my ||
     (Number(home.controller.safeMode)||0)>0 ||
     (Number(home.controller.safeModeCooldown)||0)>0 ||
     !parentStability.qualifies(continuity,m.parent,tick))
    return hold('PARENT_DEFENSE_OR_SUPPORT_UNVERIFIED');

  if(!game?.map || !game?.creeps || !game?.cpu ||
     typeof game.cpu.getUsed!=='function' ||
     !Number.isFinite(game.cpu.bucket) || game.cpu.bucket<8000 ||
     !Number.isFinite(game.cpu.limit) ||
     game.cpu.limit-game.cpu.getUsed()<Math.max(12,game.cpu.limit*0.4) ||
     tick%25!==0)
    return hold('CPU_OR_REAL_TICK_HEADROOM_DEFERRED');
  if(Object.values(game.creeps).some(c=>
      c?.memory?.role==='pioneer' &&
      c.memory.claimMissionId===m.id &&
      c.memory.home!==m.parent))
    return hold('FOREIGN_OR_CORRUPT_PIONEER');
  if(Object.values(game.creeps).filter(c=>
      c?.memory?.role==='pioneer' &&
      c.memory.claimMissionId===m.id).length>=MAX_PIONEER_ORDERS)
    return hold('EXISTING_PIONEER_CAP');

  if(typeof FIND_HOSTILE_CREEPS==='undefined' ||
     typeof FIND_HOSTILE_STRUCTURES==='undefined')
    return hold('HOSTILE_OBSERVATION_UNAVAILABLE');
  for(let i=0;i<m.route.length;i++) {
    const name=m.route[i],room=game.rooms[name];
    if(!room || room.name!==name || typeof room.find!=='function')
      return hold('ROUTE_VISION_UNAVAILABLE');
    const hostileCreeps=room.find(FIND_HOSTILE_CREEPS);
    const hostileStructures=room.find(FIND_HOSTILE_STRUCTURES);
    if(!Array.isArray(hostileCreeps) || hostileCreeps.length ||
       !Array.isArray(hostileStructures) || hostileStructures.length)
      return hold('ROUTE_HOSTILE_OR_UNVERIFIED');
    if(i>0 && i<m.route.length-1 &&
       (!room.controller || room.controller.owner ||
        room.controller.reservation || room.controller.my))
      return hold('TRANSIT_NO_LONGER_NEUTRAL');
    if(i>0) {
      const exits=game.map.describeExits?.(m.route[i-1]);
      if(!exits || !Object.values(exits).includes(name))
        return hold('ROUTE_ADJACENCY_FAILED');
    }
  }
  if(typeof FIND_MY_SPAWNS==='undefined')return hold('SPAWN_OBSERVATION_UNAVAILABLE');
  const targetSpawns=target.find(FIND_MY_SPAWNS);
  if(!Array.isArray(targetSpawns) || targetSpawns.length)
    return hold('FIRST_SPAWN_ALREADY_PRESENT');

  if(typeof WORK==='undefined' || typeof CARRY==='undefined' ||
     typeof MOVE==='undefined' || typeof BODYPART_COST==='undefined' || !BODYPART_COST ||
     !Number.isSafeInteger(BODYPART_COST[WORK]) ||
     !Number.isSafeInteger(BODYPART_COST[CARRY]) ||
     !Number.isSafeInteger(BODYPART_COST[MOVE]))
    return hold('PIONEER_BODY_COST_UNVERIFIED');
  const body=[WORK,CARRY,MOVE,WORK,CARRY,MOVE];
  const cost=2*(BODYPART_COST[WORK]+BODYPART_COST[CARRY]+BODYPART_COST[MOVE]);
  const reserve=Math.max(5000,(parent.energyCapacityAvailable||0)*3);
  if(!Number.isSafeInteger(parent.energyCapacityAvailable) ||
     !Number.isSafeInteger(parent.energyAvailable) ||
     !Number.isSafeInteger(parent.energyStored) ||
     parent.energyAvailable!==parent.energyCapacityAvailable ||
     parent.energyAvailable<cost || parent.energyStored-cost<reserve ||
     parent.economyModel?.haulerCarryDeficit>0 ||
     parent.economyModel?.consumerCriticalCount>0)
    return hold('HOME_ENERGY_OR_LOGISTICS_RESERVE_LOW');
  const name='pio-'+m.parent+'-'+m.confirmedTick+'-'+count;
  if(typeof parent.spawn.spawnCreep!=='function')
    return hold('SPAWN_UNAVAILABLE');

  let rc;
  try {
    rc=parent.spawn.spawnCreep(body,name,{memory:{
      role:'pioneer',home:m.parent,targetRoom:m.target,
      claimMissionId:m.id,born:tick
    }});
  } catch(_) {return hold('PIONEER_SPAWN_EXCEPTION');}
  if(rc!==OK)
    return {status:'SPAWN_REJECTED',reason:'PIONEER_RC_'+String(rc),
      spawnIntentAccepted:false};
  m.pioneerOrders=count+1;
  m.lastPioneerSpawnIntentTick=tick;
  return {status:'SPAWN_INTENT_ACCEPTED',reason:null,
    spawnIntentAccepted:true,pioneerOrders:m.pioneerOrders};
}
module.exports={provision};
