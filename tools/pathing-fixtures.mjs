// A weighted-grid reference search. This exercises the actual cost callback;
// it deliberately does not return a hard-coded successful path.
export class CostMatrix {
  constructor() { this.data = new Uint8Array(2500); }
  set(x, y, value) { this.data[y * 50 + x] = value; }
  get(x, y) { return this.data[y * 50 + x]; }
  clone() { const copy = new CostMatrix(); copy.data.set(this.data); return copy; }
}
export const pos = (x, y, roomName = 'E1N1') => ({ x, y, roomName });
export function snapshot() {
  return { roomName: 'E1N1', terrain: { get: () => 0 }, structures: [], sources: [],
    minerals: [], sites: [], planned: [], stationary: [], congestion: [], hostiles: [], keepers: [] };
}
export function referenceFinder() {
  const pf = { CostMatrix, calls: 0, lastOptions: null };
  pf.search = (origin, goal, opts) => {
    pf.calls++;
    pf.lastOptions = opts;
    const field = opts.roomCallback(origin.roomName);
    if (field === false) return { incomplete: true, path: [], ops: 0 };
    const key = p => p.y * 50 + p.x;
    const start = key(origin);
    const queue = [{ i: start, cost: 0 }];
    const distance = new Map([[start, 0]]);
    const previous = new Map();
    let ops = 0;
    while (queue.length && ops < opts.maxOps) {
      queue.sort((a, b) => b.cost - a.cost || b.i - a.i);
      const item = queue.pop();
      if (item.cost !== distance.get(item.i)) continue;
      ops++;
      const x = item.i % 50, y = Math.floor(item.i / 50);
      if (Math.max(Math.abs(x - goal.pos.x), Math.abs(y - goal.pos.y)) <= goal.range) {
        const path = [];
        let i = item.i;
        while (i !== start) { path.push(pos(i % 50, Math.floor(i / 50), origin.roomName)); i = previous.get(i); }
        return { path: path.reverse(), incomplete: false, ops, cost: item.cost };
      }
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= 50 || ny < 0 || ny >= 50) continue;
        const weight = field ? field.get(nx, ny) : opts.plainCost;
        if (weight === 255) continue;
        const i = ny * 50 + nx, cost = item.cost + (weight || opts.plainCost);
        if (cost >= (distance.get(i) ?? Infinity)) continue;
        distance.set(i, cost); previous.set(i, item.i); queue.push({ i, cost });
      }
    }
    return { path: [], incomplete: true, ops, cost: 0 };
  };
  return pf;
}
