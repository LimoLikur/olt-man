import type { PhaseState } from '@olt/olt-spec';
import { describe, expect, it } from 'vitest';
import { type ActiveAlarm, DEFAULT_ALARM_SETTINGS as S, evaluate, keys, type OnuSnapshot, resolveAlarmSettings, type Snapshot } from '../src/alarms/rules/index.js';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 26, 3, 0, 0); // fake clock

/** n ONUs on one port, all working. */
function port(n: number, portKey = '1/1', firstId = 1): OnuSnapshot[] {
  return Array.from({ length: n }, (_, i) => ({ onuId: firstId + i, port: portKey, phase: 'working' as PhaseState, rxDbm: -20, transitions: [] }));
}

function go(onu: OnuSnapshot, to: PhaseState, ts: number): void {
  onu.transitions.push({ ts, from: onu.phase, to });
  onu.phase = to;
}

const snap = (onus: OnuSnapshot[], now: number, active: ActiveAlarm[] = [], oltTimeouts = 0): Snapshot => ({ now, onus, active, oltTimeouts });
const kinds = (alarms: ReturnType<typeof evaluate>, kind: string) => alarms.filter((a) => a.kind === kind);
const asActive = (alarms: ReturnType<typeof evaluate>): ActiveAlarm[] => alarms.map(({ key, kind, severity }) => ({ key, kind, severity }));

describe('pon_mass_los', () => {
  it('5 LOS within 90 s -> 1 mass alarm with 5 children', () => {
    const onus = port(12);
    onus.slice(0, 5).forEach((o, i) => go(o, 'los', T0 + i * 22_500));
    const out = evaluate(snap(onus, T0 + 90_000), S);
    expect(kinds(out, 'pon_mass_los')).toEqual([expect.objectContaining({ key: keys.massLos('1/1'), notify: true })]);
    const children = kinds(out, 'onu_los');
    expect(children).toHaveLength(5);
    expect(children.every((c) => c.parentKey === keys.massLos('1/1') && !c.notify)).toBe(true);
  });

  it('ONUs already LOS before polling started count too (current state, no window)', () => {
    const onus = port(12);
    onus.slice(0, 4).forEach((o) => (o.phase = 'los')); // no transitions in the window
    const out = evaluate(snap(onus, T0), S);
    expect(kinds(out, 'pon_mass_los')).toHaveLength(1);
    expect(kinds(out, 'onu_los').every((a) => a.parentKey === keys.massLos('1/1'))).toBe(true);
  });

  it('3 LOS on a big port -> not mass, plain onu_los', () => {
    const onus = port(12);
    onus.slice(0, 3).forEach((o, i) => go(o, 'los', T0 + i * MIN));
    const out = evaluate(snap(onus, T0 + 3 * MIN), S);
    expect(kinds(out, 'pon_mass_los')).toHaveLength(0);
    expect(kinds(out, 'onu_los').every((a) => a.parentKey === undefined)).toBe(true);
  });

  it('port with 2 ONUs: 1 LOS -> not mass, 2 LOS -> mass (§2.2 no. 10)', () => {
    const onus = port(2);
    go(onus[0]!, 'los', T0);
    expect(kinds(evaluate(snap(onus, T0 + 1000), S), 'pon_mass_los')).toHaveLength(0);
    go(onus[1]!, 'los', T0 + 2000);
    expect(kinds(evaluate(snap(onus, T0 + 3000), S), 'pon_mass_los')).toHaveLength(1);
  });

  it('stays active while enough ONUs are LOS, clears below the threshold', () => {
    const onus = port(12);
    onus.slice(0, 5).forEach((o) => go(o, 'los', T0));
    let out = evaluate(snap(onus, T0 + 10_000), S);
    out = evaluate(snap(onus, T0 + 30 * MIN, asActive(out)), S); // window passed, still 5 LOS
    expect(kinds(out, 'pon_mass_los')).toHaveLength(1);
    onus.slice(0, 2).forEach((o) => go(o, 'working', T0 + 31 * MIN));
    expect(kinds(evaluate(snap(onus, T0 + 31 * MIN, asActive(out)), S), 'pon_mass_los')).toHaveLength(0);
  });

  it('a single DyingGasp -> onu_dying_gasp; en masse -> pon_mass_power holding the ONU alarms', () => {
    const onus = port(12);
    go(onus[0]!, 'dying_gasp', T0);
    expect(evaluate(snap(onus, T0 + 1000), S)).toEqual([expect.objectContaining({ key: keys.dyingGasp(onus[0]!.onuId), kind: 'onu_dying_gasp', notify: false })]);
    onus.slice(1, 5).forEach((o) => go(o, 'dying_gasp', T0 + 2000));
    const out = evaluate(snap(onus, T0 + 3000), S);
    expect(kinds(out, 'pon_mass_power')).toHaveLength(1);
    const children = kinds(out, 'onu_dying_gasp');
    expect(children).toHaveLength(5);
    expect(children.every((c) => c.parentKey === keys.massPower('1/1'))).toBe(true);
  });
});

