import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compareRecording, OID_PROFILES, parseWalkText, type Recording, recordingMetaSchema } from '../src/index.js';

const ROOT = fileURLToPath(new URL('../../../apps/mock-olt/fixtures/recordings/', import.meta.url));

function load(dir: string): Recording {
  const files: Record<string, string> = {};
  for (const f of readdirSync(dir)) if (f.startsWith('show-')) files[f] = readFileSync(join(dir, f), 'latin1');
  return {
    meta: recordingMetaSchema.parse(JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'))),
    walk: readFileSync(join(dir, 'walk.txt'), 'utf8'),
    files,
  };
}

const recordings = existsSync(ROOT) ? readdirSync(ROOT, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) : [];

describe('golden recordings (apps/mock-olt/fixtures/recordings)', () => {
  it('has at least one recording', () => {
    expect(recordings.length).toBeGreaterThan(0);
  });

  it.each(recordings)('%s: SNMP decoded with its profile matches the CLI', (name) => {
    const result = compareRecording(load(join(ROOT, name)));
    expect(result.mismatches).toEqual([]);
    expect(result.compared.status).toBeGreaterThan(0);
    expect(result.compared.rx).toBeGreaterThan(0);
  });

  it.each(recordings.filter((n) => n.startsWith('synthetic-')))('%s: a copy with Rx shifted by 1 dB fails', (name) => {
    const rec = load(join(ROOT, name));
    const col = OID_PROFILES[rec.meta.profile].columns.rxOnu.replace(/\./g, '\\.');
    // +500 raw = +1 dB with the 0.002 dB/step hypothesis; 65535 (no signal) stays as is.
    const shifted = rec.walk.replace(new RegExp(`^(\\.${col}\\.[\\d.]+ = INTEGER: )(\\d+)$`, 'gm'), (_m, p: string, v: string) => p + (v === '65535' ? v : String(Number(v) + 500)));
    expect(shifted).not.toBe(rec.walk);
    const result = compareRecording({ ...rec, walk: shifted });
    expect(result.mismatches.length).toBeGreaterThan(0);
    expect(result.mismatches.every((m) => m.includes('ONU Rx'))).toBe(true);
  });

  it.each(recordings.filter((n) => n.startsWith('synthetic-')))('%s: decoding with the other profile fails', (name) => {
    const rec = load(join(ROOT, name));
    const other = rec.meta.profile === 'zte-c320-v2.1' ? 'zte-c320-v2.2' : 'zte-c320-v2.1';
    expect(compareRecording({ ...rec, meta: { ...rec.meta, profile: other } }).mismatches.length).toBeGreaterThan(0);
  });
});

describe('walk text parser', () => {
  it('reads real snmpbulkwalk -On output', () => {
    const walk = parseWalkText(
      [
        '.1.3.6.1.2.1.1.1.0 = STRING: "ZXA10 C320, ZTE ZXA10 Software Version: V2.1.0"',
        '.1.3.6.1.2.1.1.2.0 = OID: .1.3.6.1.4.1.3902.1082.1001.320.1.1',
        '.1.3.6.1.2.1.1.3.0 = Timeticks: (410) 0:00:04.10',
        '.1.3.6.1.4.1.3902.1012.3.28.1.1.5.268501248.1 = Hex-STRING: 5A 54 45 47 2A B8 E5 9E ',
        '.1.3.6.1.4.1.3902.1012.3.28.2.1.4.268501248.1 = INTEGER: 4',
        '.1.3.6.1.4.1.3902.1012.3.28.2.1.4.268501248.2 = INTEGER: los(2)',
        '.1.3.6.1.6.3.10.2.1.1.0 = Hex-STRING: 80 00 0F 3E 05 B5 A1 D5 08 34 CB 01 02 03 04 05',
        '06 07 ',
      ].join('\n'),
    );
    expect(walk.get('1.3.6.1.2.1.1.2.0')).toEqual({ type: 'OID', value: '1.3.6.1.4.1.3902.1082.1001.320.1.1' });
    expect(walk.get('1.3.6.1.2.1.1.3.0')).toEqual({ type: 'Timeticks', value: 410 });
    expect(OID_PROFILES['zte-c320-v2.1'].decodeSerial(walk.get('1.3.6.1.4.1.3902.1012.3.28.1.1.5.268501248.1')!.value as Uint8Array)).toBe('ZTEG2AB8E59E');
    expect(walk.get('1.3.6.1.4.1.3902.1012.3.28.2.1.4.268501248.2')).toEqual({ type: 'INTEGER', value: 2 });
    expect((walk.get('1.3.6.1.6.3.10.2.1.1.0')!.value as Uint8Array).length).toBe(18);
  });
});
