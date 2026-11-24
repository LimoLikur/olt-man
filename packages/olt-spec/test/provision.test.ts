import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  CommandBuildError,
  CONTROL_CHARS,
  expectedRegistrationLines,
  previewSha256,
  registerOnu,
  registerOnuAndSave,
  registerOnuBridge,
  registerOnuBridgeStatic,
  registerOnuInternet,
  registerOnuPppoeJgl,
  registerOnuPppoeMap,
  renderPreview,
  writeConfig,
} from '../src/index.js';

// Manual Bab IV-A example (hlm. 12-14): 1/1/1:1, ZTEG-F620, ZTEG00000002, T-CONT 10M, VLAN 100.
const manual = { slot: 1, port: 1, onuId: 1, sn: 'ZTEG00000002', name: 'Pelanggan-01', onuType: 'ZTEG-F620', tcontProfile: '10M', vlan: 100 };

describe('registerOnuInternet (SPEC §8.5)', () => {
  it('renders the template for the manual example', () => {
    expect(renderPreview(registerOnuInternet(manual))).toBe(
      [
        'configure terminal',
        'interface gpon-olt_1/1/1',
        'onu 1 type ZTEG-F620 sn ZTEG00000002',
        'exit',
        'interface gpon-onu_1/1/1:1',
        'name Pelanggan-01',
        'tcont 1 name T1 profile 10M',
        'gemport 1 name gemport1 unicast tcont 1',
        'service-port 1 vport 1 user-vlan 100 vlan 100',
        'exit',
        'pon-onu-mng gpon-onu_1/1/1:1',
        'service HSI type internet gemport 1 cos 0 vlan 100',
        'vlan port eth_0/1 mode tag vlan 100 priority 0',
        'end',
      ].join('\n'),
    );
  });

  it('marks config lines as write and mode changes as session', () => {
    const kinds = registerOnuInternet(manual).map((c) => c.kind);
    expect(kinds.filter((k) => k === 'write')).toHaveLength(7);
    expect(kinds[0]).toBe('session');
    expect(writeConfig()).toMatchObject({ text: 'write', kind: 'write' });
  });

  it('registerOnuAndSave: the registration, then `write` as the last previewed (hashed) line', () => {
    const plan = registerOnuAndSave(manual);
    expect(plan.slice(0, -1)).toEqual(registerOnuInternet(manual));
    expect(plan.at(-1)).toMatchObject({ text: 'write', kind: 'write' });
    expect(renderPreview(plan).split('\n').at(-1)).toBe('write');
  });

  it('stores the SN upper-case', () => {
    expect(renderPreview(registerOnuInternet({ ...manual, sn: 'zteg0000000a' }))).toContain('sn ZTEG0000000A');
  });

  it.each([
    ['SN with CR/LF', { sn: 'ZTEG0000000\r\nreboot' }],
    ['SN too long', { sn: 'ZTEG000000021' }],
    ['name with ;', { name: 'a;reboot' }],
    ['name with a space', { name: 'Pelanggan 01' }],
    ['name with a newline', { name: 'Pelanggan\n01' }],
    ['onuType with a space', { onuType: 'ZTEG F620' }],
    ['VLAN 0', { vlan: 0 }],
    ['VLAN 4095', { vlan: 4095 }],
    ['onuId 129', { onuId: 129 }],
    ['extra field', { extra: 'x' }],
  ])('rejects %s', (_label, change) => {
    expect(() => registerOnuInternet({ ...manual, ...change } as never)).toThrow(ZodError);
  });

  it('random input is rejected or yields commands without control characters', () => {
    fc.assert(
      fc.property(fc.record({ sn: fc.string(), name: fc.string(), onuType: fc.string(), tcontProfile: fc.string(), vlan: fc.integer(), onuId: fc.integer() }), (r) => {
        try {
          for (const c of registerOnuInternet({ ...manual, ...r })) expect(c.text).not.toMatch(CONTROL_CHARS);
        } catch (e) {
          expect(e).toBeInstanceOf(ZodError);
        }
      }),
      { numRuns: 2000 },
    );
  });
});

