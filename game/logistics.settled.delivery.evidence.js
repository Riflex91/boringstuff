'use strict';

// E5 passive settlement witness. Screeps Room.getEventLog() contains events
// executed on the PREVIOUS tick, unlike transfer()'s scheduled OK intent.
// Count ONLY unambiguous own hauler -> own consumer-creep energy transfers.
// This is a conservative lower bound, NOT all infrastructure deliveries, route
// throughput, transport CPU, delivery latency or authorization for switching.
const SCHEMA_VERSION = 5;
const WINDOW_TICKS = 100;
const MAX_ROOMS = 3;
const MAX_CREEPS = 120;
const MAX_EVENTS_PER_ROOM = 250;
const CONSUMERS = Object.freeze({
  worker:true,builder:true,repairer:true,upgrader:true
});

function isInt(n) { return Number.isSafeInteger(n) && n >= 0; }
function newWindow(gameTick) {
  return {startGameTick:gameTick,lastGameTick:null,ticks:0,
    deliveryEvents:0,deliveredEnergy:0,ticksWithDelivery:0,
    firstConfirmedWaitingDeliveries:0,
    sampledWaitingTicksToFirstDeliveryTotal:0,
    maxSampledWaitingTicksToFirstDelivery:0,
    waitingConsumerTicks:0,waitingConsumerTicksBeforeFirstReceipt:0,
    waitingEpisodeObservedStarts:0,
    waitingEpisodesStoppedWithoutObservedReceipt:0,
    waitingEpisodesStoppedAfterObservedReceipt:0,
    waitingEpisodesLostVisibility:0,
    maxConcurrentUnservedWaitingConsumers:0,
    waitingConsumerTicksWithLoadedSticky:0,
    firstReceiptFromSameExclusiveLoadedSticky:0,
    firstReceiptFromOtherThanExclusiveLoadedSticky:0,
    firstReceiptWithoutUniqueLoadedSticky:0};
}
function ensure(memory) {
  if (!memory.bot) memory.bot = {};
  let record=memory.bot.e5SettledConsumerEnergy;
  if (!record || record.schemaVersion !== SCHEMA_VERSION ||
      !record.rooms || typeof record.rooms !== 'object' ||
      Array.isArray(record.rooms)) {
    record={schemaVersion:SCHEMA_VERSION,rooms:{}};
    memory.bot.e5SettledConsumerEnergy=record;
  }
  return record;
}
function validWindow(w, allowCompleted = false) {
  return !!w && isInt(w.startGameTick) &&
    isInt(w.ticks) && w.ticks <= (allowCompleted ? WINDOW_TICKS : WINDOW_TICKS-1) &&
    isInt(w.deliveryEvents) && isInt(w.deliveredEnergy) &&
    isInt(w.ticksWithDelivery) && w.ticksWithDelivery <= w.ticks &&
    isInt(w.firstConfirmedWaitingDeliveries) &&
    isInt(w.sampledWaitingTicksToFirstDeliveryTotal) &&
    isInt(w.maxSampledWaitingTicksToFirstDelivery) &&
    w.firstConfirmedWaitingDeliveries <= w.ticks*MAX_CREEPS &&
    ['waitingConsumerTicks','waitingConsumerTicksBeforeFirstReceipt',
      'waitingEpisodeObservedStarts',
      'waitingEpisodesStoppedWithoutObservedReceipt',
      'waitingEpisodesStoppedAfterObservedReceipt',
      'waitingEpisodesLostVisibility',
      'maxConcurrentUnservedWaitingConsumers',
      'waitingConsumerTicksWithLoadedSticky',
      'firstReceiptFromSameExclusiveLoadedSticky',
      'firstReceiptFromOtherThanExclusiveLoadedSticky',
      'firstReceiptWithoutUniqueLoadedSticky'].every(k=>isInt(w[k])) &&
    w.waitingConsumerTicksWithLoadedSticky<=w.waitingConsumerTicks &&
    w.firstReceiptFromSameExclusiveLoadedSticky +
      w.firstReceiptFromOtherThanExclusiveLoadedSticky +
      w.firstReceiptWithoutUniqueLoadedSticky ===
      w.firstConfirmedWaitingDeliveries &&
    w.waitingConsumerTicks <= w.ticks*MAX_CREEPS &&
    w.waitingConsumerTicksBeforeFirstReceipt <= w.waitingConsumerTicks &&
    w.waitingEpisodeObservedStarts <= w.waitingConsumerTicks &&
    w.maxConcurrentUnservedWaitingConsumers <= MAX_CREEPS &&
    w.waitingEpisodesStoppedWithoutObservedReceipt +
      w.waitingEpisodesStoppedAfterObservedReceipt +
      w.waitingEpisodesLostVisibility <= w.ticks*MAX_CREEPS &&
    (w.firstConfirmedWaitingDeliveries === 0 ?
      w.sampledWaitingTicksToFirstDeliveryTotal === 0 &&
      w.maxSampledWaitingTicksToFirstDelivery === 0 :
      w.sampledWaitingTicksToFirstDeliveryTotal >=
        w.maxSampledWaitingTicksToFirstDelivery) &&
    (w.ticks === 0 ? w.lastGameTick === null :
      isInt(w.lastGameTick) &&
      w.lastGameTick - w.startGameTick === w.ticks - 1);
}
// Snapshot waiting IDs and loaded sticky assignments BEFORE creep intents.
// transfer() === OK is only an accepted intent, not engine-settled delivery.
// A sticky reservation may exist without a real subsequent transfer.
function capturePreIntentWaiting(states,game) {
  const now=game && game.time;
  if (!isInt(now) || now < 1 || !Array.isArray(states) ||
      states.length > MAX_ROOMS) return null;
  const rooms=Object.create(null);
  for (const state of states) {
    const room=state && state.room && state.room.name;
    const creeps=state && state.creeps;
    if (typeof room!=='string'||!room||room.length>20 ||
        Object.prototype.hasOwnProperty.call(rooms,room) ||
        !Array.isArray(creeps)||creeps.length>MAX_CREEPS) return null;
    const seen=new Set(), consumers=[],waiting=[];
    for(const c of creeps) {
      if(!c||c.spawning||!c.memory) continue;
      if(typeof c.id!=='string'||!c.id||seen.has(c.id))return null;
      seen.add(c.id);
      if(!CONSUMERS[c.memory.role])continue;
      consumers.push(c.id);
      const n=c.memory.waitingEnergyTicks;
      if(n!=null&&!isInt(n))return null;
      if((n||0)>0||!!c.memory.logisticsFallback)waiting.push(c.id);
    }
    // Capture loaded sticky assignments before creep intents. Duplicate
    // carriers still count for coverage but cannot identify a unique actor.
    const waited=new Set(waiting), counts=Object.create(null),
      exclusive=Object.create(null);
    for(const c of creeps) {
      if(!c||c.spawning||!c.memory||c.memory.role!=='hauler'||
          !waited.has(c.memory.consumerTargetId))continue;
      const carried=c.store && Number(c.store[RESOURCE_ENERGY]);
      if(!Number.isSafeInteger(carried)||carried<=0)continue;
      const target=c.memory.consumerTargetId;
      counts[target]=(counts[target]||0)+1;
      if(counts[target]===1)exclusive[target]=c.id;
      else delete exclusive[target];
    }
    rooms[room]={
      consumerIds:consumers.sort(),
      waitingConsumerIds:waiting.sort(),
      loadedStickyConsumerIds:Object.keys(counts).sort(),
      exclusiveLoadedStickyHaulerByConsumer:exclusive
    };
  }
  return {tick:now,rooms};
}
function inspectRoom(state, includeConsumers = false, preIntent = null) {
  const creeps=state && state.creeps;
  const room=state && state.room;
  if (!room || typeof room.getEventLog !== 'function' ||
      !Array.isArray(creeps) || creeps.length > MAX_CREEPS ||
      typeof EVENT_TRANSFER === 'undefined' ||
      typeof RESOURCE_ENERGY === 'undefined') return null;
  const haulers=new Set(),consumers=new Set(),identities=new Set();
  const waitingConsumers=[];
  for (const c of creeps) {
    if (!c || c.spawning || !c.memory) continue;
    const id=c.id;
    if (typeof id !== 'string' || !id || identities.has(id)) return null;
    identities.add(id);
    if (c.memory.role === 'hauler') haulers.add(id);
    else if (CONSUMERS[c.memory.role]) {
      consumers.add(id);
      const waited=c.memory.waitingEnergyTicks;
      if (waited != null && !isInt(waited)) return null;
      if ((waited || 0) > 0 || !!c.memory.logisticsFallback)
        waitingConsumers.push(id);
    }
  }
  let events;
  try { events=room.getEventLog(); } catch (_) { return null; }
  if (!Array.isArray(events) || events.length > MAX_EVENTS_PER_ROOM) return null;
  let deliveredEnergy=0,deliveryEvents=0;
  const actors=new Set(), deliveredConsumerIds=[], deliveredActorTargets=[];
  for (const e of events) {
    if (!e || e.event !== EVENT_TRANSFER ||
        !haulers.has(e.objectId)) continue;
    // A malformed energy transfer by one of our haulers cannot be interpreted
    // as "no delivery"; incomplete event data breaks the evidence window.
    if (!e.data || typeof e.data !== 'object' ||
        typeof e.data.targetId !== 'string' ||
        typeof e.data.resourceType !== 'string') return null;
    if (!consumers.has(e.data.targetId) ||
        e.data.resourceType !== RESOURCE_ENERGY) continue;
    // The only counted source is an owned hauler; the only destination is an
    // owned worker-type Creep. withdraw() from a Creep is impossible.
    // A real event, unlike an accepted transfer intent, is settled evidence.
    const amount=e.data.amount;
    if (!Number.isSafeInteger(amount) || amount <= 0 ||
        actors.has(e.objectId) ||
        !Number.isSafeInteger(deliveredEnergy + amount))
      return null;
    actors.add(e.objectId);
    deliveredEnergy+=amount;
    deliveryEvents++;
    if (includeConsumers) {
      deliveredConsumerIds.push(e.data.targetId);
      deliveredActorTargets.push({consumerId:e.data.targetId,haulerId:e.objectId});
    }
  }
  const result={deliveredEnergy,deliveryEvents,rawEventCount:events.length};
  if (includeConsumers) {
    // In production an exact BEFORE_INTENTS census is mandatory. Refuse to
    // substitute post-intent memory: it can claim a premature wait recovery.
    const current=[...consumers].sort();
    const saved=preIntent && preIntent.consumerIds;
    const waiting=preIntent && preIntent.waitingConsumerIds;
    const loaded=preIntent && preIntent.loadedStickyConsumerIds;
    const exclusive=preIntent && preIntent.exclusiveLoadedStickyHaulerByConsumer;
    if(!Array.isArray(saved)||!Array.isArray(waiting) ||
       !Array.isArray(loaded)||!exclusive||
       typeof exclusive!=='object'||Array.isArray(exclusive)||
       saved.length!==current.length ||
       saved.some((id,i)=>id!==current[i]) ||
       waiting.length>saved.length ||
       waiting.some((id,i)=>typeof id!=='string'||
         !saved.includes(id)||(i>0&&waiting[i-1]>=id)) ||
       loaded.length>waiting.length ||
       loaded.some((id,i)=>!waiting.includes(id)||
         (i>0&&loaded[i-1]>=id)) ||
       Object.entries(exclusive).some(([id,actor])=>
         !loaded.includes(id)||typeof actor!=='string'||!actor||
         !haulers.has(actor)) ||
       new Set(Object.values(exclusive)).size!==
         Object.keys(exclusive).length)return null;
    result.deliveredConsumerIds=deliveredConsumerIds;
    result.deliveredActorTargets=deliveredActorTargets;
    result.waitingConsumerIds=waiting.slice();
    result.loadedStickyConsumerIds=loaded.slice();
    result.exclusiveLoadedStickyHaulerByConsumer={...exclusive};
    result.visibleConsumerIds=current;
  }
  return result;
}
function summarize(w,room) {
  return {
    schemaVersion:SCHEMA_VERSION,authority:'SHADOW_EVIDENCE',
    source:'SCREEPS_PREVIOUS_TICK_SETTLED_TRANSFER_EVENTS',
    waitingObservationPhase:'BEFORE_CREEP_INTENTS',
    coverage:'CURRENTLY_VISIBLE_OWNED_HAULER_TO_CONSUMER_CREEP_LOWER_BOUND',
    actionAuthority:'NONE',room,
    startGameTick:w.startGameTick,endGameTick:w.lastGameTick,
    startEventTick:w.startGameTick-1,endEventTick:w.lastGameTick-1,
    observedTicks:w.ticks,confirmedConsumerDeliveryEvents:w.deliveryEvents,
    confirmedConsumerEnergyLowerBound:w.deliveredEnergy,
    confirmedConsumerEnergyPerTickLowerBound:
      Math.round(w.deliveredEnergy / w.ticks * 10000)/10000,
    ticksWithConfirmedConsumerDelivery:w.ticksWithDelivery,
    observedWaitingConsumerTicks:w.waitingConsumerTicks,
    // Pre-intent CARRY-positive reservation COVERAGE, not delivery proof.
    // Exclusive actor match is checked against next tick's real engine event;
    // an ambiguous duplicate or absent reservation is never called a match.
    observedWaitingConsumerTicksWithLoadedSticky:
      w.waitingConsumerTicksWithLoadedSticky,
    firstConfirmedReceiptFromSameExclusiveLoadedSticky:
      w.firstReceiptFromSameExclusiveLoadedSticky,
    firstConfirmedReceiptFromOtherThanExclusiveLoadedSticky:
      w.firstReceiptFromOtherThanExclusiveLoadedSticky,
    firstConfirmedReceiptWithoutUniqueLoadedSticky:
      w.firstReceiptWithoutUniqueLoadedSticky,
    observedWaitingConsumerTicksBeforeFirstReceipt:
      w.waitingConsumerTicksBeforeFirstReceipt,
    observedWaitingEpisodeStarts:w.waitingEpisodeObservedStarts,
    observedWaitingEpisodesStoppedWithoutHaulerReceipt:
      w.waitingEpisodesStoppedWithoutObservedReceipt,
    observedWaitingEpisodesStoppedAfterHaulerReceipt:
      w.waitingEpisodesStoppedAfterObservedReceipt,
    observedWaitingEpisodesLostVisibility:w.waitingEpisodesLostVisibility,
    maximumConcurrentWaitingConsumersWithoutFirstReceipt:
      w.maxConcurrentUnservedWaitingConsumers,
    // These are observed episodes, not complete demand-resolution proofs:
    // "stopped" can mean self-collection, role/memory changes or consumption.
    // Open episodes are right-censored; no success percentage is inferred.
    openWaitingEpisodesAtWindowEnd:null,
    waitingServiceSuccessRate:null,
    confirmedFirstDeliveryForPreviouslyWaitingConsumers:
      w.firstConfirmedWaitingDeliveries,
    sampledWaitingTicksBeforeFirstConfirmedDeliveryTotal:
      w.sampledWaitingTicksToFirstDeliveryTotal,
    averageSampledWaitingTicksBeforeFirstConfirmedDelivery:
      w.firstConfirmedWaitingDeliveries ?
        Math.round(w.sampledWaitingTicksToFirstDeliveryTotal /
          w.firstConfirmedWaitingDeliveries * 10000)/10000 : null,
    maximumSampledWaitingTicksBeforeFirstConfirmedDelivery:
      w.firstConfirmedWaitingDeliveries ?
        w.maxSampledWaitingTicksToFirstDelivery : null,
    trueEndToEndTransportLatencyTicks:null,
    // A previous-tick waiting snapshot + engine transfer event demonstrates
    // sampled waiting duration before a first receipt, NOT route travel time,
    // demand creation time or that all unmet energy was resolved.
    fullTransportEnergyPerTick:null,routeAttributableCpuPerTick:null,
    transportLatencyTicks:null,alternativeTopologyCost:null,
    topologySwitchAuthorized:false
  };
}
function validWaitingHistory(history) {
  if (!history || typeof history!=='object' || Array.isArray(history) ||
      Object.keys(history).length > MAX_CREEPS) return false;
  return Object.entries(history).every(([id,e])=>typeof id==='string' &&
    !!id && e && isInt(e.firstTick) && isInt(e.lastTick) &&
    e.lastTick >= e.firstTick && typeof e.firstSettledObserved==='boolean' &&
    typeof e.lastHadLoadedSticky==='boolean' &&
    (e.lastExclusiveLoadedStickyHaulerId===null ||
      typeof e.lastExclusiveLoadedStickyHaulerId==='string' &&
      !!e.lastExclusiveLoadedStickyHaulerId) &&
    (!e.lastExclusiveLoadedStickyHaulerId||e.lastHadLoadedSticky));
}
function observe(states,game,memory,preIntent) {
  const now=game && game.time, root=memory || (typeof Memory!=='undefined'?Memory:null);
  if (!isInt(now) || now < 1 || !root || !Array.isArray(states) ||
      states.length > MAX_ROOMS) return [];
  const names=states.map(s=>s && s.room && s.room.name);
  if (names.some(n=>typeof n !== 'string' || !n || n.length > 20) ||
      new Set(names).size !== names.length ||
      !preIntent || preIntent.tick!==now || !preIntent.rooms ||
      Object.keys(preIntent.rooms).length!==names.length ||
      names.some(n=>!Object.prototype.hasOwnProperty.call(preIntent.rooms,n)))
    return [];
  const record=ensure(root),done=[];
  for(const state of states.slice().sort((a,b)=>a.room.name.localeCompare(b.room.name))) {
    const name=state.room.name;
    let entry=record.rooms[name];
    if (!entry || !validWindow(entry.window) ||
        !validWaitingHistory(entry.waiting) ||
        (entry.lastProcessedGameTick != null &&
        !isInt(entry.lastProcessedGameTick)) ||
        (entry.window && entry.window.ticks > 0 &&
        entry.lastProcessedGameTick !== entry.window.lastGameTick)) {
      entry={window:newWindow(now),lastWindow:null,lastProcessedGameTick:null,
        waiting:{}};
      record.rooms[name]=entry;
    }
    if(entry.lastProcessedGameTick === now) continue;
    if(isInt(entry.lastProcessedGameTick) && now < entry.lastProcessedGameTick){
      entry.window=newWindow(now);entry.lastWindow=null;entry.waiting={};
    }
    if (entry.window.ticks > 0 && now !== entry.window.lastGameTick+1 ||
        entry.window.ticks === 0 && entry.window.startGameTick !== now) {
      entry.window=newWindow(now);
      entry.lastWindow=null;
      entry.waiting={};
    }
    const measurement=inspectRoom(state,true,preIntent.rooms[name]);
    if(!measurement) {
      // Never convert inaccessible/oversized/invalid event logs to zero.
      entry.window=newWindow(now+1);
      entry.lastWindow=null;
      entry.waiting={};
      entry.lastProcessedGameTick=now;
      continue;
    }
    // Game-time t event log describes settled events from t-1. A waiting
    // record observed at t-1 therefore precedes that actual settlement.
    // Only the FIRST receipt in a contiguous observed waiting episode counts.
    let firstDeliveries=0, waitingTicks=0, maximumWaiting=0;
    let sameReserved=0, otherReserved=0, noUniqueReserved=0;
    const firstRecipientIds=new Set();
    for (const receipt of measurement.deliveredActorTargets) {
      const id=receipt.consumerId;
      const previous=entry.waiting[id];
      if (!previous || previous.lastTick !== now-1 ||
          previous.firstSettledObserved || firstRecipientIds.has(id)) continue;
      const duration=now-previous.firstTick;
      if (!isInt(duration) || duration <= 0) {
        firstDeliveries=-1;break;
      }
      firstRecipientIds.add(id);
      firstDeliveries++;
      const oldSticky=previous.lastExclusiveLoadedStickyHaulerId;
      if(oldSticky) {
        if(oldSticky===receipt.haulerId)sameReserved++;
        else otherReserved++;
      } else noUniqueReserved++;
      waitingTicks+=duration;
      maximumWaiting=Math.max(maximumWaiting,duration);
    }
    if (firstDeliveries < 0 || !isInt(waitingTicks)) {
      entry.window=newWindow(now+1);
      entry.lastWindow=null;entry.waiting={};
      entry.lastProcessedGameTick=now;
      continue;
    }
    const previousWaiting=entry.waiting;
    const visibleIds=new Set(measurement.visibleConsumerIds);
    const waitingIds=new Set(measurement.waitingConsumerIds);
    const loadedIds=new Set(measurement.loadedStickyConsumerIds);
    let observedStarts=0, stoppedWithoutReceipt=0,
      stoppedAfterReceipt=0, lostVisibility=0;
    for (const [id,prior] of Object.entries(previousWaiting)) {
      if (waitingIds.has(id)) continue;
      if (!visibleIds.has(id)) lostVisibility++;
      else if (prior.firstSettledObserved || firstRecipientIds.has(id))
        stoppedAfterReceipt++;
      else stoppedWithoutReceipt++;
    }
    const waiting={};
    for (const id of measurement.waitingConsumerIds) {
      const previous=entry.waiting[id];
      if (!(previous && previous.lastTick===now-1)) observedStarts++;
      const loaded=loadedIds.has(id);
      const sticky=measurement.exclusiveLoadedStickyHaulerByConsumer[id]||null;
      waiting[id]=previous && previous.lastTick===now-1 ?
        {firstTick:previous.firstTick,lastTick:now,
          firstSettledObserved:previous.firstSettledObserved ||
            firstRecipientIds.has(id),
          lastHadLoadedSticky:loaded,
          lastExclusiveLoadedStickyHaulerId:sticky} :
        {firstTick:now,lastTick:now,firstSettledObserved:false,
          lastHadLoadedSticky:loaded,
          lastExclusiveLoadedStickyHaulerId:sticky};
    }
    const unservedWaiting=Object.values(waiting)
      .filter(x=>!x.firstSettledObserved).length;
    entry.waiting=waiting;
    const w=entry.window;
    w.ticks++;
    w.lastGameTick=now;
    w.deliveryEvents+=measurement.deliveryEvents;
    w.deliveredEnergy+=measurement.deliveredEnergy;
    if(measurement.deliveryEvents)w.ticksWithDelivery++;
    w.waitingConsumerTicks+=measurement.waitingConsumerIds.length;
    w.waitingConsumerTicksWithLoadedSticky+=loadedIds.size;
    w.firstReceiptFromSameExclusiveLoadedSticky+=sameReserved;
    w.firstReceiptFromOtherThanExclusiveLoadedSticky+=otherReserved;
    w.firstReceiptWithoutUniqueLoadedSticky+=noUniqueReserved;
    w.waitingConsumerTicksBeforeFirstReceipt+=unservedWaiting;
    w.waitingEpisodeObservedStarts+=observedStarts;
    w.waitingEpisodesStoppedWithoutObservedReceipt+=stoppedWithoutReceipt;
    w.waitingEpisodesStoppedAfterObservedReceipt+=stoppedAfterReceipt;
    w.waitingEpisodesLostVisibility+=lostVisibility;
    w.maxConcurrentUnservedWaitingConsumers=Math.max(
      w.maxConcurrentUnservedWaitingConsumers,unservedWaiting);
    w.firstConfirmedWaitingDeliveries+=firstDeliveries;
    w.sampledWaitingTicksToFirstDeliveryTotal+=waitingTicks;
    w.maxSampledWaitingTicksToFirstDelivery=Math.max(
      w.maxSampledWaitingTicksToFirstDelivery,maximumWaiting);
    if(!isInt(w.deliveryEvents) || !isInt(w.deliveredEnergy) ||
       !isInt(w.firstConfirmedWaitingDeliveries) ||
       !isInt(w.sampledWaitingTicksToFirstDeliveryTotal) ||
       !validWindow(w,true)) {
      entry.window=newWindow(now+1);entry.lastWindow=null;entry.waiting={};
      entry.lastProcessedGameTick=now;
      continue;
    }
    entry.lastProcessedGameTick=now;
    if(w.ticks===WINDOW_TICKS) {
      const result=summarize(w,name);
      result.openWaitingEpisodesAtWindowEnd=Object.keys(waiting).length;
      result.openWaitingEpisodesWithoutConfirmedReceiptAtWindowEnd=
        unservedWaiting;
      // A right-censored open episode must not be treated as failure or
      // disappearance. No service success rate is derivable from this window.
      entry.lastWindow=result;
      done.push(result);
      entry.window=newWindow(now+1);
    }
  }
  for(const name of Object.keys(record.rooms)){
    if(!names.includes(name))delete record.rooms[name];
  }
  return done;
}
function snapshot(room,memory) {
  const record=memory && memory.bot && memory.bot.e5SettledConsumerEnergy;
  return record && record.schemaVersion===SCHEMA_VERSION &&
    record.rooms && record.rooms[room] &&
    record.rooms[room].lastWindow || null;
}
// Expose strict read-only incomplete-window validation to GET-only diagnostics.
// This grants no settlement, assignment, or execution authority.
function validIncompleteWindow(w) { return validWindow(w); }
function validIncompleteWaitingHistory(h) { return validWaitingHistory(h); }
module.exports={observe,snapshot,capturePreIntentWaiting,validIncompleteWindow,
  validIncompleteWaitingHistory,
  _test:{inspectRoom,newWindow,validWindow,validWaitingHistory,summarize}};
