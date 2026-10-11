'use strict';

// Roadmap U7/D1 stage one: advisory defense capacity requests from D0 only.
// No spawn, Safe Mode, tower, combat, reservation or registry mutation.
const SCHEMA_VERSION = 1;
const AUTHORITY = 'SHADOW';
const MAX_DEMAND = 1000000;
const CORE_TYPES = new Set(['spawn', 'storage', 'terminal', 'tower']);
const DEFENSE_CLASSES = Object.freeze({
  ALERT: 70, DEFENSE: 85, EMERGENCY: 100
});

function positive(value) {
  return Number.isFinite(value) && value > 0
    ? Math.min(MAX_DEMAND, value) : 0;
}
function amount(value) {
  return Math.min(MAX_DEMAND, Math.max(0, Math.ceil(positive(value))));
}
function validTick(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function request(room, name, capability, quantity, base, now, deadlineTick, details) {
  const needed = amount(quantity);
  if(!needed)return null;
  return {
    dedupeKey: 'defense:' + name + ':' + room,
    domain: 'defense',
    kind: 'DEFENSE_' + name.toUpperCase().replace(/-/g,'_'),
    target: { roomName: room },
    demand: {
      capability,
      amount: needed,
      minimumUsefulAmount: 1,
      maximumUsefulAmount: needed
    },
    priority: {
      base,
      urgency: base === 100 ? 100 : base === 85 ? 65 : 35,
      strategicClass: 'DEFENSE'
    },
    deadlineTick: validTick(deadlineTick) && deadlineTick >= now ? deadlineTick : null,
    utility: { current: Math.min(100, needed), marginalModel: 'SATURATING' },
    risk: details.risk,
    evidence: {
      source: 'D0_BOUNDED_THREAT_SHADOW',
      hypothesis: 'provisional-capacity-proxy-not-authoritative-spawn-quota'
    },
    shadow: true
  };
}

function stateResult(room, now, status, reason, specs, extras) {
  const result = {
    schemaVersion: SCHEMA_VERSION,
    authority: AUTHORITY,
    actionAuthority: 'NONE',
    defenseActionEnabled: false,
    spawnActionEnabled: false,
    safeModeActionEnabled: false,
    roomName: room,
    tick: now,
    status,
    reason,
    requestCount: specs.length,
    specs,
    summary: Object.assign({
      schemaVersion: SCHEMA_VERSION,
      authority: AUTHORITY,
      actionAuthority: 'NONE',
      status,reason,roomName:room,tick:now,
      requestCount:specs.length,
      neededByCapability: Object.fromEntries(specs.map(s=>[s.demand.capability,s.demand.amount])),
      riskState:null,hostileCount:0,armedCount:0,
      projectedAssetLossTick:null,
      hasUnknownPathEvidence:false
    }, extras || {})
  };
  return result;
}

function evaluate(state, d0, game) {
  const now = game && game.time;
  const room = state && state.room && state.room.name;
  if(!room || !validTick(now) ||
    !state.room.controller || !state.room.controller.my)
    return stateResult(room || null,validTick(now)?now:null,
      'UNVERIFIED','OWNED_ROOM_OR_TICK_UNVERIFIED',[],{});

  if(!d0 || d0.authority!=='SHADOW' || d0.actionAuthority!=='NONE' ||
    d0.roomName!==room || d0.tick!==now || d0.schemaVersion!==3 ||
    !d0.aggregate || !d0.risk || !d0.access ||
    !Number.isSafeInteger(d0.hostileCount) || d0.hostileCount<0 ||
    !Number.isSafeInteger(d0.armedCount) || d0.armedCount<0 ||
    d0.armedCount>d0.hostileCount) {
    return stateResult(room,now,'UNVERIFIED',
      'FRESH_MATCHING_D0_EVIDENCE_REQUIRED',[],{});
  }

  const extras = {
    riskState:d0.risk.state,
    hostileCount:d0.hostileCount,
    armedCount:d0.armedCount,
    projectedAssetLossTick:null,
    hasUnknownPathEvidence:d0.status!=='READY'
  };
  const danger = d0.risk.state;
  if(!['NORMAL','WATCH','ALERT','DEFENSE','EMERGENCY'].includes(danger))
    return stateResult(room,now,'UNVERIFIED','RISK_STATE_INVALID',[],extras);
  if(d0.status!=='READY')
    return stateResult(room,now,'INCOMPLETE',
      'D0_PATH_OR_BOOST_EVIDENCE_INCOMPLETE',[],extras);
  if(d0.hostileCount===0) {
    if(d0.armedCount!==0 || danger!=='NORMAL')
      return stateResult(room,now,'UNVERIFIED','HOSTILE_COUNTS_INCONSISTENT',[],extras);
    return stateResult(room,now,'CLEAR','NO_LOCAL_HOSTILES',[],extras);
  }
  if(d0.armedCount===0)
    return stateResult(room,now,'WATCH','UNARMED_LOCAL_OBSERVATION_ONLY',[],extras);
  if(!DEFENSE_CLASSES[danger])
    return stateResult(room,now,'UNVERIFIED','RISK_AND_ARMED_COUNT_INCONSISTENT',[],extras);

  const aggregate=d0.aggregate;
  const fields=['meleeDps','rangedDps','dismantlePerTick',
    'healPerTick','effectiveHits'];
  if(fields.some(k=>!Number.isFinite(aggregate[k]) || aggregate[k]<0))
    return stateResult(room,now,'UNVERIFIED','HOSTILE_STRENGTH_UNVERIFIED',[],extras);

  // Proxy capacities are not combat-optimal force calculations: neither a
  // reachable path nor future tower firing/boost effects are assumed.
  const incoming=positive(aggregate.meleeDps)+positive(aggregate.rangedDps);
  const dangerPressure=positive(incoming+positive(aggregate.dismantlePerTick));
  const hostileHealing=positive(aggregate.healPerTick);
  const damageCapacity=amount(Math.max(30,hostileHealing+positive(aggregate.effectiveHits)/50));
  const healCapacity=amount(incoming/2);
  const tankCapacity=amount(incoming*3);

  const critical=Array.isArray(d0.access.criticalAssetsAtRisk)
    ?d0.access.criticalAssetsAtRisk:[];
  const losses=critical.map(x=>x?.earliestLossTick)
    .filter(t=>validTick(t)&&t>=now);
  const deadline=losses.length?Math.min(...losses):null;
  extras.projectedAssetLossTick=deadline;
  const base=DEFENSE_CLASSES[danger];
  const risk=base===100?100:base===85?70:40;
  const details={risk};

  const specs=[];
  function add(name, capability, quantity) {
    const spec=request(room,name,capability,quantity,base,now,deadline,details);
    if(spec)specs.push(spec);
  }
  add('damage','damagePerTick',damageCapacity);
  add('heal','healPerTick',healCapacity);
  add('tanking','effectiveHits',tankCapacity);

  // Only count ACTUALLY observed my tower energy, never assume all towers can
  // shoot or claim an energy reserve without capacity/store evidence.
  let deficit=0;
  let observedTowers=0;
  for(const tower of state.structures || []) {
    if(!tower || tower.structureType!=='tower'||tower.my!==true ||
      !tower.store)continue;
    const energy=Number(tower.store.energy);
    let capacity=typeof tower.store.getCapacity==='function'
      ?tower.store.getCapacity('energy'):null;
    if(!Number.isFinite(energy)||energy<0||
      !Number.isFinite(capacity)||capacity<=0||energy>capacity)
      continue;
    observedTowers++;
    // A bounded energy reserve for two 10-energy shots, capped by tower size.
    deficit+=Math.max(0,Math.min(capacity,20)-energy);
  }
  add('tower-energy','energy',deficit);
  extras.towersWithVerifiedEnergy=observedTowers;

  // Repair already-damaged core assets, not predicted future damage.
  const core=(state.structures || []).filter(x=>x&&x.my===true &&
    CORE_TYPES.has(x.structureType) &&
    Number.isFinite(x.hits)&&Number.isFinite(x.hitsMax) &&
    x.hits>=0&&x.hitsMax>0&&x.hits<x.hitsMax);
  const damage=core.reduce((sum,x)=>Math.min(MAX_DEMAND,
    sum+Math.max(0,x.hitsMax-x.hits)),0);
  add('repair','repairHits',damage);

  // Rampart occupation only when actually observed adjacent to a modeled
  // endangered asset. An existence check is not a verified defense path.
  const protectedIds=new Set(critical.map(x=>x&&x.assetId).filter(Boolean));
  const atRiskStructures=(state.structures||[])
    .filter(x=>x&&protectedIds.has(x.id)&&x.pos);
  let seats=0;
  for(const rampart of state.structures||[]) {
    if(!rampart||rampart.my!==true||rampart.structureType!=='rampart'||!rampart.pos)
      continue;
    if(atRiskStructures.some(a=>a.pos.roomName===rampart.pos.roomName &&
      Math.max(Math.abs(a.pos.x-rampart.pos.x),Math.abs(a.pos.y-rampart.pos.y))<=1))
      seats++;
  }
  add('rampart-occupancy','rampartPositions',Math.min(2,seats));
  extras.armedThreatPressure=amount(dangerPressure);

  return stateResult(room,now,'ADVISORY','BOUNDED_LOCAL_DEFENSE_REQUESTS',
    specs,extras);
}

function telemetrySummary(result) {
  return result && result.summary ? result.summary : null;
}

module.exports={
  SCHEMA_VERSION,AUTHORITY,evaluate,telemetrySummary,
  _test:{amount,request,validTick,positive}
};
