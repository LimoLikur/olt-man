import { describe, expect, it } from 'vitest';
import { age, ago, duration, initials, oidProfileLabel, onuStatusText, pct, plural, setTimeZone } from './format';

describe('format', () => {
  it('shows the last known ONU phase while the OLT is not ok (SPEC §8.2)', () => {
    setTimeZone('UTC');
    expect(onuStatusText('working', 'unreachable', '2026-11-14T10:42:05Z')).toBe('Unknown (last: working, 10:42)');
    expect(onuStatusText('los', 'ok', null)).toBe('LOS');
    expect(onuStatusText(null, 'ok', null)).toBe('—');
  });

  it('labels the OID profile with the C320 model', () => {
    expect(oidProfileLabel('zte-c320-v2.1')).toBe('C320 V2.1');
    expect(oidProfileLabel('zte-c320-v2.2')).toBe('C320 V2.2');
    expect(oidProfileLabel('other')).toBe('other');
  });

  it('formats ages, durations and shares', () => {
    expect(age(null)).toBe('never');
    expect(age(42)).toBe('42 s');
    expect(age(125)).toBe('2 min');
    expect(age(7300)).toBe('2 h');
    expect(duration(93_784)).toBe('1d 2h');
    expect(duration(3_900)).toBe('1h 5m');
    expect(duration(null)).toBe('—');
    expect(pct(1, 8, 1)).toBe('12.5%');
    expect(pct(3, 0)).toBe('—');
    expect(plural(1, 'OLT')).toBe('1 OLT');
    expect(plural(1204, 'ONU')).toBe('1,204 ONUs');
    expect(plural(0, 'port')).toBe('0 ports');
  });

  it('formats relative times', () => {
    const now = Date.parse('2026-11-14T12:00:00Z');
    expect(ago('2026-11-14T11:59:50Z', now)).toBe('just now');
    expect(ago('2026-11-14T11:55:00Z', now)).toBe('5 minutes ago');
    expect(ago('2026-11-14T10:00:00Z', now)).toBe('2 hours ago');
    expect(ago('2026-11-12T12:00:00Z', now)).toBe('2 days ago');
    expect(ago(null, now)).toBe('—');
  });

  it('builds avatar initials from usernames', () => {
    expect(initials('admin')).toBe('AD');
    expect(initials('budi santoso')).toBe('BS');
    expect(initials('noc-ops')).toBe('NO');
  });
});
