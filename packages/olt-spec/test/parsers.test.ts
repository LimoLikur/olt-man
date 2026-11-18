import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  findCliError,
  normalize,
  ParseError,
  parseAttenuation,
  parseCard,
  parseDetailInfo,
  parseOnuInterface,
  parseOnuMngConfig,
  parseOnuRunningConfig,
  parseOnuState,
  parsePortRunningConfig,
  parseWriteResult,
} from '../src/index.js';

// Manual fixtures live with the mock (apps/mock-olt/fixtures/manual, B1).
const fx = (name: string) => readFileSync(fileURLToPath(new URL(`../../../apps/mock-olt/fixtures/manual/${name}`, import.meta.url)), 'utf8');
// Real, redacted transcripts from OLT firmware V2.1.0 (golden recording olt-a, K4).
const oltA = (name: string) => readFileSync(fileURLToPath(new URL(`../../../apps/mock-olt/fixtures/recordings/olt-a/${name}`, import.meta.url)), 'latin1');

describe('normalize', () => {
  it('removes ANSI, backspaces, pager remnants and CR overwrites', () => {
    const raw = 'line one\r\n\x1b[1mbold\x1b[0m\r\n--More--\r        \rline two\r\nabcX\bd\r\n';
    expect(normalize(raw)).toBe('line one\nbold\nline two\nabcd');
  });

  it('finds % error lines', () => {
    expect(findCliError("          ^\r\n%Error 20200: Invalid input detected at '^' marker.\r\n")).toMatch(/^%Error 20200/);
    expect(findCliError(fx('show-card.txt'))).toBeNull();
  });

  it('skips %Info notices but still finds an error after one', () => {
    const info = '%Info 20272: Enter configuration commands, one per line. End with CTRL/Z.';
    expect(findCliError(`${info}\r\n`)).toBeNull();
    expect(findCliError(`${info}\r\n%Code 32309-GPONSRV : The SN has been registered.\r\n`)).toMatch(/^%Code 32309/);
  });
});

describe('parsers against the manual (fixtures/manual)', () => {
  it('state: 1/2/5:4 LOS, 1/2/5:5 working', () => {
    const los = parseOnuState(fx('show-gpon-onu-state-1-2-5-4.txt'));
    const ok = parseOnuState(fx('show-gpon-onu-state-1-2-5-5.txt'));
    expect(los.rows).toEqual([{ slot: 2, port: 5, onuId: 4, adminState: 'enable', omccState: 'disable', o7State: 'unknown', phaseLabel: 'LOS', phase: 'los' }]);
    expect(ok.rows[0]).toMatchObject({ onuId: 5, phase: 'working', o7State: 'operation' });
    expect(los.onuNumber).toEqual({ online: 0, total: 1 });
    expect(ok.onuNumber).toEqual({ online: 1, total: 1 });
  });

  it('attenuation: Rx -20.850 / -18.210 dBm, 23.718 / 22.440 dB', () => {
    expect(parseAttenuation(fx('show-pon-power-attenuation-1-2-5-5.txt'))).toEqual({
      upstream: { oltRxDbm: -20.85, onuTxDbm: 2.868, attenuationDb: 23.718 },
      downstream: { oltTxDbm: 4.23, onuRxDbm: -18.21, attenuationDb: 22.44 },
    });
  });

  it('attenuation: no signal and N/A become null', () => {
    expect(parseAttenuation(fx('show-pon-power-attenuation-1-2-5-4.txt'))).toEqual({
      upstream: { oltRxDbm: null, onuTxDbm: null, attenuationDb: null },
      downstream: { oltTxDbm: 4.2, onuRxDbm: null, attenuationDb: null },
    });
  });

  it('detail-info: 10 history rows, the 10th still online; 3540 m; 38 527 s', () => {
    const d = parseDetailInfo(fx('show-gpon-onu-detail-info-1-2-5-5.txt'));
    expect(d).toMatchObject({
      onu: { slot: 2, port: 5, onuId: 5 },
      name: 'Customer-2',
      type: 'ZTEG-F660',
      phase: 'working',
      serialNumber: 'ZTEGC1192DD7',
      description: 'Internet-Customer-2',
      distanceM: 3540,
      onlineDurationS: 38_527,
    });
    expect(d.history).toHaveLength(10);
    expect(d.history[8]).toEqual({ index: 9, authpassTime: '2018-07-29 11:36:01', offlineTime: '2018-07-29 11:54:32', cause: 'LOSi' });
    expect(d.history[9]).toEqual({ index: 10, authpassTime: '2018-07-29 11:56:31', offlineTime: null, cause: null });
  });

  it('interface rates', () => {
    expect(parseOnuInterface(fx('show-interface-gpon-onu-1-2-5-4.txt'))).toEqual({
      inputBps: 1471,
      inputPps: 12,
      outputBps: 2212,
      outputPps: 13,
      inputThroughputPct: 0,
      outputThroughputPct: null,
    });
  });

  it('ONU running-config (hlm. 20)', () => {
    const c = parseOnuRunningConfig(fx('show-run-interface-gpon-onu-1-2-5-5.txt'));
    expect(c).toMatchObject({
      onu: { slot: 2, port: 5, onuId: 5 },
      name: 'Customer-2',
      description: 'Internet-Customer-2',
      tconts: [{ id: 1, name: 'acsata', profile: 'UP-60M' }],
      gemports: [{ id: 1, name: 'Internet', tcont: 1 }],
      servicePorts: [{ id: 1, vport: 1, userVlan: 1245, vlan: 1245, svlan: 1402 }],
    });
    expect(c.lines).toContain('tcont 1 gap mode2');
  });

  it('onu running config (hlm. 25)', () => {
    expect(parseOnuMngConfig(fx('show-onu-running-config-1-2-11-8.txt'))).toMatchObject({
      onu: { slot: 2, port: 11, onuId: 8 },
      services: [
        { name: 'Internet-Customer1', gemport: 1, vlan: 671 },
        { name: 'OAM', gemport: 2, vlan: 1450 },
        { name: 'Internet-Customer2', gemport: 3, vlan: 1490 },
      ],
      vlanPorts: [
        { port: 'eth_0/1', mode: 'tag', vlan: 671 },
        { port: 'eth_0/3', mode: 'tag', vlan: 1490 },
      ],
    });
  });

  it('show card (hlm. 7)', () => {
    const cards = parseCard(fx('show-card.txt'));
    expect(cards).toHaveLength(4);
    expect(cards[0]).toEqual({ rack: 1, shelf: 1, slot: 1, cfgType: 'GTGO', realType: 'GTGOG', ports: 8, hardVer: '120301', softVer: 'V2.0.0', status: 'INSERVICE' });
    expect(cards[3]!.status).toBe('STANDBY');
  });

  it('write (hlm. 10)', () => {
    expect(parseWriteResult(fx('write.txt'))).toEqual({ ok: true });
    expect(parseWriteResult('%Error 1: busy')).toEqual({ ok: false });
  });

  it('port running-config (layout of the mock; unverified)', () => {
    expect(parsePortRunningConfig('Building configuration...\n!\ninterface gpon-olt_1/1/1\n  no shutdown\n  onu 1 type ZTEG-F620 sn ZTEG00000002\n!\nend')).toEqual({
      pon: { slot: 1, port: 1 },
      onus: [{ onuId: 1, type: 'ZTEG-F620', sn: 'ZTEG00000002' }],
    });
  });
});