// The owner's field configuration (2026-11-14), name and description without spaces.
const field = {
  mode: 'bridge' as const,
  slot: 1,
  port: 6,
  onuId: 13,
  sn: 'ZTEGC0000013',
  name: 'Carku-2-Maxindo',
  description: 'Carku-2',
  onuType: 'ZTE-F609',
  tcontProfile: '100M',
  vlan: 30,
  lanPorts: 4,
};

describe('registerOnuBridge (SPEC §8.5, mode bridge)', () => {
  it("renders the owner's configuration: the ONU interface, then pon-onu-mng", () => {
    expect(renderPreview(registerOnuBridge(field))).toBe(
      [
        'configure terminal',
        'interface gpon-olt_1/1/6',
        'onu 13 type ZTE-F609 sn ZTEGC0000013',
        'exit',
        'interface gpon-onu_1/1/6:13',
        'name Carku-2-Maxindo',
        'description Carku-2',
        'sn-bind enable sn',
        'tcont 1 profile 100M',
        'gemport 1 name bridging tcont 1',
        'service-port 1 vport 1 user-vlan 30 vlan 30',
        'port-identification sub-option remote-id enable vport 1',
        'exit',
        'pon-onu-mng gpon-onu_1/1/6:13',
        'service bridging gemport 1 vlan 30',
        'switchport-bind switch_0/1 veip 1',
        'vlan port eth_0/1 mode tag vlan 30',
        'vlan port eth_0/2 mode tag vlan 30',
        'vlan port eth_0/3 mode tag vlan 30',
        'vlan port eth_0/4 mode tag vlan 30',
        'end',
      ].join('\n'),
    );
  });

  it('marks mode changes as session and every config line as write', () => {
    const commands = registerOnuBridge(field);
    expect(commands.filter((c) => c.kind === 'session').map((c) => c.text)).toEqual([
      'configure terminal',
      'interface gpon-olt_1/1/6',
      'exit',
      'interface gpon-onu_1/1/6:13',
      'exit',
      'pon-onu-mng gpon-onu_1/1/6:13',
      'end',
    ]);
    expect(commands.filter((c) => c.kind === 'write')).toHaveLength(14);
  });

  it('has no vport 2 line since 2026-11-17: only Bridge Static uses vport 2', () => {
    expect(renderPreview(registerOnuBridge(field))).not.toContain('vport 2');
  });

  it('leaves out the description line without a description, and tags only the chosen LAN ports', () => {
    const { description: _, ...noDescription } = field;
    expect(renderPreview(registerOnuBridge(noDescription))).not.toContain('description');
    const ports = (lanPorts: number) => renderPreview(registerOnuBridge({ ...field, lanPorts })).split('\n').filter((l) => l.startsWith('vlan port'));
    expect(ports(1)).toEqual(['vlan port eth_0/1 mode tag vlan 30']);
    expect(ports(2)).toEqual(['vlan port eth_0/1 mode tag vlan 30', 'vlan port eth_0/2 mode tag vlan 30']);
  });

  it.each([
    ['a description with a space', { description: 'Carku 2' }],
    ['a description with ;', { description: 'a;reboot' }],
    ['a description with a newline', { description: 'Carku\n2' }],
    ['an empty description', { description: '' }],
    ['a name with a space', { name: 'Carku 2 Maxindo' }],
    ['0 LAN ports', { lanPorts: 0 }],
    ['5 LAN ports', { lanPorts: 5 }],
    ['1.5 LAN ports', { lanPorts: 1.5 }],
    ['no LAN port count', { lanPorts: undefined }],
    ['an unknown mode', { mode: 'pppoe' }],
  ])('rejects %s', (_label, change) => {
    expect(() => registerOnu({ ...field, ...change } as never)).toThrow(ZodError);
  });

  it('random input is rejected or yields commands without control characters', () => {
    fc.assert(
      fc.property(fc.record({ name: fc.string(), description: fc.string(), tcontProfile: fc.string(), vlan: fc.integer(), lanPorts: fc.integer() }), (r) => {
        try {
          for (const c of registerOnuBridge({ ...field, ...r })) expect(c.text).not.toMatch(CONTROL_CHARS);
        } catch (e) {
          expect(e).toBeInstanceOf(ZodError);
        }
      }),
      { numRuns: 2000 },
    );
  });
});

