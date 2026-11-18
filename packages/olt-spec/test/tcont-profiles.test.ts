import { describe, expect, it } from 'vitest';
import { ParseError, parseTcontProfiles, showTcontProfiles } from '../src/index.js';

// Recorded on the owner's C320 (olt `map`), 2026-11-13 (trailing spaces kept).
const REAL = [
  `Profile name :default  `,
  ` Type           FBW(kbps)   ABW(kbps)   MBW(kbps)   PRIORITY   WEIGHT    `,
  ` 1              10000       0           0           N/A         N/A         `,
  ` `,
  `Profile name :100M  `,
  ` Type           FBW(kbps)   ABW(kbps)   MBW(kbps)   PRIORITY   WEIGHT    `,
  ` 4              0           0           102400      N/A         N/A         `,
  ` `,
  `Profile name :50M  `,
  ` Type           FBW(kbps)   ABW(kbps)   MBW(kbps)   PRIORITY   WEIGHT    `,
  ` 4              0           0           51200       N/A         N/A         `,
  ` `,
  `Profile name :200M  `,
  ` Type           FBW(kbps)   ABW(kbps)   MBW(kbps)   PRIORITY   WEIGHT    `,
  ` 4              0           0           204800      N/A         N/A         `,
  ` `,
  `Profile name :5M  `,
  ` Type           FBW(kbps)   ABW(kbps)   MBW(kbps)   PRIORITY   WEIGHT    `,
  ` 3              0           64          5000        N/A         N/A         `,
  ` `,
  `Profile name :400M  `,
  ` Type           FBW(kbps)   ABW(kbps)   MBW(kbps)   PRIORITY   WEIGHT    `,
  ` 3              0           350000      500000      N/A         N/A         `,
  ` `,
  `Profile name :30M  `,
  ` Type           FBW(kbps)   ABW(kbps)   MBW(kbps)   PRIORITY   WEIGHT    `,
  ` 4              0           0           30000       N/A         N/A         `,
  ` `,
  `Profile name :300M  `,
  ` Type           FBW(kbps)   ABW(kbps)   MBW(kbps)   PRIORITY   WEIGHT    `,
  ` 4              0           0           307200      N/A         N/A`,
].join('\r\n');

describe('show gpon profile tcont', () => {
  it('is a read command', () => {
    expect(showTcontProfiles()).toMatchObject({ text: 'show gpon profile tcont', kind: 'read' });
  });

  it('parses the real output: every profile with its type and bandwidths', () => {
    const { profiles } = parseTcontProfiles(REAL);
    expect(profiles.map((p) => p.name)).toEqual(['default', '100M', '50M', '200M', '5M', '400M', '30M', '300M']);
    expect(profiles[0]).toEqual({ name: 'default', type: 1, fbwKbps: 10000, abwKbps: 0, mbwKbps: 0 });
    expect(profiles[5]).toEqual({ name: '400M', type: 3, fbwKbps: 0, abwKbps: 350000, mbwKbps: 500000 });
  });

  it.each([
    ['a block without its header', REAL.replace(/ Type {11}FBW\(kbps\)[^\r]*\r\n 4 {14}0 {11}0 {11}102400/, ' 4              0           0           102400')],
    ['a block without values', REAL.replace(' 1              10000       0           0           N/A         N/A         ', ' -')],
    ['an unknown line', `${REAL}\r\nTotal: 8`],
    ['no profile at all', ''],
  ])('refuses %s', (_label, raw) => {
    expect(() => parseTcontProfiles(raw)).toThrow(ParseError);
  });

  it('returns a name as printed, even one a template cannot use (the caller filters)', () => {
    const odd = REAL.replace('Profile name :5M', 'Profile name :5M/up');
    expect(parseTcontProfiles(odd).profiles.map((p) => p.name)).toContain('5M/up');
  });
});
