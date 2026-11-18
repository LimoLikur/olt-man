import { durationSeconds, ONU_IFACE, onuRefFrom, ParseError, phaseFromLabel, PON_IFACE, powerValue } from './common.js';
import { lines } from './normalize.js';
import * as s from './schemas.js';

// Parsers are token based, not column based: spacing differs between firmware and the manual.

// `show gpon onu state` columns differ by firmware, so they are read from the header. The manual
// prints `gpon-onu_1/S/P:N ... O7 State, Phase State`; V2.1.0 (olt-a) prints `1/S/P:N ... Phase
// State, Channel` without O7.
const STATE_COLUMNS = {
  OnuIndex: 'index',
  'Admin State': 'adminState',
  'OMCC State': 'omccState',
  'O7 State': 'o7State',
  'Phase State': 'phaseLabel',
  Channel: 'channel',
} as const;
type StateField = (typeof STATE_COLUMNS)[keyof typeof STATE_COLUMNS];
const STATE_REQUIRED: readonly StateField[] = ['index', 'adminState', 'omccState', 'phaseLabel'];
const STATE_COLUMN_NAME = new RegExp(Object.keys(STATE_COLUMNS).join('|'), 'g');
const STATE_INDEX = /^(?:gpon-onu_)?1\/(\d+)\/(\d+):(\d+)$/;

function stateFields(header: string): StateField[] {
  const fields: StateField[] = [];
  const rest = header.replace(STATE_COLUMN_NAME, (name) => {
    fields.push(STATE_COLUMNS[name as keyof typeof STATE_COLUMNS]);
    return '';
  });
  // An unknown column would shift every value after it, so it is an error, not something to skip.
  if (rest.trim()) throw new ParseError(`onu state: unknown column "${rest.trim().slice(0, 32)}"`);
  if (new Set(fields).size !== fields.length || !STATE_REQUIRED.every((f) => fields.includes(f))) throw new ParseError('onu state: unexpected header');
  return fields;
}

/** show gpon onu state gpon-olt_1/S/P [N] */
export function parseOnuState(raw: string): s.OnuState {
  const ls = lines(raw);
  const header = ls.find((l) => /^OnuIndex\s/.test(l));
  if (!header) throw new ParseError('onu state: header not found');
  const fields = stateFields(header);
  const rows = ls.flatMap((l) => {
    const tokens = l.trim().split(/\s+/);
    const m = STATE_INDEX.exec(tokens[0]!);
    if (!m) return [];
    // A row that does not fit the header fails loudly; dropping it would silently hide ONUs.
    if (tokens.length !== fields.length) throw new ParseError(`onu state: row ${tokens[0]} has ${tokens.length} fields, header has ${fields.length}`);
    const row: Record<string, unknown> = { slot: Number(m[1]), port: Number(m[2]), onuId: Number(m[3]) };
    fields.forEach((f, i) => {
      if (f !== 'index') row[f] = tokens[i];
    });
    row.phase = phaseFromLabel(String(row.phaseLabel));
    return [row];
  });
  const n = ls.map((l) => /^ONU Number:\s*(\d+)\/(\d+)$/.exec(l)).find(Boolean);
  return s.onuStateSchema.parse({ rows, onuNumber: n ? { online: Number(n[1]), total: Number(n[2]) } : null });
}

/** show pon power attenuation gpon-onu_1/S/P:N */
export function parseAttenuation(raw: string): s.Attenuation {
  const ls = lines(raw);
  const up = ls.map((l) => /^\s*up\s+Rx\s*:\s*(.+?)\s+Tx\s*:\s*(.+?)\s+(\S+)\s*$/.exec(l)).find(Boolean);
  const down = ls.map((l) => /^\s*down\s+Tx\s*:\s*(.+?)\s+Rx\s*:\s*(.+?)\s+(\S+)\s*$/.exec(l)).find(Boolean);
  if (!up || !down) throw new ParseError('attenuation: up/down lines not found');
  return s.attenuationSchema.parse({
    upstream: { oltRxDbm: powerValue(up[1]!), onuTxDbm: powerValue(up[2]!), attenuationDb: powerValue(up[3]!) },
    downstream: { oltTxDbm: powerValue(down[1]!), onuRxDbm: powerValue(down[2]!), attenuationDb: powerValue(down[3]!) },
  });
}

