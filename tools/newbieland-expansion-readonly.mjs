// Newbieland expansion diagnosis — authenticated GET-only game observation.
// No code upload, spawn, controller, memory, or branch mutation.
import { pathToFileURL } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { summarizeRetainedIntelFrontier } from './newbieland-intel-frontier.mjs';
import { ScreepsHttpClient } from './screeps-client.mjs';
import { parseBotMemory, summarizeExpansionEvidence } from './ci-deployment-guard.mjs';

const HOME = 'E8N1';
const BRANCH = 'chatgpt';
const goodTick = n => Number.isSafeInteger(n) && n >= 0 && n <= 2_000_000_000;

// Read-only snapshot fields already emitted by game/main.js; all missing or
// logger-truncated values remain null. This does not assess safety independently.
export function summarizeParentBlockerEvidence(snapshot, homeRoom = HOME) {
  const x = snapshot?.x;
  const room = x?.rooms?.[homeRoom];
  if (!room || typeof room !== 'object' || Array.isArray(room))
    return null;
  const token = value => typeof value === 'string' &&
    /^[A-Z][A-Z0-9_]{0,79}$/.test(value) ? value : null;
  const tokens = values => Array.isArray(values) &&
    values.length <= 16 && values.every(v => token(v) !== null)
      ? values.slice() : null;
  const count = value => Number.isSafeInteger(value) &&
    value >= 0 && value <= 10000000 ? value : null;
  // Hauler carry *deficit* is signed: negative values mean surplus. Do not
  // misclassify a supported parent as UNKNOWN solely because it has surplus.
  const signedDeficit = value => Number.isFinite(value) &&
    value >= -10000 && value <= 10000 ? value : null;
  const health = room.health;
  const readiness = x.expansionReadiness;
  return {
    snapshotTick: snapshot?.t ?? null,
    status: 'RETAINED_SNAPSHOT_ONLY',
    currentGameTickVerified: false,
    readinessReasons: tokens(readiness?.reasons),
    parentHealthStatus: token(health?.status),
    parentHealthScore: count(health?.overallScore) !== null &&
      health.overallScore <= 100 ? health.overallScore : null,
    parentHealthReasons: tokens(health?.reasons),
    hostilesAtSnapshot: count(room.hostiles),
    infrastructureEnergyAvailable: count(room.energyAvailable),
    infrastructureEnergyCapacity: count(room.energyCapacity),
    roomStoredEnergy: count(room.energyStored),
    safeModeTicks: count(room.safeModeRemainingTicks),
    safeModeCooldownTicks: count(room.safeModeCooldownRemainingTicks),
    modeledHaulerCarryDeficit: signedDeficit(room.economyModel?.haulerCarryDeficit),
    modeledWaitingConsumers: count(room.economyModel?.consumerWaitingCount),
    modeledFallbackConsumers: count(room.economyModel?.consumerFallbackCount)
  };
}


