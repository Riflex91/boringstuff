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
  // Keep roughly a 3:2 geographic aspect ratio at each probe budget.
  // 24 => 6x4; 48 => 8x6; 96 => 12x8, without inventing a room score.
  const columns = Math.max(1, Math.round(Math.sqrt(max * 1.5)));
  const rows = Math.max(1, Math.ceil(max / columns));
  const xs = axis(w, columns), ys = axis(h, rows);
  const rooms = [];
  for (const y of ys) for (const x of xs) {
    const hname = x >= 0 ? 'E' + x : 'W' + (-x - 1);
    const vname = y >= 0 ? 'S' + y : 'N' + (-y - 1);
    rooms.push(hname + vname);
  }
  // A grid is a sampling strategy, never a replacement for room scoring.
  const unique = [...new Set(rooms)];
  if (unique.length <= max) return unique;
  // Sample across the entire grid instead of truncating its last row.
  return Array.from({length:max}, (_,i) => unique[Math.floor((i + 0.5) * unique.length / max)]);
}

export function verifyShardName(name) {
  if (typeof name !== 'string' || !SHARD.test(name)) throw new Error('Invalid shard name from World API');
  return name;
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
