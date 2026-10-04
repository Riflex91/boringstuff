export function decodeConsoleEntities(value) {
  return String(value)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

export function parseBotLogLine(line) {
  const marker = '[BOTLOG]';
  const idx = String(line).indexOf(marker);
  if (idx < 0) return null;
  const payloadText = decodeConsoleEntities(String(line).slice(idx + marker.length));
  return JSON.parse(payloadText);
}
