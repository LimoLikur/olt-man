import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { detectProfile, OID_PROFILES, type OidProfileId, type PhaseState, PHASE_STATES, RX_NO_SIGNAL, RX_OLT_NO_SIGNAL, RX_VALID_DBM } from '../src/index.js';

const profiles = Object.values(OID_PROFILES);
/** rxOnu raw of +10 dBm (RX_VALID_DBM.max): (10 + 30) / 0.002. */
const RX_ONU_MAX_RAW = 20_000;
// Phase columns of olt-a (V2.1.0) cross-tabulated against `show gpon onu state` for 133 ONUs (J3).
const OBSERVED_PHASES: Record<OidProfileId, Record<number, PhaseState>> = {
  'zte-c320-v2.1': { 1: 'los', 3: 'working', 4: 'dying_gasp', 6: 'offline' },
  'zte-c320-v2.2': { 2: 'los', 4: 'working', 5: 'dying_gasp', 7: 'offline' },
};
// `verified` flips only together with a passing real golden recording (PLAN J3).
const VERIFIED: Record<OidProfileId, boolean> = {
  'zte-c320-v2.1': true, // olt-a
  'zte-c320-v2.2': false,
};
const onuRef = fc.record({
  slot: fc.integer({ min: 1, max: 22 }),
  port: fc.integer({ min: 1, max: 16 }),
  onuId: fc.integer({ min: 1, max: 128 }),
});

