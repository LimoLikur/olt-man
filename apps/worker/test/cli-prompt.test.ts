import { describe, expect, it } from 'vitest';
import { LOGIN_PROMPT, promptFor } from '../src/cli/olt-cli.session.js';

const hostname = (screen: string) => LOGIN_PROMPT.exec(screen)?.[1];

describe('CLI prompt', () => {
  it('knows the first prompt after login whatever the hostname, and reads the hostname', () => {
    expect(hostname('\r\nZXAN#')).toBe('ZXAN');
    expect(hostname('Welcome\r\n\r\nOLT-ZTE_C320#')).toBe('OLT-ZTE_C320');
    expect(hostname('\r\nOLT_ZTE_C320# ')).toBe('OLT_ZTE_C320');
    // The real C320 at jangli: "@" is not in the manual's examples.
    expect(hostname('\r\nOLT-DUD@JGL#')).toBe('OLT-DUD@JGL');
    expect(hostname('\r\nOLT.JKT/01:A#')).toBe('OLT.JKT/01:A');
    expect(hostname('\r\nZXAN(config-if)#')).toBe('ZXAN');
  });

  it('is not fooled by user mode, banner text or an unfinished screen', () => {
    for (const screen of ['\r\nOLT-DUD@JGL>', '\r\nWelcome to ZXA10 C320#', '\r\n#####', '\r\nOLT-DUD@JGL', '\r\nOLT-DUD@JGL#\r\nmore', `\r\n${'A'.repeat(65)}#`]) {
      expect(hostname(screen), screen).toBeUndefined();
    }
  });

  it("then waits for this OLT's own prompt only, in any mode", () => {
    const prompt = promptFor('OLT-DUD@JGL');
    expect(prompt.test('show card\r\nRack Shelf Slot\r\nOLT-DUD@JGL#')).toBe(true);
    expect(prompt.test('\r\nOLT-DUD@JGL(gpon-onu-mng)# ')).toBe(true);
    // Real C320 V2.1 shows the ONU index in pon-onu-mng mode (job #93 timed out on this).
    expect(promptFor('OLT-MAXXPLUS').test('\r\nOLT-MAXXPLUS(gpon-onu-mng 1/2/8:2)#')).toBe(true);
    expect(LOGIN_PROMPT.exec('\r\nOLT-MAXXPLUS(gpon-onu-mng 1/2/8:2)#')?.[1]).toBe('OLT-MAXXPLUS');
    // Output lines that look like some prompt are not the end of the output.
    for (const screen of ['\r\nkey:abc#', '\r\nZXAN#', '\r\nOLT-DUD@JGL2#', '\r\nXOLT-DUD@JGL#', '\r\nOLT-DUD@JGL#\r\nmore']) {
      expect(prompt.test(screen), screen).toBe(false);
    }
  });

  it('takes regex characters in a hostname literally', () => {
    expect(promptFor('OLT.A+1').test('\r\nOLT.A+1#')).toBe(true);
    expect(promptFor('OLT.A+1').test('\r\nOLTxAA1#')).toBe(false);
    expect(promptFor('A[1]$').test('\r\nA[1]$#')).toBe(true);
  });
});