/** show gpon onu detail-info gpon-onu_1/S/P:N */
export function parseDetailInfo(raw: string): s.DetailInfo {
  const ls = lines(raw);
  const fields = new Map<string, string>();
  for (const l of ls) {
    const m = /^\s*([A-Za-z][A-Za-z0-9 /]*?):\s*(.*)$/.exec(l);
    if (m && !fields.has(m[1]!)) fields.set(m[1]!, m[2]!.trim());
  }
  const onu = onuRefFrom(ONU_IFACE.exec(fields.get('ONU interface') ?? ''));
  if (!onu) throw new ParseError('detail-info: ONU interface not found');
  const history = ls.flatMap((l) => {
    const m = /^\s*(\d+)\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})(?:\s+(\S+))?\s*$/.exec(l);
    if (!m) return [];
    const offline = m[3] === '0000-00-00 00:00:00' ? null : m[3]!;
    return [{ index: Number(m[1]), authpassTime: m[2]!, offlineTime: offline, cause: m[4] ?? null }];
  });
  const distance = /^(\d+)\s*m$/.exec(fields.get('ONU Distance') ?? '');
  const phaseLabel = fields.get('Phase state') ?? '';
  return s.detailInfoSchema.parse({
    onu,
    name: fields.get('Name') ?? '',
    type: fields.get('Type') ?? '',
    state: fields.get('State') ?? '',
    adminState: fields.get('Admin state') ?? '',
    phaseLabel,
    phase: phaseFromLabel(phaseLabel),
    serialNumber: fields.get('Serial number') ?? '',
    description: fields.get('Description') ?? '',
    distanceM: distance ? Number(distance[1]) : null,
    onlineDurationS: durationSeconds(fields.get('Online Duration') ?? ''),
    history,
  });
}

/** show interface gpon-onu_1/S/P:N */
export function parseOnuInterface(raw: string): s.OnuInterface {
  const ls = lines(raw);
  const rate = (dir: string) => ls.map((l) => new RegExp(`^\\s*${dir} rate\\s*:\\s*(\\d+)\\s*Bps\\s+(\\d+)\\s*pps`).exec(l)).find(Boolean);
  const pct = (dir: string) => {
    const m = ls.map((l) => new RegExp(`^\\s*${dir} bandwidth throughput\\s*:\\s*(\\S+)`).exec(l)).find(Boolean);
    const v = m ? /^(\d+(?:\.\d+)?)%$/.exec(m[1]!) : null;
    return v ? Number(v[1]) : null;
  };
  const input = rate('Input');
  const output = rate('Output');
  if (!input || !output) throw new ParseError('interface: rate lines not found');
  return s.onuInterfaceSchema.parse({
    inputBps: Number(input[1]),
    inputPps: Number(input[2]),
    outputBps: Number(output[1]),
    outputPps: Number(output[2]),
    inputThroughputPct: pct('Input'),
    outputThroughputPct: pct('Output'),
  });
}