// Independent GET /api/game/room-objects evidence. Room objects and retained
// game STATUS_SNAPSHOTs do not share a proven tick. Foreign ownership is not
// equivalent to Game.FIND_HOSTILE_CREEPS (allies may appear here).
export function summarizeRoomDefenseObjects(reply, me) {
  const objects=reply?.objects;
  const self=me?._id ?? me?.id;
  if (typeof self!=='string' || !self || !Array.isArray(objects) ||
      objects.length>2500)
    return {status:'UNVERIFIED',reason:'ROOM_OBJECTS_OR_AUTH_UNAVAILABLE'};
  const type=o=>o?.type ?? o?.structureType;
  const owned=o=>String(o?.user ?? '')===self;
  const creeps=objects.filter(o=>type(o)==='creep');
  const towers=objects.filter(o=>type(o)==='tower' && owned(o));
  const otherCreeps=creeps.filter(o=>o?.user!=null && !owned(o));
  const unknownOwnership=creeps.filter(o=>o?.user==null).length;
  const energy=t=>{
    const amount=t?.store?.energy ?? t?.energy;
    return Number.isSafeInteger(amount) && amount>=0 && amount<=10000
      ? amount:null;
  };
  const towerEnergy=towers.map(energy);
  const allEnergyKnown=towerEnergy.every(x=>x!==null);
  const countActiveCombat=c=>{
    if (!Array.isArray(c?.body) || c.body.length>50 ||
        c.body.some(part=>!part || typeof part.type!=='string' ||
          !Number.isSafeInteger(part.hits) || part.hits<0 ||
          part.hits>100)) return null;
    return c.body.filter(part=>part.hits>0 &&
      ['attack','ranged_attack','work','heal'].includes(part.type)).length;
  };
  const foreignCombat=otherCreeps.map(countActiveCombat);
  const trustedBody=foreignCombat.every(v=>v!==null);
  const activeTypes=['attack','ranged_attack','heal','work','tough'];
  const activeForeignParts=trustedBody
    ?Object.fromEntries(activeTypes.map(type=>[type,
      otherCreeps.reduce((total,c)=>total+
        c.body.filter(part=>part.hits>0&&part.type===type).length,0)]))
    :null;
  const soleForeign=otherCreeps.length===1?otherCreeps[0]:null;
  // Room-object GET can report a creep's current durability and boosts, but
  // still cannot prove that the same creep persisted across independent GETs.
  const hits=v=>Number.isSafeInteger(v)&&v>=0&&v<=5000?v:null;
  const foreignHits=soleForeign?hits(soleForeign.hits):null;
  const foreignHitsMax=soleForeign?hits(soleForeign.hitsMax):null;
  const foreignHealthVerified=foreignHits!==null &&
    foreignHitsMax!==null && foreignHitsMax>0 &&
    foreignHits<=foreignHitsMax;
  const bodyBoostsVerified=!!soleForeign&&trustedBody&&
    soleForeign.body.every(part=>part.boost==null ||
      (typeof part.boost==='string' &&
       /^[A-Za-z0-9]{1,10}$/.test(part.boost)));
  const activeBoosted=bodyBoostsVerified?
    soleForeign.body.filter(part=>part.hits>0&&part.boost!=null):null;
  const pos=o=>Number.isSafeInteger(o?.x)&&o.x>=0&&o.x<50 &&
    Number.isSafeInteger(o?.y)&&o.y>=0&&o.y<50;
  const positionsVerifiable=towers.length>0&&otherCreeps.length>0&&
    [...towers,...otherCreeps].every(pos);
  const ranges=positionsVerifiable?towers.flatMap(t=>otherCreeps.map(c=>
    Math.max(Math.abs(t.x-c.x),Math.abs(t.y-c.y)))):[];
  return {
    status:'ROOM_OBJECTS_GET_OBSERVED',room:HOME,
    currentGameTickVerified:false,gameHostilityVerified:false,
    crossSnapshotSameTickVerified:false,
    ownSpawnObjects:objects.filter(o=>type(o)==='spawn'&&owned(o)).length,
    ownTowerObjects:towers.length,
    ownTowersWithEnergyKnown:towerEnergy.filter(v=>v!==null).length,
    towersReadyToAttack:allEnergyKnown?
      towerEnergy.filter(v=>v>=10).length:null,
    towerEnergySum:allEnergyKnown?
      towerEnergy.reduce((a,v)=>a+v,0):null,
    roomLocalOwnedCreeps:creeps.filter(owned).length,
    otherOwnerCreeps:otherCreeps.length,
    unknownOwnerCreeps:unknownOwnership,
    otherOwnerCombatOrSupportCreeps:foreignCombat.every(v=>v!==null)?
      foreignCombat.filter(v=>v>0).length:null,
    otherOwnerUnarmedCreeps:trustedBody?
      foreignCombat.filter(v=>v===0).length:null,
    otherOwnerActiveParts:activeForeignParts,
    soleForeignCreepHits:foreignHealthVerified?foreignHits:null,
    soleForeignCreepHitsMax:foreignHealthVerified?foreignHitsMax:null,
    soleForeignCreepActiveBoostedToughParts:activeBoosted?
      activeBoosted.filter(part=>part.type==='tough').length:null,
    soleForeignCreepActiveBoostedNonToughParts:activeBoosted?
      activeBoosted.filter(part=>part.type!=='tough').length:null,
    closestTowerToForeignCreepRange:positionsVerifiable?
      Math.min(...ranges):null,
    furthestTowerToForeignCreepRange:positionsVerifiable?
      Math.max(...ranges):null
  };
}

