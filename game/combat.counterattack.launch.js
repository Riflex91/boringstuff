'use strict';

// U11: authorize exactly one real, unboosted expedition against the OWNER
// actually observed sending armed creeps into one of our owned colonies.
// All claims below are reverified from live Room/Game, never trusted as action
// authority from a SHADOW advisory or historical player-intel alone.
const config=require('config');
const adviser=require('combat.counterattack.shadow');
const ROOM=/^[WE][0-9]+[NS][0-9]+$/;
const NPC=new Set(['Invader','Source Keeper']);
const MAX_AGE=125;
const MAX_DURATION=900;
const REPEAT_COST=190; // [TOUGH,ATTACK,MOVE,MOVE], checked against engine costs.
function hold(reason){return {status:'HOLD',reason,spawnIntentAccepted:false};}
function parts(creep) {
  if(!creep || !Array.isArray(creep.body) || creep.body.length>50 ||
     creep.body.length===0)return null;
  let dps=0,heal=0,hits=0,combat=0;
  for(const part of creep.body) {
    if(!part || !Number.isInteger(part.hits) ||
       part.hits<0 || part.hits>100 || part.boost)return null;
    if(part.hits===0)continue;
    hits+=part.hits;
    if(part.type==='attack'){combat++;dps+=30;}
    else if(part.type==='ranged_attack'){combat++;dps+=10;}
    else if(part.type==='work'){combat++;dps+=30;}
    else if(part.type==='heal'){combat++;heal+=12;}
  }
  return {dps,heal,hits,combat};
}
function parentReady(state) {
  const c=state?.room?.controller;
  return !!c?.my && !c.safeMode && !c.safeModeCooldown &&
    !!state.spawn && !state.spawn.spawning &&
    state.health?.status==='HEALTHY' && state.emergency===false &&
    Array.isArray(state.hostileCreeps) &&
    state.hostileCreeps.length===0 &&
    Number.isSafeInteger(state.energyStored) && state.energyStored>=15000 &&
    Number.isSafeInteger(state.energyCapacityAvailable) &&
    state.energyCapacityAvailable>=6*REPEAT_COST &&
    state.energyAvailable===state.energyCapacityAvailable &&
    (state.byRole?.defender||0)>=1 &&
    (state.byRole?.harvester||0)>=1 &&
    (state.byRole?.worker||0)>=1;
}
function neighbor(game,home,target) {
  if(!ROOM.test(home||'') || !ROOM.test(target||'') ||
     home===target)return false;
  const forward=game?.map?.describeExits?.(home);
  const backward=game?.map?.describeExits?.(target);
  return !!forward && !!backward &&
    Object.values(forward).includes(target) &&
    Object.values(backward).includes(home);
}
function start(states,game,memory) {
  if(config.AUTO_COUNTERATTACK_RAID!==true)return hold('AUTO_RAID_DISABLED');
  const now=game?.time;
  if(!Number.isSafeInteger(now) || now<0 || now%100!==0 ||
     !Array.isArray(states) || !memory?.bot || !game?.rooms ||
     !game?.creeps || !game?.cpu ||
     !Number.isFinite(game.cpu.limit) ||
     !Number.isFinite(game.cpu.bucket) || game.cpu.bucket<8500 ||
     typeof game.cpu.getUsed!=='function' ||
     game.cpu.limit-game.cpu.getUsed()<12)
    return hold('GAME_OR_CPU_HEADROOM_UNVERIFIED');
  if(['CLAIMING','CLAIMED'].includes(memory.bot.expansionClaim?.phase))
    return hold('ACTIVE_FIRST_SPAWN_COMMITMENT');
  const prior=memory.bot.counterattackMission;
  if(prior && (!Number.isSafeInteger(prior.createdTick) ||
      prior.createdTick>now || now-prior.createdTick<3000 ||
      ['ATTACKING','RETREAT'].includes(prior.phase)))
    return hold('ONE_RAID_OR_LONG_RECOVERY_COOLDOWN');
  if(Object.values(game.creeps).some(c=>c?.memory?.role==='raider' ||
      c?.memory?.defenseSupportTarget))
    return hold('EXISTING_FIELD_COMBAT_COMMITMENT');
  const observation=memory.bot.combatAggressionEvidence;
  const intel=memory.bot.worldIntel?.rooms;
  const advisory=adviser.evaluate(states,intel,observation,game);
  const candidate=advisory?.candidate;
  if(advisory?.status!=='RECON_ADVISORY' ||
     advisory.authority!=='SHADOW' ||
     advisory.actionAuthority!=='NONE' ||
     advisory.attackActionEnabled!==false ||
     !candidate || !neighbor(game,candidate.parentRoom,candidate.targetRoom) ||
     candidate.observedTowerCount!==0 ||
     !Number.isSafeInteger(candidate.lastIncursionTick) ||
     candidate.lastIncursionTick>now ||
     now-candidate.lastIncursionTick>MAX_AGE ||
     typeof candidate.observedAggressor!=='string' ||
     NPC.has(candidate.observedAggressor))
    return hold('FRESH_ADJACENT_AGGRESSOR_RECON_MISSING');
  const state=states.find(x=>x?.room?.name===candidate.parentRoom);
  const home=game.rooms[candidate.parentRoom];
  const target=game.rooms[candidate.targetRoom];
  if(!parentReady(state) || home!==state.room ||
     !target?.controller ||
     target.controller.my!==false ||
     target.controller.owner?.username!==candidate.observedAggressor ||
     (Number(target.controller.safeMode)||0)>0 ||
     typeof target.find!=='function' ||
     typeof FIND_HOSTILE_CREEPS==='undefined' ||
     typeof FIND_HOSTILE_STRUCTURES==='undefined' ||
     typeof STRUCTURE_TOWER==='undefined')
    return hold('LIVE_OWNER_PARENT_OR_ROOM_UNVERIFIED');
  let defenders,structures;
  try {
    defenders=target.find(FIND_HOSTILE_CREEPS);
    structures=target.find(FIND_HOSTILE_STRUCTURES);
  }catch(_){return hold('ACTUAL_COMBAT_OBSERVATION_FAILED');}
  if(!Array.isArray(defenders) || !Array.isArray(structures) ||
     structures.some(s=>s?.structureType===STRUCTURE_TOWER) ||
     !defenders.length || defenders.length>2 ||
     defenders.some(c=>c?.owner?.username!==candidate.observedAggressor))
    return hold('TOWER_OR_THIRD_PARTY_OR_TARGET_UNVERIFIED');
  const assessed=defenders.map(parts);
  if(assessed.some(x=>!x || !x.combat))
    return hold('BOOSTED_OR_UNVERIFIED_TARGET_BODY');
  const damage=assessed.reduce((n,x)=>n+x.dps,0);
  const heals=assessed.reduce((n,x)=>n+x.heal,0);
  const hp=assessed.reduce((n,x)=>n+x.hits,0);
  // Do not gamble a field creep against an opponent with unknown,
  // comparable, or boosted offense/heals. Require a decisive local margin.
  const repeat=Math.min(8,Math.floor(state.energyCapacityAvailable/REPEAT_COST));
  const ownDps=repeat*30;
  const ownHits=repeat*400;
  if(repeat<6 || damage>ownDps/6 ||
     heals>ownDps/5 || hp>ownDps*8 ||
     damage*50>=ownHits || ownDps-heals<4*damage)
    return hold('REAL_COMBAT_VICTORY_MARGIN_UNPROVEN');
  if(typeof TOUGH==='undefined' || typeof ATTACK==='undefined' ||
     typeof MOVE==='undefined' || !BODYPART_COST ||
     BODYPART_COST[TOUGH]!==10 ||
     BODYPART_COST[ATTACK]!==80 ||
     BODYPART_COST[MOVE]!==50 ||
     typeof OK==='undefined' || typeof state.spawn.spawnCreep!=='function')
    return hold('LIVE_RAIDER_BODY_COST_UNVERIFIED');
  const body=[];
  for(let i=0;i<repeat;i++)body.push(TOUGH,ATTACK,MOVE,MOVE);
  const cost=repeat*REPEAT_COST;
  if(state.energyAvailable<cost ||
     state.energyStored-cost<15000 ||
     body.length>50)return hold('HOME_REPLACEMENT_COST_TOO_HIGH');
  const id='raid-'+candidate.parentRoom+'-'+candidate.targetRoom+'-'+now;
  const name='raid-'+candidate.parentRoom+'-'+now;
  let rc;
  try {
    rc=state.spawn.spawnCreep(body,name,{memory:{
      role:'raider',home:candidate.parentRoom,
      targetRoom:candidate.targetRoom,combatMissionId:id,born:now
    }});
  }catch(_){return hold('RAIDER_SPAWN_EXCEPTION');}
  if(rc!==OK)
    return {status:'SPAWN_REJECTED',reason:'RAIDER_RC_'+String(rc),
      spawnIntentAccepted:false};
  memory.bot.counterattackMission={
    schemaVersion:1,id,phase:'ATTACKING',
    parent:candidate.parentRoom,target:candidate.targetRoom,
    aggressor:candidate.observedAggressor,
    createdTick:now,targetOwnerSeenTick:now,
    route:[candidate.parentRoom,candidate.targetRoom],
    raiderName:name,spawnTicks:body.length*3,
    verifiedTargetDps:damage,verifiedTargetHeal:heals,
    verifiedTargetHits:hp,verifiedOwnDps:ownDps,
    verifiedOwnHits:ownHits,reason:null
  };
  return {status:'SPAWN_INTENT_ACCEPTED',reason:null,
    spawnIntentAccepted:true,missionId:id,
    verifiedOwnDps:ownDps,observedEnemyDps:damage};
}
function supervise(game,memory) {
  const m=memory?.bot?.counterattackMission;
  const now=game?.time;
  if(!m || m.schemaVersion!==1 ||
     !['ATTACKING','RETREAT'].includes(m.phase))
    return {status:'NO_ACTIVE_RAID',changed:false};
  if(!Number.isSafeInteger(now) || now<m.createdTick ||
     !game?.rooms || !game?.creeps)
    return {status:'RUNTIME_UNVERIFIED',changed:false};
  const raider=game.creeps[m.raiderName];
  const retreat=reason=>{
    if(m.phase!=='RETREAT') {
      m.phase='RETREAT';m.reason=reason;m.retreatTick=now;
      return {status:'RETREAT',reason,changed:true};
    }
    return {status:'RETREAT',reason:m.reason,changed:false};
  };
  if(m.phase==='RETREAT') {
    if(raider?.room?.name===m.parent) {
      // Recycle surviving combat capacity as a normal home defender.
      raider.memory.role='defender';
      delete raider.memory.combatMissionId;
      m.phase='COMPLETE';m.completeTick=now;
      return {status:'COMPLETE',changed:true};
    }
    if(!raider && now-m.createdTick>
       Math.max(30,m.spawnTicks||0)+30) {
      m.phase='ABORTED';m.abortTick=now;
      return {status:'ABORTED',reason:m.reason,changed:true};
    }
    return {status:'RETREAT',changed:false};
  }
  if(now-m.createdTick>MAX_DURATION)
    return retreat('RAID_OPERATION_TIMED_OUT');
  const home=game.rooms[m.parent];
  if(!home?.controller?.my ||
     (Number(home.controller.safeMode)||0)>0 ||
     (Number(home.controller.safeModeCooldown)||0)>0)
    return retreat('HOME_DEFENSE_UNSAFE');
  if(typeof FIND_HOSTILE_CREEPS==='undefined' ||
     typeof home.find!=='function')
    return retreat('HOME_THREAT_OBSERVATION_MISSING');
  let hostiles;
  try {hostiles=home.find(FIND_HOSTILE_CREEPS);}
  catch(_){return retreat('HOME_THREAT_OBSERVATION_FAILED');}
  if(!Array.isArray(hostiles) || hostiles.length)
    return retreat('HOME_UNDER_ATTACK');
  const target=game.rooms[m.target];
  if(target) {
    if(target.controller?.my!==false ||
       target.controller.owner?.username!==m.aggressor ||
       (Number(target.controller.safeMode)||0)>0)
      return retreat('ENEMY_OWNERSHIP_OR_SAFEMODE_CHANGED');
    if(typeof FIND_HOSTILE_STRUCTURES==='undefined' ||
       typeof target.find!=='function')
      return retreat('TARGET_TOWER_OBSERVATION_UNVERIFIED');
    let structures;
    try {structures=target.find(FIND_HOSTILE_STRUCTURES);}
    catch(_){return retreat('TARGET_TOWER_OBSERVATION_FAILED');}
    if(!Array.isArray(structures) ||
       structures.some(s=>s?.structureType===STRUCTURE_TOWER))
      return retreat('TARGET_TOWER_APPEARED');
    m.targetOwnerSeenTick=now;
  }
  if(!raider && now-m.createdTick>(m.spawnTicks||0)+15) {
    m.phase='ABORTED';m.abortTick=now;m.reason='RAIDER_NOT_BORN_OR_LOST';
    return {status:'ABORTED',reason:m.reason,changed:true};
  }
  if(raider?.room?.name===m.parent && raider?.hitsMax &&
     raider.hits/raider.hitsMax<0.75)
    return retreat('HOME_RAIDER_CASUALTIES');
  return {status:'ATTACKING',changed:false};
}
module.exports={start,supervise,_test:{parts,parentReady,neighbor}};
