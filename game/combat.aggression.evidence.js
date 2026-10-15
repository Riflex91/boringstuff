'use strict';

// Observed armed trespass is evidence to *investigate*, not proof of actual
// structure damage, not automatic hostility declaration or attack authority.
const SCHEMA_VERSION=1;
const MAX_RECORDS=16;
const MAX_AGE=2000;
const NPC=new Set(['Invader','Source Keeper']);
const PLAYER=/^[A-Za-z0-9_-]{1,40}$/;

function armedParts(creep) {
  if(!creep || !Array.isArray(creep.body))return 0;
  return creep.body.reduce((n,p)=>n+
    (p && p.hits>0 &&
     ['attack','ranged_attack','work'].includes(p.type)?1:0),0);
}
function validRecord(x,tick) {
  return !!x && typeof x.room==='string' &&
    /^[WE]\d+[NS]\d+$/.test(x.room) &&
    typeof x.player==='string' && PLAYER.test(x.player) &&
    !NPC.has(x.player) && Number.isSafeInteger(x.tick) &&
    x.tick>=0 && x.tick<=tick && tick-x.tick<=MAX_AGE &&
    Number.isSafeInteger(x.armedParts) && x.armedParts>0 &&
    x.armedParts<=50;
}
function observe(roomStates,game,memory) {
  const tick=game && game.time;
  if(!Number.isSafeInteger(tick) || tick<0 ||
     !memory || typeof memory.bot!=='object' ||
     !Array.isArray(roomStates))return null;
  const prior=memory.bot.combatAggressionEvidence;
  const records=prior && prior.schemaVersion===SCHEMA_VERSION &&
    Array.isArray(prior.records) ?
    prior.records.filter(x=>validRecord(x,tick)) : [];
  for(const state of roomStates) {
    if(!state || !state.room || state.room.controller?.my!==true ||
       !Array.isArray(state.hostileCreeps))continue;
    const room=state.room.name;
    if(!/^[WE]\d+[NS]\d+$/.test(room))continue;
    for(const hostile of state.hostileCreeps.slice(0,20)) {
      const player=hostile?.owner?.username;
      const parts=armedParts(hostile);
      if(!PLAYER.test(player||'') || NPC.has(player) || !parts)continue;
      const old=records.findIndex(x=>x.player===player && x.room===room);
      if(old!==-1)records.splice(old,1);
      records.push({player,room,tick,armedParts:parts});
    }
  }
  records.sort((a,b)=>b.tick-a.tick ||
    a.player.localeCompare(b.player) || a.room.localeCompare(b.room));
  const value={schemaVersion:SCHEMA_VERSION,tick,records:records.slice(0,MAX_RECORDS)};
  memory.bot.combatAggressionEvidence=value;
  return value;
}
module.exports={SCHEMA_VERSION,observe,_test:{armedParts,validRecord,MAX_AGE}};
