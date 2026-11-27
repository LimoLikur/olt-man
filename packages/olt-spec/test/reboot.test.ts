import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { CONTROL_CHARS, previewSha256, REBOOT_QUESTION, rebootOnu, renderPreview, writeConfig } from '../src/index.js';

// The owner's session on a C320 (2026-11-27): `restart` is invalid there, `reboot` asks first.
const onu = { slot: 1, port: 8, onuId: 4, sn: 'PTEGA57AC1EE' };

describe('rebootOnu (SPEC §8.5, owner decision 2026-11-27)', () => {
  it("renders the owner's session, the answer to the OLT's question included", () => {
    expect(renderPreview(rebootOnu(onu))).toBe(['configure terminal', 'pon-onu-mng gpon-onu_1/1/8:4', 'reboot', 'yes', 'end'].join('\n'));
  });

  it('only `reboot` is a write; it answers the OLT question with yes; no `write`', () => {
    const commands = rebootOnu(onu);
    expect(commands.map((c) => c.kind)).toEqual(['session', 'session', 'write', 'session']);
    expect(commands[2]!.confirm).toEqual({ question: REBOOT_QUESTION, answer: 'yes' });
    expect(commands.some((c) => c.text === 'write')).toBe(false);
    expect(commands.filter((c) => c !== commands[2]).every((c) => c.confirm === undefined && c.inMode === undefined)).toBe(true);
  });

  it("knows the OLT's question as it appears at the end of the screen", () => {
    expect(REBOOT_QUESTION.test('reboot\r\nConfirm to reboot? [yes/no]:')).toBe(true);
    expect(REBOOT_QUESTION.test('reboot\r\nConfirm to reboot?[yes/no]: ')).toBe(true);
    expect(REBOOT_QUESTION.test('Confirm to reboot? [yes/no]:yes\r\nZXAN#')).toBe(false);
  });

  it("`reboot` may only go out in this ONU's pon-onu-mng mode", () => {
    const { inMode } = rebootOnu(onu)[2]!;
    expect(inMode!.test('(gpon-onu-mng 1/1/8:4)')).toBe(true);
    // The manual's prompt has no ONU index.
    expect(inMode!.test('(gpon-onu-mng)')).toBe(true);
    for (const mode of ['', '(config)', '(config-if)', '(gpon-onu-mng 1/1/8:40)', '(gpon-onu-mng 1/1/18:4)', '(gpon-onu-mng 1/1/8:4) ']) {
      expect(inMode!.test(mode), mode).toBe(false);
    }
  });

  it('stores the SN upper-case and hashes the preview: another ONU or SN, another hash', () => {
    expect(rebootOnu({ ...onu, sn: 'ptega57ac1ee' })).toEqual(rebootOnu(onu));
    const hash = previewSha256(renderPreview(rebootOnu(onu)));
    expect(previewSha256(renderPreview(rebootOnu({ ...onu, onuId: 5 })))).not.toBe(hash);
  });

  it('leaves the preview of commands without a question as it was', () => {
    expect(renderPreview([writeConfig()])).toBe('write');
  });

  it.each([
    ['SN with CR/LF', { sn: 'ZTEG0000000\r\nreboot' }],
    ['SN with a space', { sn: 'ZTEG 0000000' }],
    ['onuId 129', { onuId: 129 }],
    ['onuId 0', { onuId: 0 }],
    ['port 17', { port: 17 }],
    ['slot as text', { slot: '1' }],
    ['extra field', { extra: 'x' }],
    ['no SN', { sn: undefined }],
  ])('rejects %s', (_label, change) => {
    expect(() => rebootOnu({ ...onu, ...change } as never)).toThrow(ZodError);
  });

  it('random input is rejected or yields lines without control characters', () => {
    fc.assert(
      fc.property(fc.record({ sn: fc.string(), slot: fc.integer(), port: fc.integer(), onuId: fc.integer() }), (r) => {
        try {
          for (const line of renderPreview(rebootOnu(r)).split('\n')) expect(line).not.toMatch(CONTROL_CHARS);
        } catch (e) {
          expect(e).toBeInstanceOf(ZodError);
        }
      }),
      { numRuns: 2000 },
    );
  });
});
