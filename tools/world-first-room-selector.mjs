// Pure, offline ranking. Never infers availability from terrain alone.
export function selectWorldStart(candidates) {
  if (!Array.isArray(candidates)) throw new TypeError('Candidates must be an array');
  const valid = candidates.filter(c => c &&
    typeof c.shard === 'string' && /^shard[0-9]+$/.test(c.shard) &&
    typeof c.room === 'string' && /^[WE][0-9]+[NS][0-9]+$/.test(c.room) &&
    c.available === true && c.status === 'normal' &&
    Number.isInteger(c.sources) && c.sources >= 1 && c.sources <= 2 &&
    Number.isInteger(c.openTiles) && c.openTiles >= 0 && c.openTiles <= 2500 &&
    Number.isInteger(c.spawnX) && c.spawnX >= 2 && c.spawnX <= 47 &&
    Number.isInteger(c.spawnY) && c.spawnY >= 2 && c.spawnY <= 47 &&
    c.spawnTileFree === true && c.controllerUnowned === true &&
    c.hasExistingSpawn !== true);
  const ranked = valid.map(c => ({ ...c, score: c.sources * 1000 + c.openTiles }))
    .sort((a,b) => b.score - a.score || a.shard.localeCompare(b.shard) || a.room.localeCompare(b.room));
  return ranked[0] || null;
}
