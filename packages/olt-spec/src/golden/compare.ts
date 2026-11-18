import { z } from 'zod';
import { OID_PROFILES, type OnuColumn } from '../oid-profiles/index.js';
import { parseAttenuation, parseOnuState } from '../parsers/show.js';
import type { PhaseState } from '../types.js';
import { column, parseWalkText } from './walk-text.js';

/** recordings/<name>/meta.json */
export const recordingMetaSchema = z.strictObject({
  name: z.string().regex(/^[a-z0-9-]{1,40}$/),
  source: z.enum(['synthetic', 'real']),
  profile: z.enum(['zte-c320-v2.1', 'zte-c320-v2.2']),
  sysDescr: z.string().max(256),
  recordedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T/),
  notes: z.string().max(2000).optional(),
});
export type RecordingMeta = z.infer<typeof recordingMetaSchema>;

export interface Recording {
  meta: RecordingMeta;
  /** walk.txt */
  walk: string;
  /** Every other file, by name: show-state-<slot>-<port>.txt, show-attenuation-<slot>-<port>-<onu>.txt */
  files: Record<string, string>;
}

export const RX_TOLERANCE_DB = 0.5;

export interface GoldenResult {
  mismatches: string[];
  compared: { status: number; rx: number };
}

const key = (r: { slot: number; port: number; onuId: number }) => `1/${r.slot}/${r.port}:${r.onuId}`;

/**
 * Golden check (C3/J3): does the OID profile decode the recorded walk into the same ONU
 * status and Rx as the CLI output recorded from the same OLT at the same time?
 */
export function compareRecording(rec: Recording): GoldenResult {
  const profile = OID_PROFILES[rec.meta.profile];
  const walk = parseWalkText(rec.walk);
  const mismatches: string[] = [];
  const decode = (suffix: string, col: OnuColumn) => {
    try {
      return key(profile.decodeOnuIndex(suffix.split('.').map(Number), col));
    } catch {
      mismatches.push(`walk: undecodable ${col} index ${suffix}`);
      return null;
    }
  };
  /** Rows of one column by ONU key; each column is decoded with its own index arcs. */
  const numeric = (col: OnuColumn) => {
    const out = new Map<string, number>();
    for (const [suffix, v] of column(walk, profile.columns[col])) {
      const k = decode(suffix, col);
      if (k && typeof v.value === 'number') out.set(k, v.value);
    }
    return out;
  };

  const snmpPhase = new Map<string, PhaseState>([...numeric('phaseState')].map(([k, raw]) => [k, profile.phaseState(raw)]));
  const snmpRxOnu = numeric('rxOnu');
  const snmpRxOlt = numeric('rxOlt');
  let status = 0;
  let rx = 0;

  for (const [file, text] of Object.entries(rec.files)) {
    if (/^show-state-\d+-\d+\.txt$/.test(file)) {
      const cli = parseOnuState(text);
      const port = /^show-state-(\d+)-(\d+)\.txt$/.exec(file)!;
      const prefix = `1/${port[1]}/${port[2]}:`;
      const cliKeys = new Set(cli.rows.map(key));
      for (const row of cli.rows) {
        const k = key(row);
        const snmp = snmpPhase.get(k);
        status++;
        if (snmp === undefined) mismatches.push(`${k}: in CLI (${row.phaseLabel}) but not in SNMP phase table`);
        else if (snmp !== row.phase) mismatches.push(`${k}: SNMP phase ${snmp} != CLI ${row.phase} (${row.phaseLabel})`);
      }
      for (const k of snmpPhase.keys()) if (k.startsWith(prefix) && !cliKeys.has(k)) mismatches.push(`${k}: in SNMP but not in CLI state of ${file}`);
    }

    const att = /^show-attenuation-(\d+)-(\d+)-(\d+)\.txt$/.exec(file);
    if (att) {
      const k = `1/${att[1]}/${att[2]}:${att[3]}`;
      const cli = parseAttenuation(text);
      // Each column has its own scale: rxOnu raw * 0.002 - 30, rxOlt milli-dBm.
      const pairs: [string, number | null, number | undefined, (raw: number) => number | null][] = [
        ['ONU Rx', cli.downstream.onuRxDbm, snmpRxOnu.get(k), (raw) => profile.rxOnuDbm(raw)],
        ['OLT Rx', cli.upstream.oltRxDbm, snmpRxOlt.get(k), (raw) => profile.rxOltDbm(raw)],
      ];
      for (const [what, cliDbm, raw, toDbm] of pairs) {
        rx++;
        if (raw === undefined) {
          mismatches.push(`${k}: ${what} missing in SNMP`);
          continue;
        }
        const snmpDbm = toDbm(raw);
        if ((snmpDbm === null) !== (cliDbm === null)) mismatches.push(`${k}: ${what} SNMP ${snmpDbm} vs CLI ${cliDbm} (no-signal mismatch)`);
        else if (snmpDbm !== null && cliDbm !== null && Math.abs(snmpDbm - cliDbm) > RX_TOLERANCE_DB)
          mismatches.push(`${k}: ${what} SNMP ${snmpDbm} dBm vs CLI ${cliDbm} dBm (> ${RX_TOLERANCE_DB} dB)`);
      }
    }
  }

  if (status === 0) mismatches.push('no show-state-*.txt compared');
  if (rx === 0) mismatches.push('no show-attenuation-*.txt compared');
  return { mismatches, compared: { status, rx } };
}
