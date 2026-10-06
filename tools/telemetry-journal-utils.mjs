import zlib from 'node:zlib';

export function decodeMemoryResponse(response) {
  let data = response && Object.prototype.hasOwnProperty.call(response, 'data') ? response.data : response;
  if (data === null || data === undefined || data === '') return null;
  if (typeof data !== 'string') return data;

  let text = data;
  if (text.startsWith('gz:')) {
    const compressed = Buffer.from(text.slice(3), 'base64');
    text = zlib.gunzipSync(compressed).toString('utf8');
  }
  try { return JSON.parse(text); }
  catch { return text; }
}

export function expandJournalRecord(record) {
  if (!record || !Number.isFinite(Number(record.q))) return null;
  return {
    jseq: Number(record.q),
    v: record.v || null,
    session: record.s || null,
    tick: Number(record.t),
    level: record.l || 'INFO',
    code: record.c || 'UNKNOWN',
    msg: record.m || '',
    ctx: record.x || {}
  };
}

export function journalRecords(journal) {
  if (!journal || typeof journal !== 'object') return [];
  const snapshots = Array.isArray(journal.snapshots) ? journal.snapshots : [];
  const events = Array.isArray(journal.events) ? journal.events : [];
  return snapshots.concat(events)
    .map(expandJournalRecord)
    .filter(Boolean)
    .sort((a, b) => a.jseq - b.jseq);
}

export function planJournalCatchUp(journal, lastSeq = 0) {
  const cursor = Math.max(0, Number(lastSeq) || 0);
  const all = journalRecords(journal);
  const records = all.filter(r => r.jseq > cursor);
  const droppedThroughSeq = Math.max(0, Number(journal && journal.droppedThroughSeq) || 0);
  const latestSeq = Math.max(0, Number(journal && journal.nextSeq) - 1 || 0, all.length ? all[all.length - 1].jseq : 0);
  const gap = cursor < droppedThroughSeq ? {
    expectedSeq: cursor + 1,
    droppedThroughSeq,
    oldestAvailableSeq: all.length ? all[0].jseq : null,
    latestSeq
  } : null;

  return { records, gap, latestSeq, droppedThroughSeq };
}


export function createContiguousSequenceCursor(initialSeq = 0) {
  let cursor = Math.max(0, Number(initialSeq) || 0);
  const pending = new Set();

  function consumeContiguous() {
    while (pending.has(cursor + 1)) {
      pending.delete(cursor + 1);
      cursor += 1;
    }
  }

  return {
    get value() {
      return cursor;
    },

    observe(seq) {
      const value = Math.max(0, Number(seq) || 0);
      if (!value || value <= cursor || pending.has(value)) {
        return { accepted: false, cursor, advanced: false };
      }

      const before = cursor;
      pending.add(value);
      consumeContiguous();
      return { accepted: true, cursor, advanced: cursor > before };
    },

    skipThrough(seq) {
      const value = Math.max(cursor, Number(seq) || 0);
      for (const pendingSeq of pending) {
        if (pendingSeq <= value) pending.delete(pendingSeq);
      }
      const before = cursor;
      cursor = value;
      consumeContiguous();
      return { cursor, advanced: cursor > before };
    },

    pending() {
      return [...pending].sort((a, b) => a - b);
    }
  };
}