describe.each(profiles)('oid profile $id', (profile) => {
  it('is verified only after a real golden recording passed', () => {
    expect(profile.verified).toBe(VERIFIED[profile.id]);
  });

  it('decode(encode(x)) = x', () => {
    fc.assert(fc.property(onuRef, (ref) => {
      expect(profile.decodeOnuIndex(profile.encodeOnuIndex(ref))).toEqual(ref);
    }));
  });

  it('rejects malformed index suffixes', () => {
    expect(() => profile.decodeOnuIndex([1])).toThrow();
    expect(() => profile.decodeOnuIndex([12345, 1])).toThrow();
    expect(() => profile.encodeOnuIndex({ slot: 1, port: 1, onuId: 129 })).toThrow();
  });

  it('rxOnu rows carry one extra index arc, .1 (seen on olt-a)', () => {
    expect(profile.indexArcs).toEqual({ rxOnu: [1] });
    fc.assert(fc.property(onuRef, (ref) => {
      const suffix = profile.encodeOnuIndex(ref, 'rxOnu');
      expect(suffix).toEqual([...profile.encodeOnuIndex(ref), 1]);
      expect(profile.decodeOnuIndex(suffix, 'rxOnu')).toEqual(ref);
    }));
    expect(profile.encodeOnuIndex({ slot: 1, port: 1, onuId: 1 }, 'rxOlt')).toEqual(profile.encodeOnuIndex({ slot: 1, port: 1, onuId: 1 }));
  });

  it('rejects an rxOnu suffix with a missing or different extra arc', () => {
    const [pon, onuId] = profile.encodeOnuIndex({ slot: 1, port: 1, onuId: 3 });
    expect(() => profile.decodeOnuIndex([pon!, onuId!], 'rxOnu')).toThrow(RangeError);
    expect(() => profile.decodeOnuIndex([pon!, onuId!, 2], 'rxOnu')).toThrow(RangeError);
    expect(() => profile.decodeOnuIndex([pon!, onuId!, 1, 1], 'rxOnu')).toThrow(RangeError);
    expect(() => profile.decodeOnuIndex([pon!, onuId!, 1])).toThrow(RangeError);
  });

  it('rxOnu: maps 65535 to null (no signal) and back', () => {
    expect(profile.rxOnuDbm(RX_NO_SIGNAL)).toBeNull();
    expect(profile.rxOnuRaw(null)).toBe(RX_NO_SIGNAL);
  });

  it('rxOnu: raw * 0.002 - 30 dBm, the inverse of rxOnuRaw over the plausible range', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: RX_ONU_MAX_RAW }), (raw) => {
      expect(profile.rxOnuRaw(profile.rxOnuDbm(raw))).toBe(raw);
    }));
    expect(profile.rxOnuDbm(profile.rxOnuRaw(-18.21))).toBeCloseTo(-18.21, 3);
    expect(profile.rxOnuDbm(7499)).toBe(-15.002); // olt-a 1/1/1:10, CLI -15.001
  });

  it('rxOnu: an implausible raw value is null, not +98.9 dBm', () => {
    fc.assert(fc.property(fc.integer({ min: RX_ONU_MAX_RAW + 1, max: RX_NO_SIGNAL - 1 }), (raw) => {
      expect(profile.rxOnuDbm(raw)).toBeNull();
    }));
    expect(profile.rxOnuDbm(64432)).toBeNull(); // olt-a 1/1/3:15
    expect(profile.rxOnuDbm(-1)).toBeNull();
    expect(profile.rxOnuDbm(profile.rxOnuRaw(25))).toBe(RX_VALID_DBM.max); // encoder clamps
  });

  it('rxOlt: milli-dBm, -80000 = no signal', () => {
    expect(profile.rxOltDbm(RX_OLT_NO_SIGNAL)).toBeNull();
    expect(profile.rxOltRaw(null)).toBe(RX_OLT_NO_SIGNAL);
    expect(profile.rxOltDbm(-20767)).toBe(-20.767); // olt-a 1/1/1:10, CLI -20.767
    fc.assert(fc.property(fc.integer({ min: RX_VALID_DBM.min * 1000, max: RX_VALID_DBM.max * 1000 }), (raw) => {
      expect(profile.rxOltRaw(profile.rxOltDbm(raw))).toBe(raw);
    }));
    expect(profile.rxOltDbm(RX_VALID_DBM.min * 1000 - 1)).toBeNull();
    expect(profile.rxOltDbm(RX_VALID_DBM.max * 1000 + 1)).toBeNull();
    expect(profile.rxOltDbm(profile.rxOltRaw(-70))).toBe(RX_VALID_DBM.min); // encoder clamps
  });

  it('decodes the phase values observed on olt-a; any other raw is unknown', () => {
    const observed = OBSERVED_PHASES[profile.id];
    for (let raw = 0; raw <= 8; raw++) expect(profile.phaseState(raw)).toBe(observed[raw] ?? 'unknown');
    expect(profile.phaseState(99)).toBe('unknown');
  });

  it('phaseRaw is the inverse of phaseState; a state never observed encodes as unknown', () => {
    const observed = new Set(Object.values(OBSERVED_PHASES[profile.id]));
    for (const state of PHASE_STATES) expect(profile.phaseState(profile.phaseRaw(state))).toBe(observed.has(state) ? state : 'unknown');
  });

  it('round-trips serial numbers', () => {
    const sn = fc.tuple(fc.stringMatching(/^[A-Z]{4}$/), fc.stringMatching(/^[0-9A-F]{8}$/)).map(([v, h]) => v + h);
    fc.assert(fc.property(sn, (s) => {
      expect(profile.decodeSerial(profile.encodeSerial(s))).toBe(s);
    }));
    expect(profile.decodeSerial(profile.encodeSerial('ZTEGc1192dd7'))).toBe('ZTEGC1192DD7');
  });
});

describe('detectProfile', () => {
  it.each([
    ['ZXA10 C320, ZTE ZXA10 Software Version: V2.1.0', 'zte-c320-v2.1'],
    ['ZXA10 C320, ZTE ZXA10 Software Version: V2.2.0', 'zte-c320-v2.2'],
    ['ZXA10 C320 V2.3.1P1', 'zte-c320-v2.2'],
  ])('%s -> %s', (descr, id) => {
    expect(detectProfile(descr)?.id).toBe(id);
  });

  it('returns null for other devices', () => {
    expect(detectProfile('Linux router 5.10')).toBeNull();
    expect(detectProfile('ZXA10 C300 V2.1.0')).toBeNull();
  });
});