/** Lines between `interface X` / `pon-onu-mng X` and the closing `!` / `end`, indentation removed. */
function block(ls: string[], start: RegExp): { header: RegExpExecArray; body: string[] } {
  const i = ls.findIndex((l) => start.test(l.trim()));
  if (i < 0) throw new ParseError('config block not found');
  const header = start.exec(ls[i]!.trim())!;
  const body: string[] = [];
  for (const l of ls.slice(i + 1)) {
    const t = l.trim();
    if (t === '!' || t === 'end' || /^[\w.-]+(\([\w-]+\))?#/.test(t)) break;
    if (t) body.push(t);
  }
  return { header, body };
}

/** show running-config interface gpon-onu_1/S/P:N (also `show run interface ...`). */
export function parseOnuRunningConfig(raw: string): s.OnuRunningConfig {
  const { header, body } = block(lines(raw), /^interface (gpon-onu_1\/\d+\/\d+:\d+)$/);
  const onu = onuRefFrom(ONU_IFACE.exec(header[1]!));
  const one = (re: RegExp) => body.map((l) => re.exec(l)).find(Boolean)?.[1] ?? null;
  const all = <T>(re: RegExp, map: (m: RegExpExecArray) => T) => body.flatMap((l) => {
    const m = re.exec(l);
    return m ? [map(m)] : [];
  });
  return s.onuRunningConfigSchema.parse({
    onu,
    name: one(/^name (\S+)$/),
    description: one(/^description (\S+)$/),
    tconts: all(/^tcont (\d+) name (\S+) profile (\S+)$/, (m) => ({ id: Number(m[1]), name: m[2], profile: m[3] })),
    gemports: all(/^gemport (\d+) name (\S+) unicast tcont (\d+)\b/, (m) => ({ id: Number(m[1]), name: m[2], tcont: Number(m[3]) })),
    servicePorts: all(/^service-port (\d+) vport (\d+) user-vlan (\d+) vlan (\d+)(?: svlan (\d+))?$/, (m) => ({
      id: Number(m[1]),
      vport: Number(m[2]),
      userVlan: Number(m[3]),
      vlan: Number(m[4]),
      svlan: m[5] ? Number(m[5]) : null,
    })),
    lines: body,
  });
}

/** show onu running config gpon-onu_1/S/P:N */
export function parseOnuMngConfig(raw: string): s.OnuMngConfig {
  const { header, body } = block(lines(raw), /^pon-onu-mng (gpon-onu_1\/\d+\/\d+:\d+)$/);
  return s.onuMngConfigSchema.parse({
    onu: onuRefFrom(ONU_IFACE.exec(header[1]!)),
    services: body.flatMap((l) => {
      const m = /^service (\S+)(?: type \S+)? gemport (\d+)(?: cos \d+)? vlan (\d+)$/.exec(l);
      return m ? [{ name: m[1], gemport: Number(m[2]), vlan: Number(m[3]) }] : [];
    }),
    vlanPorts: body.flatMap((l) => {
      const m = /^vlan port (\S+) mode (\S+) vlan (\d+)(?: priority \d+)?$/.exec(l);
      return m ? [{ port: m[1], mode: m[2], vlan: Number(m[3]) }] : [];
    }),
    lines: body,
  });
}

/** show running-config interface gpon-olt_1/S/P (inventory fallback; layout unverified). */
export function parsePortRunningConfig(raw: string): s.PortRunningConfig {
  const { header, body } = block(lines(raw), /^interface (gpon-olt_1\/\d+\/\d+)$/);
  const pon = PON_IFACE.exec(header[1]!)!;
  return s.portRunningConfigSchema.parse({
    pon: { slot: Number(pon[1]), port: Number(pon[2]) },
    onus: body.flatMap((l) => {
      const m = /^onu (\d+) type (\S+) sn (\S+)$/.exec(l);
      return m ? [{ onuId: Number(m[1]), type: m[2], sn: m[3] }] : [];
    }),
  });
}

/** show card */
export function parseCard(raw: string): s.CardRow[] {
  const ls = lines(raw);
  if (!ls.some((l) => /^Rack\s+Shelf\s+Slot\s+Cfgtype/i.test(l))) throw new ParseError('card: header not found');
  return s.cardSchema.parse(
    ls.flatMap((l) => {
      const m = /^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(\S+)$/.exec(l);
      return m
        ? [{ rack: Number(m[1]), shelf: Number(m[2]), slot: Number(m[3]), cfgType: m[4], realType: m[5], ports: Number(m[6]), hardVer: m[7], softVer: m[8], status: m[9] }]
        : [];
    }),
  );
}

/** write: success iff the output contains [OK]. */
export const parseWriteResult = (raw: string) => s.writeResultSchema.parse({ ok: /\[OK\]/.test(lines(raw).join('\n')) });

// `show vlan summary` on the owner's C320 (2026-11-13):
//   All created vlan num: 14
//   Details are following:
//       1,500,600,1410,1413,1416,1420-1421,1423,1427,1500-1502,1507
// A long list wraps at 80 columns wherever that falls, also inside a VLAN or a range (jangli,
// 2026-11-14: "...,1430,1500-150" then "1,1504-1505,..."), so the lines are joined as they are.
// Ranges are expanded, and the expanded count must equal the announced one, so a format change
// (or a wrong join) fails loudly instead of storing a wrong list.
export function parseVlanSummary(raw: string): s.VlanSummary {
  const all = lines(raw).map((l) => l.trim());
  const count = all.map((l) => /^All created vlan num:\s*(\d+)$/i.exec(l)).find(Boolean);
  if (!count) throw new ParseError('vlan summary: no "All created vlan num" line');
  const total = Number(count[1]);
  const start = all.findIndex((l) => /^Details are following:?$/i.test(l));
  const items = start === -1 ? [] : all.slice(start + 1).join('').split(',').map((i) => i.trim()).filter(Boolean);
  const vlans: number[] = [];
  for (const item of items) {
    const m = /^(\d{1,4})(?:-(\d{1,4}))?$/.exec(item);
    if (!m) throw new ParseError(`vlan summary: unexpected item "${item.slice(0, 16)}"`);
    const from = Number(m[1]);
    const to = m[2] === undefined ? from : Number(m[2]);
    if (from < 1 || to > 4094 || to < from) throw new ParseError(`vlan summary: bad VLAN or range "${item}"`);
    for (let v = from; v <= to; v++) vlans.push(v);
  }
  if (vlans.length !== total) throw new ParseError(`vlan summary: ${vlans.length} VLANs listed, ${total} announced`);
  return s.vlanSummarySchema.parse({ total, vlans: [...new Set(vlans)].sort((a, b) => a - b) });
}

// `show gpon profile tcont` on the owner's C320 (2026-11-13), one block per profile:
//   Profile name :100M
//    Type           FBW(kbps)   ABW(kbps)   MBW(kbps)   PRIORITY   WEIGHT
//    4              0           0           102400      N/A         N/A
// Every block must have that header and one row of numbers; any other line fails loudly.
// Names come back as printed; the caller decides which are usable in a template.
export function parseTcontProfiles(raw: string): s.TcontProfiles {
  const all = lines(raw).map((l) => l.trim()).filter(Boolean);
  const profiles: s.TcontProfiles['profiles'] = [];
  for (let i = 0; i < all.length; i += 3) {
    const name = /^Profile name\s*:\s*(\S+)$/i.exec(all[i]!)?.[1];
    if (!name) throw new ParseError(`tcont profile: unexpected line "${all[i]!.slice(0, 32)}"`);
    if (!/^Type\s+FBW\(kbps\)\s+ABW\(kbps\)\s+MBW\(kbps\)/i.test(all[i + 1] ?? '')) throw new ParseError(`tcont profile "${name}": no column header`);
    const row = /^(\d+)\s+(\d+)\s+(\d+)\s+(\d+)(?:\s|$)/.exec(all[i + 2] ?? '');
    if (!row) throw new ParseError(`tcont profile "${name}": no values row`);
    profiles.push({ name, type: Number(row[1]), fbwKbps: Number(row[2]), abwKbps: Number(row[3]), mbwKbps: Number(row[4]) });
  }
  if (profiles.length === 0) throw new ParseError('tcont profile: no profiles');
  return s.tcontProfilesSchema.parse({ profiles });
}

/** ZTE's "nothing to list" answer, e.g. `%Code 62310-GPONSRV : No related information to show.` */
export const NO_RELATED_INFO = /No related information to show/i;

// `show gpon onu uncfg` (owner's C320, 2026-11-13, same as the manual):
//   OnuIndex                 Sn              State
//   ---------------------------------------------
//   gpon-onu_1/1/1:1         HWTCAADBEF5B    unknown
// The ":N" is a temporary index on the port, not an ONU ID. The "No related information"
// answer means no unregistered ONU.
export function parseOnuUncfg(raw: string): s.OnuUncfg {
  const all = lines(raw).map((l) => l.trim()).filter(Boolean);
  if (all.length === 1 && NO_RELATED_INFO.test(all[0]!)) return s.onuUncfgSchema.parse({ onus: [] });
  const header = all.findIndex((l) => /^OnuIndex\s+Sn\s+State$/i.test(l));
  if (header === -1) throw new ParseError('onu uncfg: no header');
  const onus = all
    .slice(header + 1)
    .filter((l) => !/^-+$/.test(l))
    .map((l) => {
      const m = /^(?:gpon-onu_)?1\/(\d+)\/(\d+):(\d+)\s+(\S+)\s+(\S+)$/.exec(l);
      if (!m) throw new ParseError(`onu uncfg: unexpected line "${l.slice(0, 40)}"`);
      return { slot: Number(m[1]), port: Number(m[2]), index: Number(m[3]), sn: m[4]!, state: m[5]! };
    });
  return s.onuUncfgSchema.parse({ onus });
}

