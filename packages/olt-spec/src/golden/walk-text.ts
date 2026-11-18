// Parser for `snmpbulkwalk -On` text (net-snmp CLI tools), the format of recordings/<name>/walk.txt.

export type WalkValue =
  | { type: 'INTEGER' | 'Gauge32' | 'Counter32' | 'Counter64' | 'Timeticks'; value: number }
  | { type: 'STRING'; value: string }
  | { type: 'Hex-STRING'; value: Uint8Array }
  | { type: 'OID'; value: string }
  | { type: 'other'; value: string };

function unquote(s: string): string {
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(s.trim());
  return m ? m[1]!.replace(/\\(.)/g, '$1') : s.trim();
}

function value(type: string, raw: string): WalkValue {
  switch (type) {
    case 'INTEGER':
    case 'Gauge32':
    case 'Counter32':
    case 'Counter64': {
      const m = /-?\d+/.exec(raw); // "INTEGER: working(4)" also yields 4
      return { type, value: m ? Number(/\((-?\d+)\)/.exec(raw)?.[1] ?? m[0]) : Number.NaN };
    }
    case 'Timeticks':
      return { type, value: Number(/\((\d+)\)/.exec(raw)?.[1] ?? Number.NaN) };
    case 'STRING':
      return { type, value: unquote(raw) };
    case 'Hex-STRING':
      return { type, value: Uint8Array.from(raw.trim().split(/\s+/).filter(Boolean).map((h) => Number.parseInt(h, 16))) };
    case 'OID':
      return { type, value: raw.trim().replace(/^\./, '') };
    default:
      return { type: 'other', value: raw.trim() };
  }
}

/** Map of numeric OID (no leading dot) -> value. Continuation lines (long Hex-STRING) are joined. */
export function parseWalkText(text: string): Map<string, WalkValue> {
  const out = new Map<string, WalkValue>();
  const entries: string[] = [];
  for (const line of text.replace(/\r/g, '').split('\n')) {
    if (/^\.?\d+(\.\d+)+ = /.test(line)) entries.push(line);
    else if (line.trim() && entries.length) entries[entries.length - 1] += ` ${line.trim()}`;
  }
  for (const entry of entries) {
    const m = /^\.?([\d.]+) = (?:([\w-]+): ?)?(.*)$/.exec(entry);
    if (!m) continue;
    out.set(m[1]!, value(m[2] ?? 'other', m[3] ?? ''));
  }
  return out;
}

/** Rows of one table column: suffix (after the column OID) -> value. */
export function column(walk: Map<string, WalkValue>, columnOid: string): Map<string, WalkValue> {
  const prefix = `${columnOid.replace(/^\./, '')}.`;
  const rows = new Map<string, WalkValue>();
  for (const [oid, v] of walk) if (oid.startsWith(prefix)) rows.set(oid.slice(prefix.length), v);
  return rows;
}
