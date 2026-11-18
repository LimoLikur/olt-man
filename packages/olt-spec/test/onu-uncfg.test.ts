import { describe, expect, it } from 'vitest';
import { NO_RELATED_INFO, ParseError, parseOnuUncfg, showOnuUncfg } from '../src/index.js';

// Recorded on the owner's C320s, 2026-11-13.
const NONE = '%Code 62310-GPONSRV : No related information to show.';
const SOME = [
  'OnuIndex                 Sn                  State',
  '---------------------------------------------------------------------',
  'gpon-onu_1/1/1:1         HWTCAADBEF5B        unknown',
  'gpon-onu_1/1/1:2         FHTT07575020        unknown',
  'gpon-onu_1/1/1:3         ZTEGC8A29E56        unknown',
  'gpon-onu_1/1/1:4         ZTEGC8A29DC9        unknown',
].join('\r\n');

describe('show gpon onu uncfg', () => {
  it('is a read command', () => expect(showOnuUncfg()).toMatchObject({ text: 'show gpon onu uncfg', kind: 'read' }));

  it('"No related information" -> no ONU', () => {
    expect(NO_RELATED_INFO.test(NONE)).toBe(true);
    expect(parseOnuUncfg(NONE)).toEqual({ onus: [] });
  });

  it('parses the real rows', () => {
    expect(parseOnuUncfg(SOME).onus).toEqual([
      { slot: 1, port: 1, index: 1, sn: 'HWTCAADBEF5B', state: 'unknown' },
      { slot: 1, port: 1, index: 2, sn: 'FHTT07575020', state: 'unknown' },
      { slot: 1, port: 1, index: 3, sn: 'ZTEGC8A29E56', state: 'unknown' },
      { slot: 1, port: 1, index: 4, sn: 'ZTEGC8A29DC9', state: 'unknown' },
    ]);
  });

  it.each([
    ['no header', 'gpon-onu_1/1/1:1 HWTCAADBEF5B unknown'],
    ['an odd row', `${SOME}\r\ngpon-onu_1/1/1:5 ZTEG 1234 unknown`],
  ])('refuses %s', (_l, raw) => expect(() => parseOnuUncfg(raw)).toThrow(ParseError));
});
