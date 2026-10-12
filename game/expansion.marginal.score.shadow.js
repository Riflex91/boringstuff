'use strict';

// I3 bounded marginal reconnaissance score. Scores order candidate *surveys*,
// not colony value, route feasibility, profitability, or claim authorization.
// Do not turn absent economic, defense, remote or CPU inputs into fake zeroes.
const SCHEMA_VERSION = 1;
const MAX_EXITS = 4;
const UNVERIFIED = Object.freeze([
  'plannerQuality','defensePerimeter','remoteYield',
  'creepTravelPathCost','regionalDefenseExposure','terminalTopology',
  'incrementalCpuPerTick','supportOpportunityCost'
]);

function mineralType(record) {
  const v=record?.resources?.mineral?.type;
  return typeof v==='string' && /^[A-Z0-9]{1,3}$/.test(v) ? v : null;
}
function score(record,parent,hops,tick,readiness) {
  const sources=record?.resources?.sourceCount;
  const exits=record?.topology?.exits;
  const lastSeen=record?.observation?.lastSeenTick;
  if (!Number.isSafeInteger(tick) || tick < 0 ||
      !Number.isSafeInteger(hops) || hops < 1 || hops > 3 ||
      !Number.isSafeInteger(sources) || sources < 2 || sources > 3 ||
      !Array.isArray(exits) || exits.length < 1 ||
      exits.length > MAX_EXITS ||
      exits.some(e=>typeof e?.roomName!=='string' || !e.roomName) ||
      !Number.isSafeInteger(lastSeen) || lastSeen > tick ||
      tick-lastSeen > 500 ||
      !parent?.controller || parent.controller.my !== true ||
      !Number.isSafeInteger(readiness?.availableClaimSlots) ||
      readiness.availableClaimSlots < 1) return null;

  const targetMineral=mineralType(record);
  const parentMineral=mineralType(parent);
  const diversity=targetMineral && parentMineral
    ? targetMineral !== parentMineral : null;
  const age=tick-lastSeen;
  const hostileHistory=record?.threat?.lastHostileTick;
  if (hostileHistory !== null && hostileHistory !== undefined &&
      (!Number.isSafeInteger(hostileHistory) || hostileHistory > tick))
    return null;
  const quality=sources*40 + (targetMineral ? 4 : 0) +
    exits.length*2 - (age>150 ? 3 : 0) -
    (hostileHistory == null ? 0 : 5);
  const fit= -hops*15 + (diversity === true ? 6 : 0);
  const unknown=UNVERIFIED.slice();
  if (diversity === null) unknown.push('mineralDiversity');
  return {
    schemaVersion:SCHEMA_VERSION,
    authority:'SHADOW',
    actionAuthority:'NONE',
    status:'PARTIAL_ADVISORY',
    readyForClaim:false,
    scoreModel:'observed-room-quality-empire-fit-v1',
    roomQuality:quality,
    empireFit:fit,
    total:quality+fit,
    observed:{
      sourceCount:sources,
      exitCount:exits.length,
      candidateMineral:targetMineral,
      parentMineral,
      mineralDiversity:diversity,
      roomHops:hops,
      intelAgeTicks:age,
      historicalHostility:hostileHistory !== null &&
        hostileHistory !== undefined
    },
    unknownFactors:unknown
  };
}

module.exports={SCHEMA_VERSION,score};
