export function evaluateD0Shadow({ events, startTick, tickCount = 100, roomName = 'E8N1' }) {
  if (!Number.isInteger(startTick) || startTick < 0 || !Number.isInteger(tickCount) || tickCount < 25) throw new Error('Invalid verification window');
  const endTick = startTick + tickCount - 1;
  const window = events.filter(e => e.tick >= startTick && e.tick <= endTick);
  const snapshots = window.filter(e => e.code === 'STATUS_SNAPSHOT');
  const samples = snapshots.map(e => ({ tick: e.tick, model: e.ctx?.rooms?.[roomName]?.threatModel,
    scheduler: e.ctx?.scheduler?.processes?.['threat-model-shadow'] }));
  const checks = [];
  const check = (id, ok, message) => checks.push({ id, status: ok ? 'PASS' : 'FAIL', message });
  const complete = events.some(e => e.tick >= endTick);
  check('window-complete', complete, `Evidence must reach tick ${endTick}.`);
  check('threat-evidence', samples.length > 0 && samples.every(s => s.model), 'Every observed room snapshot must contain D0 evidence.');
  const present = samples.filter(s => s.model);
  check('shadow-authority', present.length > 0 && present.every(({ model: m }) => m.authority === 'SHADOW' && m.actionAuthority === 'NONE' && m.safetyAuthority === 'LEGACY_UNCHANGED'), 'D0 must remain observational with no Safe Mode authority.');
  check('model-contract', present.length > 0 && present.every(({ model: m, tick }) => {
    const nonnegative = n => Number.isFinite(n) && n >= 0;
    return m.schemaVersion === 3 && ['READY', 'PARTIAL'].includes(m.status) && m.tick === tick &&
      Number.isInteger(m.hostileCount) && m.hostileCount >= 0 && Number.isInteger(m.armedCount) && m.armedCount >= 0 && m.armedCount <= m.hostileCount &&
      ['NORMAL', 'WATCH', 'ALERT', 'DEFENSE', 'EMERGENCY'].includes(m.riskState) &&
      (!m.hostileCount ? m.riskState === 'NORMAL' && m.assetsAtRisk === 0 : m.riskState !== 'NORMAL') &&
      typeof m.recommendedSafeMode === 'boolean' && (!m.recommendedSafeMode || m.riskState === 'EMERGENCY') &&
      m.coreLossProbability === null && Number.isInteger(m.pathSearches) && m.pathSearches >= 0 && m.pathSearches <= 4 &&
      Number.isInteger(m.unknownPaths) && m.unknownPaths >= 0 && Number.isInteger(m.assetsAtRisk) && m.assetsAtRisk >= 0 &&
      Number.isInteger(m.breachPaths) && m.breachPaths >= 0 && m.breachPaths <= m.pathSearches &&
      Number.isInteger(m.sharedBarrierGroups) && m.sharedBarrierGroups >= 0 && m.sharedBarrierGroups <= m.breachPaths &&
      Number.isInteger(m.coordinatedAssets) && m.coordinatedAssets >= 0 && m.coordinatedAssets <= m.assetsAtRisk &&
      (m.earliestLossTick === null ? m.assetsAtRisk === 0 : Number.isInteger(m.earliestLossTick) && m.earliestLossTick >= tick && m.assetsAtRisk > 0) &&
      (m.earliestImpactTick === null || Number.isInteger(m.earliestImpactTick) && m.earliestImpactTick >= tick) &&
      ['meleeDps', 'rangedDps', 'healPerTick', 'dismantlePerTick', 'effectiveTough', 'mobility'].every(k => nonnegative(m.aggregate?.[k]));
  }), 'Counts, strengths, current tick, risk states and bounded path work must be valid.');
  check('scheduler-isolation', samples.length > 0 && samples.every(s => s.scheduler?.lastRunTick === s.tick && Number.isFinite(s.scheduler.lastCpu) && s.scheduler.lastCpu >= 0), 'D0 must have independent current-tick scheduler evidence.');
  check('cpu-budget', samples.length > 0 && samples.every(s => Number.isFinite(s.scheduler?.lastCpu) && s.scheduler.lastCpu <= 5), 'D0 isolated CPU must stay at or below 5.');
  checks.push({ id: 'combat-observation', status: present.some(s => s.model.armedCount > 0) ? 'PASS' : 'WATCH', message: 'A peaceful live window does not validate combat predictions; attack fixtures remain required.' });
  const counts = { pass: checks.filter(c => c.status === 'PASS').length, watch: checks.filter(c => c.status === 'WATCH').length, fail: checks.filter(c => c.status === 'FAIL').length };
  return { startTick, endTick, complete, counts, outcome: counts.fail ? 'FAIL' : counts.watch ? 'WATCH' : 'PASS', checks, latest: present.at(-1)?.model || null };
}