// Compare two separate GET responses in ONE isolated diagnostic job. Opaque
// object IDs are used solely in memory to check identity; never emit names,
// IDs, hashes, coordinates or owner names. Wall time != server game ticks.
export function compareRoomDefenseGetPairs(first,second,me) {
  const id=me?._id ?? me?.id;
  const roomCreeps=value=>{
    if(!Array.isArray(value?.objects) || value.objects.length>2500)
      return null;
    return value.objects.filter(o=>o?.type==='creep' &&
      typeof o.user==='string' && o.user!==id);
  };
  const a=roomCreeps(first),b=roomCreeps(second);
  const unknown={status:'UNVERIFIED',reason:'SINGLE_FOREIGN_CREEP_ID_UNVERIFIED',
    gameTickProgressVerified:false,attackIntentOrDamageVerified:false};
  if (typeof id!=='string'||!id||!a||!b||
      a.length!==1||b.length!==1||
      typeof a[0].id!=='string'||!a[0].id||
      typeof b[0].id!=='string'||!b[0].id||
      a[0].user!==b[0].user) return unknown;
  if (a[0].id!==b[0].id) return {
    ...unknown,reason:'FOREIGN_CREEP_ID_CHANGED'
  };
  const validHp=o=>Number.isSafeInteger(o?.hits) &&
    Number.isSafeInteger(o?.hitsMax) &&
    o.hits>=0 && o.hitsMax>0 && o.hits<=o.hitsMax &&
    o.hitsMax<=5000;
  if(!validHp(a[0])||!validHp(b[0]))
    return {...unknown,reason:'FOREIGN_CREEP_HEALTH_UNVERIFIED'};
  return {
    status:'SAME_FOREIGN_CREEP_OBSERVED_TWICE',
    gameTickProgressVerified:false,
    attackIntentOrDamageVerified:false,
    firstHits:a[0].hits,secondHits:b[0].hits,
    firstHitsMax:a[0].hitsMax,secondHitsMax:b[0].hitsMax,
    hpChange:b[0].hits-a[0].hits,
    healthLossObserved:b[0].hits<a[0].hits
  };
}

// Diagnostic TOWER_ENGAGE logging is an issued tower action path, NOT proof
// of actual hits. Lack of retained WARN events cannot prove no attacks.
export function summarizeRetainedTowerEngagements(bot, journalTick) {
  const events=bot?.telemetryJournal?.events;
  if (!goodTick(journalTick) || !Array.isArray(events) ||
      events.length>1500)
    return {status:'UNVERIFIED',reason:'EVENT_WINDOW_NOT_VERIFIABLE'};
  const matched=events.filter(e=>e?.c==='TOWER_ENGAGE' &&
    e?.x?.room===HOME);
  if (matched.some(e=>!goodTick(e.t) || e.t>journalTick))
    return {status:'UNVERIFIED',reason:'TOWER_EVENT_TICK_INVALID'};
  const recent=matched.filter(e=>journalTick-e.t<=150);
  return {
    status:'RETAINED_EVENTS_ONLY',
    journalTick,
    timeWindowJournalTicks:150,
    fullWindowCoverageVerified:false,
    attackSuccessVerified:false,
    eventCount:recent.length,
    lastEventTick:recent.length?Math.max(...recent.map(e=>e.t)):null
  };
}