describe('onu_rx_low (hysteresis 1 dB)', () => {
  it('-26 warning, -27.5 critical, -25.5 stays active, -23.9 clears', () => {
    const [onu] = port(1) as [OnuSnapshot];
    const step = (rx: number, active: ActiveAlarm[]) => {
      onu.rxDbm = rx;
      return kinds(evaluate(snap([onu], T0, active), S), 'onu_rx_low');
    };
    let a = step(-26, []);
    expect(a.map((x) => x.severity)).toEqual(['warning']);
    a = step(-27.5, asActive(a));
    expect(a.map((x) => x.severity)).toEqual(['critical']);
    a = step(-25.5, asActive(a));
    expect(a).toHaveLength(1);
    a = step(-23.9, asActive(a));
    expect(a).toHaveLength(0);
  });

  it('-25.5 without an active alarm is not raised; no reading keeps the state', () => {
    const [onu] = port(1) as [OnuSnapshot];
    onu.rxDbm = -25.5;
    expect(kinds(evaluate(snap([onu], T0), S), 'onu_rx_low').map((a) => a.severity)).toEqual(['warning']);
    onu.rxDbm = -24.5;
    expect(kinds(evaluate(snap([onu], T0), S), 'onu_rx_low')).toHaveLength(0);
    onu.rxDbm = null;
    expect(kinds(evaluate(snap([onu], T0, [{ key: keys.rxLow(1), kind: 'onu_rx_low', severity: 'critical' }]), S), 'onu_rx_low')[0]!.severity).toBe('critical');
  });
});

describe('onu_flapping', () => {
  const flap = (gapMs: number) => {
    const [onu] = port(1) as [OnuSnapshot];
    for (let i = 0; i < 3; i++) {
      go(onu, 'los', T0 + i * gapMs);
      go(onu, 'working', T0 + i * gapMs + 30_000);
    }
    return onu;
  };

  it('3 drops within 59 minutes -> flapping (Telegram)', () => {
    const onu = flap(29.5 * MIN);
    expect(kinds(evaluate(snap([onu], T0 + 59 * MIN), S), 'onu_flapping')).toEqual([expect.objectContaining({ notify: true })]);
  });

  it('3 drops spread over 61 minutes -> not flapping', () => {
    const onu = flap(30.5 * MIN);
    expect(kinds(evaluate(snap([onu], T0 + 61 * MIN), S), 'onu_flapping')).toHaveLength(0);
  });

  it('DyingGasp does not count as a drop', () => {
    const [onu] = port(1) as [OnuSnapshot];
    for (let i = 0; i < 3; i++) {
      go(onu, 'dying_gasp', T0 + i * MIN);
      go(onu, 'working', T0 + i * MIN + 10_000);
    }
    expect(evaluate(snap([onu], T0 + 5 * MIN), S)).toEqual([]);
  });

  it('clears after an hour without drops; LOS during flapping is its child', () => {
    const onu = flap(5 * MIN);
    go(onu, 'los', T0 + 11 * MIN);
    const out = evaluate(snap([onu], T0 + 11 * MIN), S);
    expect(kinds(out, 'onu_los')[0]!.parentKey).toBe(keys.flapping(1));
    go(onu, 'working', T0 + 12 * MIN);
    expect(kinds(evaluate(snap([onu], T0 + 60 * MIN, asActive(out)), S), 'onu_flapping')).toHaveLength(1);
    expect(kinds(evaluate(snap([onu], T0 + 11 * MIN + 61 * MIN, asActive(out)), S), 'onu_flapping')).toHaveLength(0);
  });

  it('mock-fast profile shortens the windows, not the thresholds', () => {
    const fast = resolveAlarmSettings({ profile: 'mock-fast' });
    expect(fast.flapWindowMs).toBeLessThan(S.flapWindowMs);
    expect([fast.flapCount, fast.rxWarnDbm, fast.massMinCount]).toEqual([S.flapCount, S.rxWarnDbm, S.massMinCount]);
    expect(resolveAlarmSettings({ profile: 'mock-fast', flapCount: 4 }).flapCount).toBe(4);
  });
});

describe('olt_unreachable', () => {
  it('2 timeouts -> alarm; ONU alarms are held as its children, without Telegram', () => {
    const onus = port(3);
    go(onus[0]!, 'los', T0);
    const before = evaluate(snap(onus, T0), S);
    expect(kinds(evaluate(snap(onus, T0 + MIN, asActive(before), 1), S), 'olt_unreachable')).toHaveLength(0);
    const out = evaluate(snap(onus, T0 + 2 * MIN, asActive(before), 2), S);
    expect(kinds(out, 'olt_unreachable')).toEqual([expect.objectContaining({ notify: true })]);
    expect(kinds(out, 'onu_los')).toEqual([expect.objectContaining({ parentKey: keys.unreachable(), notify: false })]);
    expect(kinds(evaluate(snap(onus, T0 + 3 * MIN, asActive(out), 0), S), 'olt_unreachable')).toHaveLength(0);
  });
});

describe('onu_los', () => {
  it('a single LOS -> onu_los without Telegram; back to working clears it', () => {
    const onus = port(12);
    go(onus[3]!, 'los', T0);
    expect(evaluate(snap(onus, T0 + 1000), S)).toEqual([expect.objectContaining({ kind: 'onu_los', onuId: 4, notify: false })]);
    go(onus[3]!, 'working', T0 + MIN);
    expect(evaluate(snap(onus, T0 + MIN), S)).toEqual([]);
  });
});