// The owner's PPPoE MAP configuration (2026-11-15) with made-up customer data.
const pppoe = {
  mode: 'pppoe_map' as const,
  slot: 1,
  port: 2,
  onuId: 8,
  sn: 'ZTEGC0000008',
  name: 'Pelanggan-PPPoE',
  description: 'Blok-A01',
  onuType: 'ZTE-F609',
  tcontProfile: '100M',
  vlan: 600,
  pppoeUsername: 'AUD-03-00001-001',
  pppoePassword: 'rahasia.123',
};

// PPPoE-JGL (owner decision 2026-11-25): the PPPoE MAP template, vlan-profile "briding".
describe('registerOnuPppoeJgl (SPEC §8.5, mode pppoe_jgl)', () => {
  const jgl = { ...pppoe, mode: 'pppoe_jgl' as const, port: 10, onuId: 2, vlan: 1501, pppoeUsername: 'AUD-03-00390-001' };

  it('is PPPoE MAP line for line except the vlan-profile', () => {
    const map = renderPreview(registerOnuAndSave({ ...jgl, mode: 'pppoe_map' })).split('\n');
    const got = renderPreview(registerOnuAndSave(jgl)).split('\n');
    expect(got).toHaveLength(map.length);
    const diff = got.map((l, i) => [map[i], l]).filter(([a, b]) => a !== b);
    expect(diff).toEqual([
      [
        'wan-ip 1 mode pppoe username AUD-03-00390-001 password rahasia.123 vlan-profile PPPoE host 1',
        'wan-ip 1 mode pppoe username AUD-03-00390-001 password rahasia.123 vlan-profile briding host 1',
      ],
    ]);
    expect(renderPreview(registerOnu(jgl))).toBe(renderPreview(registerOnuPppoeJgl(jgl)));
  });

  it('requires the PPPoE account, same verification lines, and each builder refuses the other mode', () => {
    const { pppoePassword: _, ...noPassword } = jgl;
    expect(() => registerOnu(noPassword)).toThrow(ZodError);
    expect(() => registerOnu({ ...jgl, lanPorts: 2 })).toThrow(ZodError);
    expect(expectedRegistrationLines(jgl)).toEqual(expectedRegistrationLines({ ...jgl, mode: 'pppoe_map' }));
    expect(() => registerOnuPppoeJgl(pppoe)).toThrow(CommandBuildError);
    expect(() => registerOnuPppoeMap(jgl)).toThrow(CommandBuildError);
  });
});

