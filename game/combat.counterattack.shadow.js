'use strict';

// U11 threat-driven target reconnaissance, with NO attack/spawn/move intents.
// An armed trespasser in our room is not enough to authorize a counterattack.
// Require observed owned target matching that player, a healthy parent, and
// explicit later route/boost/tower/retreat proof before any combat operation.
const SCHEMA_VERSION=1;
const NAME=/^[WE]\d+[NS]\d+$/;
function evaluate(states,intel,aggression,game) {
  const out={schemaVersion:SCHEMA_VERSION,authority:'SHADOW',
    actionAuthority:'NONE',attackActionEnabled:false,
    spawnActionEnabled:false,moveActionEnabled:false,
    status:'HOLD',reason:'AGGRESSION_OR_INTEL_UNVERIFIED',
    candidate:null,unverified:['roomRouteAndThreatTowers',
      'combatVictoryMargin','boostedHealAndTough',
      'defenderGarrisonReserve','retreatRouteAndReinforcementETA',
      'replacementCostAndOpportunityCost']};
  const tick=game?.time;
  if(!Number.isSafeInteger(tick) || tick<0 ||
      !Array.isArray(states) || !aggression ||
      aggression.schemaVersion!==1 ||
      !Array.isArray(aggression.records) ||
      !intel || typeof intel!=='object')return out;
  const stable=states.filter(state =>
    state?.room?.controller?.my===true &&
    state.spawn && !state.emergency &&
    state.health?.status==='HEALTHY' &&
    Number.isFinite(state.energyStored) &&
    state.energyStored>=5000 &&
    Array.isArray(state.hostileCreeps) &&
    state.hostileCreeps.length===0 &&
    (Number(state.room.controller.safeMode)||0)===0 &&
    (Number(state.room.controller.safeModeCooldown)||0)===0);
  if(!stable.length)return {...out,reason:'NO_STABLE_HOME_GARRISON'};
  const candidates=[];
  for(const record of aggression.records.slice(0,16)) {
    if(!record || typeof record.player!=='string' ||
       !NAME.test(record.room||'') ||
       !Number.isSafeInteger(record.tick) ||
       tick-record.tick<0 || tick-record.tick>2000 ||
       !Number.isSafeInteger(record.armedParts) ||
       record.armedParts<=0)continue;
    for(const [name,room] of Object.entries(intel).slice(0,100)) {
      if(!NAME.test(name) || !room ||
         room.roomName!==name ||
         room.controller?.owner!==record.player ||
         room.controller?.my!==false ||
         !Number.isSafeInteger(room.observation?.lastSeenTick) ||
         tick-room.observation.lastSeenTick>150 ||
         tick<room.observation.lastSeenTick ||
         (Number(room.controller.safeMode)||0)>0)continue;
      for(const parent of stable) {
        const distance=game?.map?.getRoomLinearDistance?.(parent.room.name,name);
        if(!Number.isSafeInteger(distance) || distance<1 || distance>3)
          continue;
        const towers=room.structures?.byType?.tower;
        if(!Number.isSafeInteger(towers) || towers<0)continue;
        candidates.push({parentRoom:parent.room.name,targetRoom:name,
          observedAggressor:record.player,lastIncursionTick:record.tick,
          linearRoomDistance:distance,observedTowerCount:towers});
      }
    }
  }
  if(!candidates.length)return {...out,reason:'NO_FRESH_MATCHING_AGGRESSOR_ROOM'};
  candidates.sort((a,b)=>a.observedTowerCount-b.observedTowerCount ||
    a.linearRoomDistance-b.linearRoomDistance ||
    b.lastIncursionTick-a.lastIncursionTick ||
    a.targetRoom.localeCompare(b.targetRoom));
  return {...out,status:'RECON_ADVISORY',
    reason:'COMBAT_OUTCOME_AND_RETREAT_UNVERIFIED',
    candidate:candidates[0]};
}
module.exports={SCHEMA_VERSION,evaluate};
