'use strict';

// I4 passive parent-colony support preflight. This is a conservative snapshot
// gate, not proof of sustained stability and never issues game actions.
const SCHEMA_VERSION = 1;
const MIN_INFRASTRUCTURE_FILL = 0.9;
const MIN_HAULERS = 2;
const MIN_HARVESTERS = 2;

function validEnergy(value) {
  return Number.isFinite(value) && value >= 0;
}

function assess(state) {
  const evidence = {
    energyAvailable: null,
    energyCapacity: null,
    energyStored: null,
    fillRatio: null,
    haulers: null,
    harvesters: null,
    waitingConsumers: null,
    fallbackConsumers: null
  };
  const base = {
    schemaVersion: SCHEMA_VERSION,
    authority: 'SHADOW',
    claimActionEnabled: false,
    spawnActionEnabled: false,
    supportActionEnabled: false,
    status: 'HOLD',
    reason: null,
    evidence
  };
  if (!state || !state.room || state.room.controller?.my !== true ||
      !state.spawn || state.emergency ||
      !Number.isFinite(state.rcl) || state.rcl < 4 ||
      state.health?.status !== 'HEALTHY' ||
      !Array.isArray(state.hostileCreeps) ||
      state.hostileCreeps.length !== 0 ||
      !Number.isFinite(state.economyModel?.haulerCarryDeficit) ||
      state.economyModel.haulerCarryDeficit > 0)
    return {...base,reason:'PARENT_NOT_STABLE'};

  // U8 safety: a parent that recently needed emergency protection must
  // complete a fresh consecutive support window after protection and
  // cooldown end, even if today's economy/creeps look temporarily healthy.
  // This advisory never activates safe mode or issues expansion intents.
  const controller = state.room.controller;
  if ((Number.isFinite(controller.safeMode) && controller.safeMode > 0) ||
      (Number.isFinite(controller.safeModeCooldown) &&
       controller.safeModeCooldown > 0))
    return {...base,reason:'PARENT_DEFENSE_RECOVERY_INCOMPLETE'};

  const capacity = state.energyCapacityAvailable;
  const stored = state.energyStored;
  if (!validEnergy(capacity) || capacity < 650)
    return {...base,reason:'CLAIMER_ENERGY_CAPACITY_INSUFFICIENT'};
  evidence.energyCapacity = capacity;

  if (!validEnergy(stored) || stored < Math.max(3000,capacity*3))
    return {...base,reason:'PARENT_SUPPORT_RESERVE_INSUFFICIENT'};
  evidence.energyStored = stored;

  const available = state.energyAvailable;
  if (!validEnergy(available) || available > capacity || capacity === 0)
    return {...base,reason:'PARENT_INFRASTRUCTURE_ENERGY_UNVERIFIED'};
  evidence.energyAvailable = available;
  evidence.fillRatio = Math.round(available/capacity*10000)/10000;
  if (available < Math.ceil(capacity*MIN_INFRASTRUCTURE_FILL))
    return {...base,reason:'PARENT_INFRASTRUCTURE_REFILL_PRESSURE'};

  if (!Array.isArray(state.creeps) || state.creeps.length > 120 ||
      state.creeps.some(c=>!c||!c.memory||typeof c.memory.role!=='string'))
    return {...base,reason:'PARENT_WORKFORCE_UNVERIFIED'};
  const living=state.creeps.filter(c=>!c.spawning);
  const haulers=living.filter(c=>c.memory.role==='hauler').length;
  const harvesters=living.filter(c=>c.memory.role==='harvester').length;
  const consumers=living.filter(c=>['worker','builder','repairer','upgrader']
    .includes(c.memory.role));
  const waiting=consumers.filter(c=>
    Number(c.memory.waitingEnergyTicks)>0).length;
  const fallback=consumers.filter(c=>!!c.memory.logisticsFallback).length;
  Object.assign(evidence,{
    haulers,harvesters,waitingConsumers:waiting,fallbackConsumers:fallback
  });
  if (haulers<MIN_HAULERS || harvesters<MIN_HARVESTERS)
    return {...base,reason:'PARENT_MINING_OR_HAULING_REDUNDANCY_LOW'};
  if (waiting>0 || fallback>0)
    return {...base,reason:'PARENT_CONSUMER_SUPPLY_PRESSURE'};
  return {...base,status:'ADVISORY_OK',reason:null};
}

module.exports={SCHEMA_VERSION,assess,_test:{
  MIN_INFRASTRUCTURE_FILL,MIN_HAULERS,MIN_HARVESTERS
}};
