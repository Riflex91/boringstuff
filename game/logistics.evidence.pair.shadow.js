'use strict';

// U4/E5 read-only alignment of two independent 100-real-tick observations.
// Never divide generic hauler ROLE CPU by a SUBSET of actual deliveries and
// mislabel the quotient as route cost, full throughput or mode-switch ROI.
const SCHEMA_VERSION = 1;
const TICKS = 100;
function nat(n) { return Number.isSafeInteger(n) && n >= 0; }
function finite(n) { return Number.isFinite(n) && n >= 0; }
// Source report values are rounded to four decimal places independently;
// permit only the stated reporting precision, never fabricated magnitudes.
function agreesAtPrecision(a,b) {
  return finite(a) && finite(b) && Math.abs(a-b) <= 0.00011;
}
function deferred(room, now, reason) {
  return {
    schemaVersion:SCHEMA_VERSION,authority:'SHADOW',actionAuthority:'NONE',
    room:room||null,tick:nat(now)?now:null,status:'DEFERRED',reason,
    alignedWindow:null,measuredHaulerRoleCpu:null,
    confirmedConsumerDeliveryLowerBound:null,observedWaiting:null,
    fullRouteEnergyPerTick:null,routeAttributableCpuPerTick:null,
    comparableCostPerEnergy:null,economicWinner:null,
    topologySwitchAuthorized:false
  };
}
function validCpu(x) {
  return !!x && x.schemaVersion===1 && x.authority==='SHADOW_EVIDENCE' &&
    x.actionAuthority==='NONE' &&
    x.source==='MEASURED_CREEP_ROLE_CPU_NOT_ROUTE_CPU' &&
    x.topologySwitchAuthorized===false &&
    nat(x.startTick) && nat(x.endTick) && x.observedTicks===TICKS &&
    x.endTick-x.startTick===TICKS-1 &&
    finite(x.totalRoleCpu) && finite(x.haulerRoleCpuPerTick) &&
    nat(x.totalHaulerCreepTicks) &&
    x.totalHaulerCreepTicks <= TICKS*120 &&
    nat(x.ticksWithActiveHaulers) &&
    x.ticksWithActiveHaulers <= TICKS &&
    agreesAtPrecision(x.haulerRoleCpuPerTick,x.totalRoleCpu/TICKS) &&
    (x.totalHaulerCreepTicks===0 ?
      x.ticksWithActiveHaulers===0 &&
        x.haulerRoleCpuPerCreepTick===null && x.totalRoleCpu===0 :
      x.ticksWithActiveHaulers>0 &&
        x.ticksWithActiveHaulers<=x.totalHaulerCreepTicks &&
        agreesAtPrecision(x.haulerRoleCpuPerCreepTick,
          x.totalRoleCpu/x.totalHaulerCreepTicks)) &&
    x.settledEnergyPerTick===null &&
    x.transportRouteCpuPerTick===null &&
    x.comparableAlternativeCpuPerTick===null;
}
function validDelivery(x, room) {
  if (!x || x.schemaVersion!==5 || x.waitingObservationPhase!=='BEFORE_CREEP_INTENTS' ||
      x.authority!=='SHADOW_EVIDENCE' ||
      x.actionAuthority!=='NONE' || x.room!==room ||
      x.source!=='SCREEPS_PREVIOUS_TICK_SETTLED_TRANSFER_EVENTS' ||
      x.coverage!=='CURRENTLY_VISIBLE_OWNED_HAULER_TO_CONSUMER_CREEP_LOWER_BOUND' ||
      x.topologySwitchAuthorized!==false ||
      x.waitingServiceSuccessRate!==null ||
      x.transportLatencyTicks!==null ||
      x.trueEndToEndTransportLatencyTicks!==null ||
      x.fullTransportEnergyPerTick!==null ||
      x.routeAttributableCpuPerTick!==null ||
      x.alternativeTopologyCost!==null ||
      !nat(x.startGameTick) || !nat(x.endGameTick) ||
      x.startGameTick===0 || x.observedTicks!==TICKS ||
      x.endGameTick-x.startGameTick!==TICKS-1 ||
      x.startEventTick!==x.startGameTick-1 ||
      x.endEventTick!==x.endGameTick-1) return false;
  for(const k of ['confirmedConsumerDeliveryEvents',
    'confirmedConsumerEnergyLowerBound',
    'ticksWithConfirmedConsumerDelivery',
    'confirmedFirstDeliveryForPreviouslyWaitingConsumers',
    'observedWaitingConsumerTicks',
    'observedWaitingConsumerTicksWithLoadedSticky',
    'firstConfirmedReceiptFromSameExclusiveLoadedSticky',
    'firstConfirmedReceiptFromOtherThanExclusiveLoadedSticky',
    'firstConfirmedReceiptWithoutUniqueLoadedSticky',
    'observedWaitingConsumerTicksBeforeFirstReceipt',
    'observedWaitingEpisodeStarts',
    'observedWaitingEpisodesStoppedWithoutHaulerReceipt',
    'observedWaitingEpisodesStoppedAfterHaulerReceipt',
    'observedWaitingEpisodesLostVisibility',
    'maximumConcurrentWaitingConsumersWithoutFirstReceipt',
    'openWaitingEpisodesAtWindowEnd',
    'openWaitingEpisodesWithoutConfirmedReceiptAtWindowEnd']) {
    if (!nat(x[k])) return false;
  }
  return agreesAtPrecision(x.confirmedConsumerEnergyPerTickLowerBound,
      x.confirmedConsumerEnergyLowerBound/TICKS) &&
    x.confirmedConsumerDeliveryEvents <= TICKS*120 &&
    (x.confirmedConsumerDeliveryEvents===0 ?
      x.ticksWithConfirmedConsumerDelivery===0 :
      x.ticksWithConfirmedConsumerDelivery>0 &&
      x.ticksWithConfirmedConsumerDelivery<=
        x.confirmedConsumerDeliveryEvents) &&
    x.confirmedConsumerEnergyLowerBound >= x.confirmedConsumerDeliveryEvents &&
    x.ticksWithConfirmedConsumerDelivery <= TICKS &&
    x.confirmedFirstDeliveryForPreviouslyWaitingConsumers <=
      x.confirmedConsumerDeliveryEvents &&
    x.observedWaitingConsumerTicksWithLoadedSticky <=
      x.observedWaitingConsumerTicks &&
    x.firstConfirmedReceiptFromSameExclusiveLoadedSticky +
      x.firstConfirmedReceiptFromOtherThanExclusiveLoadedSticky +
      x.firstConfirmedReceiptWithoutUniqueLoadedSticky ===
      x.confirmedFirstDeliveryForPreviouslyWaitingConsumers &&
    x.observedWaitingConsumerTicksBeforeFirstReceipt <=
      x.observedWaitingConsumerTicks &&
    x.openWaitingEpisodesWithoutConfirmedReceiptAtWindowEnd <=
      x.openWaitingEpisodesAtWindowEnd &&
    x.openWaitingEpisodesAtWindowEnd <= 120 &&
    x.maximumConcurrentWaitingConsumersWithoutFirstReceipt <= 120;
}
function assess(room, now, cpu, delivery) {
  if(typeof room!=='string'||!room||room.length>20||!nat(now))
    return deferred(room,now,'INVALID_ROOM_OR_TICK');
  if (!cpu) return deferred(room,now,'NO_MEASURED_HAULER_CPU_WINDOW');
  if (!delivery) return deferred(room,now,'NO_SETTLED_CONSUMER_WINDOW');
  if(!validCpu(cpu)||!validDelivery(delivery,room) ||
      cpu.room!=null && cpu.room!==room)
    return deferred(room,now,'INVALID_OR_UNSUPPORTED_E5_EVIDENCE');
  if(cpu.endTick!==now || delivery.endGameTick!==now)
    return deferred(room,now,'STALE_E5_EVIDENCE_WINDOW');
  if(cpu.startTick!==delivery.startGameTick ||
      cpu.endTick!==delivery.endGameTick)
    return deferred(room,now,'NONALIGNED_E5_EVIDENCE_WINDOWS');
  return {
    schemaVersion:SCHEMA_VERSION,authority:'SHADOW',actionAuthority:'NONE',
    room,tick:now,status:'ALIGNED_OBSERVATION',
    reason:'INDEPENDENT_MEASUREMENTS_NOT_ROUTE_COST',
    alignedWindow:{
      gameStartTick:cpu.startTick,gameEndTick:now,observedTicks:TICKS,
      settlementEventStartTick:delivery.startEventTick,
      settlementEventEndTick:delivery.endEventTick
    },
    measuredHaulerRoleCpu:{
      total:cpu.totalRoleCpu,
      perGameTick:cpu.haulerRoleCpuPerTick,
      totalHaulerCreepTicks:cpu.totalHaulerCreepTicks
    },
    confirmedConsumerDeliveryLowerBound:{
      energy:delivery.confirmedConsumerEnergyLowerBound,
      events:delivery.confirmedConsumerDeliveryEvents,
      energyPerGameTick:delivery.confirmedConsumerEnergyPerTickLowerBound
    },
    observedWaiting:{
      consumerTicks:delivery.observedWaitingConsumerTicks,
      consumerTicksWithoutFirstReceipt:
        delivery.observedWaitingConsumerTicksBeforeFirstReceipt,
      episodesStillOpen:delivery.openWaitingEpisodesAtWindowEnd,
      firstConfirmedReceipts:
        delivery.confirmedFirstDeliveryForPreviouslyWaitingConsumers,
      consumerTicksWithLoadedSticky:
        delivery.observedWaitingConsumerTicksWithLoadedSticky,
      firstReceiptsFromSameExclusiveLoadedSticky:
        delivery.firstConfirmedReceiptFromSameExclusiveLoadedSticky,
      firstReceiptsFromDifferentHaulerThanExclusiveSticky:
        delivery.firstConfirmedReceiptFromOtherThanExclusiveLoadedSticky,
      firstReceiptsWithoutUniqueLoadedSticky:
        delivery.firstConfirmedReceiptWithoutUniqueLoadedSticky
    },
    // These independent measurements do not form comparable economics:
    // numerator includes ALL hauler role CPU; denominator excludes deliveries
    // to structures, invisible consumers and other logistics. Not a ratio.
    fullRouteEnergyPerTick:null,routeAttributableCpuPerTick:null,
    comparableCostPerEnergy:null,economicWinner:null,
    topologySwitchAuthorized:false
  };
}
module.exports={SCHEMA_VERSION,assess,_test:{validCpu,validDelivery}};