describe('parsers against a real OLT (recordings/olt-a, V2.1.0)', () => {
  it('state: 1/S/P:N index, no O7 column, Channel column, OffLine spelling', () => {
    const state = parseOnuState(oltA('show-state-1-1.txt'));
    expect(state.rows.map((r) => r.onuId)).toEqual([1, 3, 4, 5, 6, 7, 8, 10, 11, 12]);
    expect(state.rows[1]).toEqual({ slot: 1, port: 1, onuId: 3, adminState: 'enable', omccState: 'disable', phaseLabel: 'DyingGasp', phase: 'dying_gasp', channel: '1(GPON)' });
    expect(state.rows[4]).toMatchObject({ onuId: 6, phaseLabel: 'OffLine', phase: 'offline' });
    expect(state.rows.filter((r) => r.phase === 'working')).toHaveLength(8);
    expect(state.rows.some((r) => 'o7State' in r)).toBe(false);
    expect(state.onuNumber).toEqual({ online: 8, total: 10 });
  });

  it('state: the row after a --More-- page break is kept', () => {
    const state = parseOnuState(oltA('show-state-2-6.txt'));
    expect(state.rows.map((r) => r.onuId)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(state.rows[21]).toMatchObject({ slot: 2, port: 6, onuId: 22, phase: 'working', channel: '1(GPON)' });
    expect(state.onuNumber).toEqual({ online: 21, total: 25 });
  });
});

describe('rejects garbage', () => {
  it.each([parseOnuState, parseAttenuation, parseDetailInfo, parseOnuInterface, parseCard])('%o', (parse) => {
    expect(() => parse('%Error 20200: Invalid input')).toThrow(ParseError);
  });

  it('state: a row that does not fit the header fails instead of being dropped', () => {
    const header = 'OnuIndex   Admin State  OMCC State  Phase State  Channel\n------\n';
    expect(() => parseOnuState(`${header}1/1/1:1     enable       enable      working\n`)).toThrow(ParseError);
    expect(() => parseOnuState(`${header}1/1/1:1     enable       enable      working      1(GPON)   extra\n`)).toThrow(ParseError);
  });

  it('state: an unknown column fails instead of shifting the values', () => {
    expect(() => parseOnuState('OnuIndex   Admin State  OMCC State  Vendor  Phase State\n1/1/1:1  enable  enable  ZTE  working\n')).toThrow(ParseError);
  });

  it('control characters smuggled into a field fail Zod validation', () => {
    const raw = fx('show-gpon-onu-detail-info-1-2-5-5.txt').replace('Customer-2', 'Cust\x07omer');
    expect(() => parseDetailInfo(raw)).not.toThrow(); // BEL is stripped by normalize
    expect(parseDetailInfo(raw).name).toBe('Customer');
  });
});
