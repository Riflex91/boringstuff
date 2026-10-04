function parseTime(line) {
  const m = String(line).match(/^(\d{4}-\d{2}-\d{2}T[^ ]+)/);
  const t = m ? Date.parse(m[1]) : NaN;
  return Number.isFinite(t) ? t : null;
}

export function parseTimestampedLogRecords(text) {
  const records = [];
  let current = null;

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    if (!rawLine.trim()) continue;
    const time = parseTime(rawLine);
    if (time !== null) {
      if (current) records.push(current);
      current = { time, lines: [rawLine] };
      continue;
    }
    if (current) current.lines.push(rawLine);
  }

  if (current) records.push(current);
  return records;
}

export function filterTimestampedLogRecords(text, startAt, endAt) {
  return parseTimestampedLogRecords(text)
    .filter(record => {
      if (startAt !== null && record.time < startAt) return false;
      if (endAt !== null && record.time > endAt) return false;
      return true;
    })
    .map(record => record.lines.join('\n'));
}