export function inspectNewbielandExpansion(reply, branches) {
  const active = Array.isArray(branches?.list)
    ? branches.list.filter(item => item?.activeWorld === true) : null;
  // A successful HTTP request alone does not prove that our expected branch
  // owns the active world. Fail closed on zero/ambiguous/mismatched branches.
  if (!active || active.length !== 1 || active[0].branch !== BRANCH)
    return { status: 'UNVERIFIED', reason: 'ACTIVE_BRANCH_NOT_VERIFIED',
      readOnly: true, homeRoom: HOME };

  const bot = parseBotMemory(reply);
  if (!bot) return { status: 'UNVERIFIED',
    reason: 'BOT_MEMORY_NOT_VERIFIABLE', readOnly: true, homeRoom: HOME };
  const journal = bot.telemetryJournal;
  const snapshots = Array.isArray(journal?.snapshots)
    ? journal.snapshots.filter(s => s?.c === 'STATUS_SNAPSHOT' &&
      goodTick(s.t)).sort((a,b) => b.t-a.t) : [];
  if (!snapshots.length)
    return { status: 'UNVERIFIED', reason: 'NO_RETAINED_STATUS_SNAPSHOT',
      readOnly: true, homeRoom: HOME };
  const latest=snapshots[0];
  // Never silently fall back to a previous valid snapshot when the newest
  // snapshot is incomplete: it would present an older support streak as now.
  const evidence=summarizeExpansionEvidence(latest, HOME);
  if (!evidence) return { status: 'UNVERIFIED',
    reason: 'LATEST_ROOM_STATUS_UNAVAILABLE',
    readOnly: true, homeRoom: HOME, snapshotTick: latest.t };
  const events=Array.isArray(journal?.events)?journal.events:[];
  const journalLatestTick=Math.max(latest.t,...events.filter(e=>goodTick(e?.t))
    .map(e=>e.t));
  const ageWithinRetainedJournal=journalLatestTick-latest.t;
  return {
    status:'OBSERVED_RETAINED', readOnly:true, homeRoom:HOME,
    snapshotTick:latest.t, journalLatestTick,
    snapshotLagWithinJournalTicks:ageWithinRetainedJournal,
    // This is not a server-current tick. Absence of journal events does not
    // prove fresh real-time observation.
    currentGameTickVerified:false,
    expansionEvidence:evidence,
    parentBlockerEvidence:summarizeParentBlockerEvidence(latest,HOME),
    retainedTowerEngagements:summarizeRetainedTowerEngagements(bot,journalLatestTick),
    retainedIntelFrontier:summarizeRetainedIntelFrontier(bot,journalLatestTick,HOME)
  };
}

async function main() {
  const api = await ScreepsHttpClient.fromConfig('newbieland');
  const branches = await api.userBranches();
  // Read memory only after verifying the intended active branch.
  const branchState = inspectNewbielandExpansion(null,branches);
  if (branchState.reason === 'ACTIVE_BRANCH_NOT_VERIFIED') {
    console.log('NEWBIELAND_EXPANSION_GET_ONLY '+JSON.stringify(branchState));
    process.exitCode=2;
    return;
  }
  const [reply,me,roomObjects]=await Promise.all([
    api.userMemory('bot'),
    api.authMe().catch(()=>null),
    api.gameRoomObjects(HOME).catch(()=>null)
  ]);
  const result=inspectNewbielandExpansion(reply,branches);
  result.roomDefenseObjects=summarizeRoomDefenseObjects(roomObjects,me);
  // One further GET after 15 seconds, never a gameplay intent. A stable
  // foreign ID with identical HP provides persistence evidence, but does not
  // prove that server ticks advanced or that any attacks were accepted.
  await pause(15000);
  const later=await api.gameRoomObjects(HOME).catch(()=>null);
  result.roomDefenseComparison=compareRoomDefenseGetPairs(
    roomObjects,later,me);
  console.log('NEWBIELAND_EXPANSION_GET_ONLY '+JSON.stringify(result));
  if (result.status!=='OBSERVED_RETAINED') process.exitCode=2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(err=>{
    // Do not print full HTTP configuration, credentials or raw responses.
    console.error('NEWBIELAND_EXPANSION_GET_ONLY_FAILED',
      String(err?.code || 'API_READ_FAILED'));
    process.exitCode=1;
  });
