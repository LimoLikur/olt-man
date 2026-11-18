import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  type AllowedCommand,
  CONTROL_CHARS,
  showAttenuation,
  showCard,
  showOnuDetail,
  showOnuInterface,
  showOnuMngConfig,
  showOnuRunningConfig,
  showOnuState,
  showPortRunningConfig,
} from '../src/index.js';

const pon = { slot: 2, port: 5 };
const onu = { slot: 2, port: 5, onuId: 5 };

describe('read builders (SPEC §6.2)', () => {
  it.each<[string, () => AllowedCommand, string]>([
    ['showOnuState', () => showOnuState(pon), 'show gpon onu state gpon-olt_1/2/5'],
    ['showOnuState (ONU)', () => showOnuState(pon, 4), 'show gpon onu state gpon-olt_1/2/5 4'],
    ['showPortRunningConfig', () => showPortRunningConfig(pon), 'show running-config interface gpon-olt_1/2/5'],
    ['showOnuDetail', () => showOnuDetail(onu), 'show gpon onu detail-info gpon-onu_1/2/5:5'],
    ['showAttenuation', () => showAttenuation(onu), 'show pon power attenuation gpon-onu_1/2/5:5'],
    ['showOnuInterface', () => showOnuInterface(onu), 'show interface gpon-onu_1/2/5:5'],
    ['showOnuRunningConfig', () => showOnuRunningConfig(onu), 'show running-config interface gpon-onu_1/2/5:5'],
    ['showOnuMngConfig', () => showOnuMngConfig(onu), 'show onu running config gpon-onu_1/2/5:5'],
    ['showCard', () => showCard(), 'show card'],
  ])('%s', (_name, build, text) => {
    const cmd = build();
    expect(cmd.text).toBe(text);
    expect(cmd.kind).toBe('read');
    expect(Object.isFrozen(cmd)).toBe(true);
  });

  it('rejects onuId 129 and other out-of-range parts', () => {
    expect(() => showOnuDetail({ ...onu, onuId: 129 })).toThrow(ZodError);
    expect(() => showOnuState(pon, 129)).toThrow(ZodError);
    expect(() => showOnuDetail({ ...onu, onuId: 0 })).toThrow(ZodError);
    expect(() => showOnuDetail({ ...onu, slot: 1.5 })).toThrow(ZodError);
  });

  it('rejects extra keys and non-numbers', () => {
    expect(() => showOnuDetail({ ...onu, extra: 1 } as never)).toThrow(ZodError);
    expect(() => showOnuDetail({ ...onu, onuId: '5\r\nreboot' } as never)).toThrow(ZodError);
  });

  it('random input is either rejected by Zod or yields a command without control characters', () => {
    const builders = [showOnuDetail, showAttenuation, showOnuInterface, showOnuRunningConfig, showOnuMngConfig];
    fc.assert(
      fc.property(fc.anything(), fc.anything(), fc.anything(), fc.integer({ min: 0, max: builders.length - 1 }), (slot, port, onuId, i) => {
        try {
          const cmd = builders[i]!({ slot, port, onuId } as never);
          expect(cmd.text).not.toMatch(CONTROL_CHARS);
        } catch (e) {
          expect(e).toBeInstanceOf(ZodError);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('a plain object cannot pose as an AllowedCommand', () => {
    // @ts-expect-error -- the brand is a module-private symbol
    const forged: AllowedCommand = { text: 'write', kind: 'write' };
    // @ts-expect-error -- not even with the brand field spelled out by hand
    const forged2: AllowedCommand = { text: 'write', kind: 'write', __brand: 'AllowedCommand' };
    expect([forged, forged2]).toHaveLength(2);
  });
});