describe('registerOnuPppoeMap (SPEC §8.5, mode pppoe_map)', () => {
  it("renders the owner's configuration: the ONU interface, then pon-onu-mng", () => {
    expect(renderPreview(registerOnuPppoeMap(pppoe))).toBe(
      [
        'configure terminal',
        'interface gpon-olt_1/1/2',
        'onu 8 type ZTE-F609 sn ZTEGC0000008',
        'exit',
        'interface gpon-onu_1/1/2:8',
        'name Pelanggan-PPPoE',
        'description Blok-A01',
        'sn-bind enable sn',
        'tcont 1 profile 100M',
        'gemport 1 name AUD tcont 1',
        'service-port 1 vport 1 user-vlan 600 vlan 600',
        'pppoe-intermediate-agent enable sport 1',
        'exit',
        'pon-onu-mng gpon-onu_1/1/2:8',
        'service AUD gemport 1 vlan 600',
        'wan-ip 1 mode pppoe username AUD-03-00001-001 password rahasia.123 vlan-profile PPPoE host 1',
        'wan-ip 1 ping-response enable traceroute-response enable',
        'security-mgmt 1 state enable mode forward protocol web',
        'end',
      ].join('\n'),
    );
  });

  it('marks mode changes as session and every config line as write; no description line without one', () => {
    const commands = registerOnuPppoeMap(pppoe);
    expect(commands.filter((c) => c.kind === 'session')).toHaveLength(7);
    expect(commands.filter((c) => c.kind === 'write')).toHaveLength(12);
    const { description: _, ...noDescription } = pppoe;
    expect(renderPreview(registerOnuPppoeMap(noDescription))).not.toContain('description');
    expect(renderPreview(registerOnuAndSave(pppoe))).toBe(`${renderPreview(registerOnuPppoeMap(pppoe))}\nwrite`);
  });

  it('accepts usernames with @ and up to 64 characters, passwords up to 32', () => {
    expect(renderPreview(registerOnu({ ...pppoe, pppoeUsername: 'aud.03_x@isp-1', pppoePassword: 'A'.repeat(32) }))).toContain(`username aud.03_x@isp-1 password ${'A'.repeat(32)} vlan-profile`);
    expect(() => registerOnu({ ...pppoe, pppoeUsername: 'u'.repeat(64) })).not.toThrow();
  });

  it.each([
    ['a username with a space', { pppoeUsername: 'AUD 03' }],
    ['a username of 65 characters', { pppoeUsername: 'u'.repeat(65) }],
    ['a password with ?', { pppoePassword: 'abc?' }],
    ['a password with a space', { pppoePassword: 'abc def' }],
    ['a password with a quote', { pppoePassword: 'abc"def' }],
    ['a password with #', { pppoePassword: 'abc#1' }],
    ['a password with CR/LF', { pppoePassword: 'abc\r\nreboot' }],
    ['a password of 33 characters', { pppoePassword: 'p'.repeat(33) }],
    ['an empty password', { pppoePassword: '' }],
    ['no password', { pppoePassword: undefined }],
    ['no username', { pppoeUsername: undefined }],
    ['LAN ports', { lanPorts: 4 }],
    ['a description with a space', { description: 'Blok A01' }],
  ])('rejects %s', (_label, change) => {
    expect(() => registerOnu({ ...pppoe, ...change } as never)).toThrow(ZodError);
  });

  it('random input is rejected or yields commands without control characters', () => {
    fc.assert(
      fc.property(fc.record({ name: fc.string(), description: fc.string(), pppoeUsername: fc.string(), pppoePassword: fc.string(), vlan: fc.integer() }), (r) => {
        try {
          for (const c of registerOnuPppoeMap({ ...pppoe, ...r })) expect(c.text).not.toMatch(CONTROL_CHARS);
        } catch (e) {
          expect(e).toBeInstanceOf(ZodError);
        }
      }),
      { numRuns: 2000 },
    );
  });
});

// The owner's Bridge Static configuration (2026-11-17), name and description without spaces.
const bridgeStatic = {
  mode: 'bridge_static' as const,
  slot: 1,
  port: 11,
  onuId: 14,
  sn: 'ZTEGC0000014',
  name: 'Jaya-Berhasil-Bersama',
  description: 'JBB-KIC',
  onuType: 'ZTE-F609',
  tcontProfile: '100M',
  vlan: 62,
  bridgeTcontProfile: '100M',
  bridgeVlan: 30,
  lanPorts: 4,
};

