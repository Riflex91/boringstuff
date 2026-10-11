// Discovery and report selection only; room scoring remains in spawn-planner-core.mjs.
const ROOM = /^[WE]\d+[NS]\d+$/;
const SHARD = /^shard(?:\d+|X)$/i;
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
// Candidate discovery only. The EXISTING strategic planner determines the scores.
// Public World may not expose /api/game/rooms or /api/game/world-size.
// Sample a deterministic spatial grid when a reliable room list is unavailable.
export function fallbackProbeRooms(sizeResponse = null, max = 24) {
  if (!Number.isInteger(max) || max < 1 || max > 250)
    throw new Error('Invalid candidate limit');
  const value = sizeResponse && typeof sizeResponse === 'object' ? sizeResponse : {};
  const width = Number(value.width ?? value.size ?? value.worldSize);
  const height = Number(value.height ?? value.size ?? value.worldSize ?? value.width);
  const dimensionsKnown = Number.isInteger(width) && Number.isInteger(height) &&
    width > 0 && height > 0 && width <= 500 && height <= 500;
  // Unknown bounds: deliberately probe only the conservative core of the map.
  // Invalid / unavailable rooms will be rejected by the strategic planner.
  const w = dimensionsKnown ? width : 64;
  const h = dimensionsKnown ? height : 64;
  const axis = (size, divisions) => {
    const low = -Math.ceil(size / 2), high = Math.floor(size / 2) - 1;
    const out = [];
    for (let i = 0; i < divisions; i++) {
      let n = Math.round(low + (high - low) * (i + 0.5) / divisions);
      // Avoid the usual highway coordinates, where start-room controllers are absent.
      if (n >= 0 && n % 10 === 0 && n < high) n++;
      if (n < 0 && (-n - 1) % 10 === 0 && n > low) n--;
      out.push(n);
    }
    return [...new Set(out)];
  };
  // Preserve all original 24 probe positions as the invariant baseline.
  // Later 48/96-room searches must never silently omit previous candidates.
  const grid = (columns, rows) => {
    const rooms = [];
    for (const y of axis(h, rows)) for (const x of axis(w, columns)) {
      const hname = x >= 0 ? 'E' + x : 'W' + (-x - 1);
      const vname = y >= 0 ? 'S' + y : 'N' + (-y - 1);
      rooms.push(hname + vname);
    }
    return [...new Set(rooms)];
  };
  const baseline = grid(6,4);
  if (max <= baseline.length) return baseline.slice(0,max);
  // Add spatially distributed new candidates without rescoring rooms here.
  const columns = Math.max(1, Math.round(Math.sqrt(max * 1.5)));
  const rows = Math.max(1, Math.ceil(max / columns));
  const baseSet = new Set(baseline);
  const additional = grid(columns,rows).filter(room => !baseSet.has(room));
  const capacity = max - baseline.length;
  if (additional.length <= capacity) return [...baseline,...additional];
  const distributed = Array.from({length:capacity}, (_,i) =>
    additional[Math.floor((i + 0.5) * additional.length / capacity)]);
  return [...baseline,...distributed];
}

export function verifyShardName(name) {
  if (typeof name !== 'string' || !SHARD.test(name)) throw new Error('Invalid shard name from World API');
  return name;
}

/**
 * Describe existing deep-planner routing evidence without rescoring candidates.
 * Unknown or internally inconsistent measurements are flagged, never treated
 * as zero inaccessible sources. The scout remains strictly read-only.
 */
export function summarizeWorldRemoteRouting(selected) {
  const routes = selected?.deepAnalysis?.remoteRoutes;
  const total = routes?.totalSources;
  const reachable = routes?.reachableSources;
  const inaccessible = routes?.inaccessibleSources;
  if (![total, reachable, inaccessible].every(Number.isSafeInteger) ||
      total < 0 || reachable < 0 || inaccessible < 0 ||
      reachable + inaccessible !== total) {
    return {status:'unverified',totalSources:null,reachableSources:null,
      inaccessibleSources:null,needsReview:true};
  }
  const needsReview = total === 0 || inaccessible > 0;
  return {status:needsReview?'review':'clear',totalSources:total,
    reachableSources:reachable,inaccessibleSources:inaccessible,needsReview};
}

export function selectStrategicWinner(entries) {
  const valid = entries.filter(x => {
    const r = x?.report, s = r?.selected;
    return r?.server === 'world' && r?.shard === x.shard &&
      (x.shard !== 'shardX' || x.accessVerified === true) &&
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
