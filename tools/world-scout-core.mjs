// Discovery and report selection only; room scoring remains in spawn-planner-core.mjs.
const ROOM = /^[WE]\d+[NS]\d+$/;
const SHARD = /^shard\d+$/i;
export function extractWorldRooms(response) {
  const raw = response?.rooms ?? response?.list ?? response?.data?.rooms ?? response?.data;
  let names = [];
  if (Array.isArray(raw)) names = raw.map(x => typeof x === 'string' ? x : x?.room || x?.name || x?._id);
  else if (raw && typeof raw === 'object') names = Object.keys(raw);
  else if (Array.isArray(response)) names = response;
  return [...new Set(names.filter(x => typeof x === 'string' && ROOM.test(x)))].sort();
}
export function sampleWorldRooms(names, max = 24) {
  if (!Number.isInteger(max) || max < 1 || max > 250) throw new Error('Invalid candidate limit');
  const unique = [...new Set(names.filter(x => typeof x === 'string' && ROOM.test(x)))].sort();
  if (unique.length <= max) return unique;
  return Array.from({ length: max }, (_, i) => unique[Math.floor((i + 0.5) * unique.length / max)]);
}
export function verifyShardName(name) {
  if (typeof name !== 'string' || !SHARD.test(name)) throw new Error('Invalid shard name from World API');
  return name;
}
export function selectStrategicWinner(entries) {
  const valid = entries.filter(x => {
    const r = x?.report, s = r?.selected;
    return r?.server === 'world' && r?.shard === x.shard &&
      r?.options?.place === false && r?.options?.deep === true &&
      s && ROOM.test(s.room) && Number.isInteger(s.x) && Number.isInteger(s.y) &&
      s.x > 0 && s.x < 49 && s.y > 0 && s.y < 49 &&
      Number.isFinite(s.strategicScore) &&
      s.deepAnalysis?.freshness === 'fresh-api' &&
      s.statusVerification?.status === 'normal';
  });
  valid.sort((a, b) => b.report.selected.strategicScore - a.report.selected.strategicScore ||
    (b.report.selected.categoryScores?.compositeScore || 0) -
    (a.report.selected.categoryScores?.compositeScore || 0) ||
    a.shard.localeCompare(b.shard) || a.report.selected.room.localeCompare(b.report.selected.room));
  return valid[0] || null;
}
