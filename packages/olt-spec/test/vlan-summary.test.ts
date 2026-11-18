import { describe, expect, it } from 'vitest';
import { ParseError, parseVlanSummary, showVlanSummary } from '../src/index.js';

// Recorded on the owner's C320 (olt `map`), 2026-11-13.
const REAL = ['All created vlan num: 14  ', 'Details are following:', '    1,500,600,1410,1413,1416,1420-1421,1423,1427,1500-1502,1507'].join('\r\n');

describe('show vlan summary', () => {
  it('is a read command', () => {
    expect(showVlanSummary()).toMatchObject({ text: 'show vlan summary', kind: 'read' });
  });

  it('parses the real output: ranges expanded, count matches', () => {
    expect(parseVlanSummary(REAL)).toEqual({ total: 14, vlans: [1, 500, 600, 1410, 1413, 1416, 1420, 1421, 1423, 1427, 1500, 1501, 1502, 1507] });
  });

  it('accepts a list wrapped over several lines', () => {
    const wrapped = ['All created vlan num: 5', 'Details are following:', '    1,100,', '    1245-1247'].join('\n');
    expect(parseVlanSummary(wrapped).vlans).toEqual([1, 100, 1245, 1246, 1247]);
  });

  it('joins a list the OLT wrapped at 80 columns inside a range (recorded on jangli, 2026-11-14)', () => {
    const jangli = [
      'All created vlan num: 32',
      'Details are following:',
      '    1,10,21-28,30,61-63,69,117,169,271,276,700,1400,1423,1426,1428,1430,1500-150',
      '1,1504-1505,1508,1600,3409',
    ].join('\r\n');
    expect(jangli.split('\r\n')[2]).toHaveLength(80);
    const { total, vlans } = parseVlanSummary(jangli);
    expect(total).toBe(32);
    expect(vlans).toEqual([1, 10, 21, 22, 23, 24, 25, 26, 27, 28, 30, 61, 62, 63, 69, 117, 169, 271, 276, 700, 1400, 1423, 1426, 1428, 1430, 1500, 1501, 1504, 1505, 1508, 1600, 3409]);
  });

  it('no VLAN besides the announced zero', () => {
    expect(parseVlanSummary('All created vlan num: 0\nDetails are following:\n')).toEqual({ total: 0, vlans: [] });
  });

  it.each([
    ['a count that does not match', REAL.replace('num: 14', 'num: 15')],
    ['no count line', 'Details are following:\n 1,2'],
    ['an unexpected item', REAL.replace('1507', '1507 name-x')],
    ['VLAN 0', REAL.replace('1,500', '0,500')],
    ['VLAN 4095', REAL.replace('1507', '4095')],
    ['a reversed range', REAL.replace('1420-1421', '1421-1420')],
  ])('refuses %s', (_label, raw) => {
    expect(() => parseVlanSummary(raw)).toThrow(ParseError);
  });
});
