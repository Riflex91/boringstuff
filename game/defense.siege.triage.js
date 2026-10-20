'use strict';

// D4/D5: bounded, deterministic and side-effect-free siege triage.
// No game API calls, no Memory writes, no target movement, no raids.
// Upper bound on hostile body parts matches Screeps' 50-part Creep limit.
const MAX_HOSTILES=40;
const MAX_FRIENDLIES=48;
const MAX_PARTS=50;
function active(part,type) {
  return !!part && part.hits>0 && part.type===type;
}
function range(a,b) {
  if(!a?.pos || !b?.pos || typeof a.pos.getRangeTo!=='function')return null;
  let d;
  try {d=a.pos.getRangeTo(b);} catch (_) {return null;}
  return Number.isSafeInteger(d) && d>=0 && d<=50 ? d : null;
}
function estimatedDamage(hostile,friend) {
  if(!hostile?.pos || !friend?.pos || !Array.isArray(hostile.body) ||
     hostile.body.length>MAX_PARTS)return 0;
  const d=range(hostile,friend);
  if(d===null || d>3)return 0;
  let damage=0;
  for(const part of hostile.body) {
    if(!part || !(part.hits>0))continue;
    // Defensive upper-bound for boosted weapons, rather than trusting
    // unknown BOOSTS metadata or ignoring it altogether.
    const factor=part.boost?4:1;
    if(d<=1 && active(part,'attack'))damage+=30*factor;
    if(d<=3 && active(part,'ranged_attack'))damage+=10*factor;
  }
  return Math.min(6000,damage);
}
function threatSummary(hostiles) {
  if(!Array.isArray(hostiles))return {status:'UNKNOWN',hostiles:null,active:0,
    attackParts:0,rangedParts:0,healingParts:0,dismantleParts:0,
    boostedParts:0};
  if(hostiles.length>MAX_HOSTILES)return {status:'CAP_EXCEEDED',hostiles:hostiles.length,
    active:null,attackParts:null,rangedParts:null,healingParts:null,
    dismantleParts:null,boostedParts:null};
  let activeCount=0, attackParts=0,rangedParts=0,healingParts=0,
    dismantleParts=0,boostedParts=0;
  for(const enemy of hostiles) {
    if(!Array.isArray(enemy?.body) || enemy.body.length>MAX_PARTS)
      return {status:'UNKNOWN',hostiles:hostiles.length,active:null,
        attackParts:null,rangedParts:null,healingParts:null,
        dismantleParts:null,boostedParts:null};
    let armed=false;
    for(const p of enemy.body) {
      if(!p || !(p.hits>0))continue;
      let combat=false;
      if(active(p,'attack')){attackParts++;combat=true;}
      else if(active(p,'ranged_attack')){rangedParts++;combat=true;}
      else if(active(p,'heal')){healingParts++;combat=true;}
      else if(active(p,'work')){dismantleParts++;combat=true;}
      if(combat){armed=true;if(p.boost)boostedParts++;}
    }
    if(armed)activeCount++;
  }
  return {status:'OBSERVED',hostiles:hostiles.length,active:activeCount,
    attackParts,rangedParts,healingParts,dismantleParts,boostedParts};
}
// A marked dying soldier/hauler is rescued BEFORE Tower attack. For a
// threatened but nonlethal wounded Creep, reserve at most one Tower for
// healing and leave the other Towers focused on enemies.
function chooseEmergencyHeal(friends,hostiles) {
  if(!Array.isArray(friends) || !Array.isArray(hostiles) ||
     friends.length>MAX_FRIENDLIES || hostiles.length>MAX_HOSTILES)
    return {status:'UNVERIFIED',target:null,imminent:false,danger:0};
  let chosen=null,mode=-1,danger=0;
  for(const c of friends) {
    if(!c || c.my===false || !c.pos ||
       !Number.isFinite(c.hits) || !Number.isFinite(c.hitsMax) ||
       c.hitsMax<=0 || c.hits<=0 || c.hits>=c.hitsMax)continue;
    let incoming=0;
    for(const e of hostiles)incoming+=estimatedDamage(e,c);
    if(incoming<=0)continue;
    incoming=Math.min(10000,incoming);
    const imminent=incoming>=c.hits;
    const endangered=incoming*2>=c.hits && c.hits<c.hitsMax*0.6;
    if(!imminent && !endangered)continue;
    const urgency=imminent?2:1;
    if(urgency>mode ||
       (urgency===mode && (incoming/Math.max(1,c.hits))>danger) ||
       (urgency===mode && (incoming/Math.max(1,c.hits))===danger &&
        String(c.id||c.name||'')<String(chosen?.id||chosen?.name||''))) {
      chosen=c;
      mode=urgency;
      danger=incoming/Math.max(1,c.hits);
    }
  }
  return chosen?{status:'THREATENED',target:chosen,imminent:mode===2,
    danger:Math.min(100,danger)}
    :{status:'NO_CRITICAL_INJURY',target:null,imminent:false,danger:0};
}
module.exports={estimatedDamage,threatSummary,chooseEmergencyHeal,
  MAX_HOSTILES,MAX_FRIENDLIES};