describe('registerOnuBridgeStatic (SPEC §8.5, mode bridge_static)', () => {
  it("renders the owner's configuration: the ONU interface, then pon-onu-mng", () => {
    expect(renderPreview(registerOnuBridgeStatic(bridgeStatic))).toBe(
      [
        'configure terminal',
        'interface gpon-olt_1/1/11',
        'onu 14 type ZTE-F609 sn ZTEGC0000014',
        'exit',
        'interface gpon-onu_1/1/11:14',
        'name Jaya-Berhasil-Bersama',
        'description JBB-KIC',
        'sn-bind enable sn',
        'tcont 1 profile 100M',
        'tcont 2 profile 100M',
        'gemport 1 name AUD tcont 1',
        'gemport 2 name bridging tcont 2',
        'service-port 1 vport 1 user-vlan 62 vlan 62',
        'service-port 2 vport 2 user-vlan 30 vlan 30',
        'port-identification sub-option remote-id enable vport 1',
        'port-identification sub-option remote-id enable vport 2',
        'exit',
        'pon-onu-mng gpon-onu_1/1/11:14',
        'service static gemport 1 vlan 62',
        'service bridging gemport 2 vlan 30',
        'switchport-bind switch_0/1 veip 1',
        'vlan port eth_0/1 mode tag vlan 30',
        'vlan port eth_0/2 mode tag vlan 30',
        'vlan port eth_0/3 mode tag vlan 30',
        'vlan port eth_0/4 mode tag vlan 30',
        'end',
      ].join('\n'),
    );
  });

  it('marks mode changes as session and every config line as write; `write` comes last', () => {
    const commands = registerOnuBridgeStatic(bridgeStatic);
    expect(commands.filter((c) => c.kind === 'session')).toHaveLength(7);
    expect(commands.filter((c) => c.kind === 'write')).toHaveLength(19);
    expect(renderPreview(registerOnuAndSave(bridgeStatic))).toBe(`${renderPreview(registerOnuBridgeStatic(bridgeStatic))}\nwrite`);
  });

  it('uses each T-CONT profile on its own T-CONT; no description line without one; only the chosen LAN ports', () => {
    const lines = renderPreview(registerOnuBridgeStatic({ ...bridgeStatic, tcontProfile: 'UP-20M', bridgeTcontProfile: 'UP-50M', lanPorts: 2 })).split('\n');
    expect(lines).toEqual(expect.arrayContaining(['tcont 1 profile UP-20M', 'tcont 2 profile UP-50M']));
    expect(lines.filter((l) => l.startsWith('vlan port'))).toEqual(['vlan port eth_0/1 mode tag vlan 30', 'vlan port eth_0/2 mode tag vlan 30']);
    const { description: _, ...noDescription } = bridgeStatic;
    expect(renderPreview(registerOnuBridgeStatic(noDescription))).not.toContain('description');
  });

  it.each([
    ['the same VLAN twice', { bridgeVlan: 62 }],
    ['no bridge VLAN', { bridgeVlan: undefined }],
    ['no bridge T-CONT profile', { bridgeTcontProfile: undefined }],
    ['no LAN port count', { lanPorts: undefined }],
    ['bridge VLAN 4095', { bridgeVlan: 4095 }],
    ['a bridge T-CONT profile with a space', { bridgeTcontProfile: '100 M' }],
    ['a bridge T-CONT profile with CR/LF', { bridgeTcontProfile: '100M\r\nreboot' }],
    ['a description with a space', { description: 'JBB KIC' }],
    ['a name with a space', { name: 'Jaya Berhasil Bersama' }],
    ['PPPoE fields', { pppoeUsername: 'AUD-1', pppoePassword: 'x' }],
  ])('rejects %s', (_label, change) => {
    expect(() => registerOnu({ ...bridgeStatic, ...change } as never)).toThrow(ZodError);
  });

  it('random input is rejected or yields commands without control characters', () => {
    fc.assert(
      fc.property(
        fc.record({ name: fc.string(), description: fc.string(), tcontProfile: fc.string(), bridgeTcontProfile: fc.string(), vlan: fc.integer(), bridgeVlan: fc.integer(), lanPorts: fc.integer() }),
        (r) => {
          try {
            for (const c of registerOnuBridgeStatic({ ...bridgeStatic, ...r })) expect(c.text).not.toMatch(CONTROL_CHARS);
          } catch (e) {
            expect(e).toBeInstanceOf(ZodError);
          }
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('expectedRegistrationLines: both service-ports, both services and the bridging VLAN on each LAN port', () => {
    expect(expectedRegistrationLines({ ...bridgeStatic, lanPorts: 2 })).toEqual({
      running: ['name Jaya-Berhasil-Bersama', 'user-vlan 62 vlan 62', 'description JBB-KIC', 'user-vlan 30 vlan 30'],
      mng: ['service static gemport 1 vlan 62', 'service bridging gemport 2 vlan 30', 'vlan port eth_0/1 mode tag vlan 30', 'vlan port eth_0/2 mode tag vlan 30'],
    });
  });

  it.each(Object.entries({ vlan: 63, bridgeVlan: 31, tcontProfile: '50M', bridgeTcontProfile: '50M', lanPorts: 3 }))('the preview hash changes when %s changes', (k, v) => {
    expect(previewSha256(renderPreview(registerOnuAndSave({ ...bridgeStatic, [k]: v })))).not.toBe(previewSha256(renderPreview(registerOnuAndSave(bridgeStatic))));
  });
});

describe('registration modes', () => {
  it('Bridge Static fields are refused in the other modes; each builder refuses the other modes', () => {
    const extra = { bridgeTcontProfile: '100M', bridgeVlan: 30 };
    expect(() => registerOnu({ ...manual, ...extra })).toThrow(ZodError);
    expect(() => registerOnu({ ...field, ...extra })).toThrow(ZodError);
    expect(() => registerOnu({ ...pppoe, ...extra })).toThrow(ZodError);
    expect(() => registerOnuBridgeStatic(field)).toThrow(CommandBuildError);
    expect(() => registerOnuBridge(bridgeStatic)).toThrow(CommandBuildError);
    expect(() => registerOnuInternet(bridgeStatic)).toThrow(CommandBuildError);
  });

  it('PPPoE fields are refused outside mode pppoe_map; each builder refuses the other modes', () => {
    expect(() => registerOnu({ ...manual, pppoeUsername: 'AUD-1', pppoePassword: 'x' })).toThrow(ZodError);
    expect(() => registerOnu({ ...field, pppoeUsername: 'AUD-1', pppoePassword: 'x' })).toThrow(ZodError);
    expect(() => registerOnuPppoeMap(field)).toThrow(CommandBuildError);
    expect(() => registerOnuBridge(pppoe)).toThrow(CommandBuildError);
    expect(() => registerOnuInternet(pppoe)).toThrow(CommandBuildError);
  });

  it('expectedRegistrationLines for pppoe_map: the AUD service and the WAN up to the username', () => {
    expect(expectedRegistrationLines(pppoe)).toEqual({
      running: ['name Pelanggan-PPPoE', 'user-vlan 600 vlan 600', 'description Blok-A01'],
      mng: ['service AUD gemport 1 vlan 600', 'wan-ip 1 mode pppoe username AUD-03-00001-001'],
    });
  });

  it('default (also without `mode`) is the unchanged internet template, then `write`', () => {
    const before = renderPreview([...registerOnuInternet(manual), writeConfig()]);
    expect(renderPreview(registerOnuAndSave(manual))).toBe(before);
    expect(renderPreview(registerOnuAndSave({ ...manual, mode: 'default' }))).toBe(before);
    expect(before.split('\n')).toHaveLength(15);
  });

  it('bridge: the bridge template, then `write`', () => {
    expect(renderPreview(registerOnuAndSave(field))).toBe(`${renderPreview(registerOnuBridge(field))}\nwrite`);
  });

  it('refuses bridge fields in default mode, and each builder refuses the other mode', () => {
    expect(() => registerOnu({ ...manual, lanPorts: 4 })).toThrow(ZodError);
    expect(() => registerOnu({ ...manual, description: 'Carku-2' })).toThrow(ZodError);
    expect(() => registerOnuInternet(field)).toThrow(CommandBuildError);
    expect(() => registerOnuBridge(manual)).toThrow(CommandBuildError);
  });

  it('expectedRegistrationLines: what the verification step requires per mode', () => {
    expect(expectedRegistrationLines(manual)).toEqual({ running: ['name Pelanggan-01', 'user-vlan 100 vlan 100'], mng: ['vlan 100'] });
    expect(expectedRegistrationLines({ ...field, lanPorts: 2 })).toEqual({
      running: ['name Carku-2-Maxindo', 'user-vlan 30 vlan 30', 'description Carku-2'],
      mng: ['service bridging gemport 1 vlan 30', 'vlan port eth_0/1 mode tag vlan 30', 'vlan port eth_0/2 mode tag vlan 30'],
    });
  });

  it.each(Object.entries({ mode: 'default', description: 'Carku-3', lanPorts: 3 }))('the bridge preview hash changes when %s changes', (k, v) => {
    const changed = k === 'mode' ? { ...manual, mode: 'default' as const } : { ...field, [k]: v };
    expect(previewSha256(renderPreview(registerOnuAndSave(changed)))).not.toBe(previewSha256(renderPreview(registerOnuAndSave(field))));
  });
});

describe('preview hash', () => {
  it('is a stable sha256 of the preview text', () => {
    const h = previewSha256(renderPreview(registerOnuInternet(manual)));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(previewSha256(renderPreview(registerOnuInternet(manual)))).toBe(h);
  });

  it.each(Object.entries({ slot: 2, port: 2, onuId: 2, sn: 'ZTEG00000003', name: 'Pelanggan-02', onuType: 'ZTEG-F660', tcontProfile: '20M', vlan: 101 }))('changes when %s changes', (k, v) => {
    const base = previewSha256(renderPreview(registerOnuInternet(manual)));
    expect(previewSha256(renderPreview(registerOnuInternet({ ...manual, [k]: v })))).not.toBe(base);
  });
});
