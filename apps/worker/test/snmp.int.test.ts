import { OID_PROFILES } from '@olt/olt-spec';
import { MOCK_SNMP_COMMUNITY, MOCK_SNMP_V3, MOCK_SNMP_V3_DES } from '@olt/shared';
import type { SnmpCredential } from '@olt/shared/crypto';
import { type RunningMock, startTestMock } from 'mock-olt/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TargetGuard, TargetNotAllowedError } from '../src/guards/target.guard.js';
import { IdentityMismatchError, sysInfoValue, verifySnmpIdentity, withVerifiedIdentity } from '../src/identity/snmp-identity.js';
import { SnmpAuthError, SnmpTimeoutError } from '../src/snmp/errors.js';
import { OltSnmpClient, type OltSnmpTarget } from '../src/snmp/olt-snmp.client.js';

let mock: RunningMock;
let port: number;
// The in-process mock listens on loopback; the guard allows exactly that address.
const guard = new TargetGuard(['127.0.0.1/32'], ['127.0.0.1/32']);
const clients: OltSnmpClient[] = [];

beforeAll(async () => {
  const t = await startTestMock();
  mock = t.mock;
  port = t.config.MOCK_SNMP_PORT;
});
afterAll(() => mock.stop());
beforeEach(() => mock.runner.run('reset'));

const v2: SnmpCredential = { version: 'v2c', community: MOCK_SNMP_COMMUNITY };
const target = (credential: SnmpCredential = MOCK_SNMP_V3): OltSnmpTarget => ({ name: 'mock-1', ip: '127.0.0.1', port, profile: OID_PROFILES['zte-c320-v2.1'], credential });
const client = (credential?: SnmpCredential, g = guard) => {
  const c = new OltSnmpClient(target(credential), g);
  clients.push(c);
  return c;
};
afterAll(() => clients.forEach((c) => c.close()));

const key = (r: { slot: number; port: number; onuId: number }) => `${r.slot}/${r.port}:${r.onuId}`;
const columnOids = () => Object.values(OID_PROFILES['zte-c320-v2.1'].columns);
const walkRequests = (since: number) => mock.log.entries('snmp-request', since).filter((e) => e.oids.some((oid) => columnOids().some((c) => oid.startsWith(c))));

describe('OltSnmpClient against the mock', () => {
  it('v3 (AES and DES) and v2c status rows equal the mock state', async () => {
    const expected = new Map(mock.olt.onus.map((o) => [key(o), { phase: o.phase, adminEnabled: o.adminEnabled, omccEnabled: o.phase === 'working' }]));
    for (const c of [client(), client(MOCK_SNMP_V3_DES), client(v2)]) {
      const rows = await c.onuStatus();
      expect(rows).toHaveLength(mock.olt.onus.length);
      expect(new Map(rows.map(({ slot, port: p, onuId, ...rest }) => [key({ slot, port: p, onuId }), rest]))).toEqual(expected);
    }
  });

  it('optical rows: Rx within 0.01 dB of the mock, inventory decoded, no-signal as null', async () => {
    mock.runner.run('onu-los');
    const rows = new Map((await client().onuOptical()).map((r) => [key(r), r]));
    for (const o of mock.olt.onus) {
      const r = rows.get(key(o))!;
      expect(r).toMatchObject({ name: o.name, description: o.description, sn: o.sn, type: o.type });
      if (o.phase === 'working') {
        expect(Math.abs(r.rxOnuDbm! - o.rxOnuDbm)).toBeLessThanOrEqual(0.01);
        expect(Math.abs(r.rxOltDbm! - o.rxOltDbm)).toBeLessThanOrEqual(0.01);
      } else {
        expect([r.rxOnuDbm, r.rxOltDbm]).toEqual([null, null]);
      }
    }
  });

  it('reads identity: engine ID (v3), sysName and sysObjectID', async () => {
    expect(await client().identity()).toMatchObject({ sysName: 'mock-1', engineId: mock.identity.engineId });
    const id2 = await client(v2).identity();
    expect(id2.engineId).toBeUndefined();
    expect(id2.sysObjectId).toBe(mock.olt.seed.sysObjectId);
  });

  it('wrong v3 key -> SnmpAuthError', async () => {
    await expect(client({ ...MOCK_SNMP_V3, authKey: 'wrong-auth-key-000' }).onuStatus()).rejects.toBeInstanceOf(SnmpAuthError);
  });

  it('olt-down -> SnmpTimeoutError within 7 s', async () => {
    mock.runner.run('olt-down');
    const start = Date.now();
    await expect(client().onuStatus()).rejects.toBeInstanceOf(SnmpTimeoutError);
    expect(Date.now() - start).toBeLessThanOrEqual(7000);
  }, 10_000);
});

describe('SNMP identity check (rule 7)', () => {
  it('v3 matching engine ID -> strong; v2c sysinfo -> weak', async () => {
    expect((await verifySnmpIdentity('mock-1', client(), { kind: 'snmp_engine_id', value: mock.identity.engineId.toUpperCase() })).strength).toBe('strong');
    const id = await client(v2).identity();
    expect((await verifySnmpIdentity('mock-1', client(v2), { kind: 'snmp_sysinfo', value: sysInfoValue(id) })).strength).toBe('weak');
  });

  it('engine ID different from the pin -> IdentityMismatch, and no table walk reaches the mock', async () => {
    const pin = { kind: 'snmp_engine_id' as const, value: mock.identity.engineId };
    mock.runner.run('engineid-change');
    await new Promise((r) => setTimeout(r, 100));
    const since = mock.log.lastSeq;
    const c = client();
    await expect(withVerifiedIdentity('mock-1', c, pin, () => c.onuStatus())).rejects.toBeInstanceOf(IdentityMismatchError);
    expect(mock.log.entries('snmp-request', since).length).toBeGreaterThan(0); // the identity GET
    expect(walkRequests(since)).toHaveLength(0);
  });

  it('no pin -> refuses before reading tables', async () => {
    const since = mock.log.lastSeq;
    const c = client();
    await expect(withVerifiedIdentity('mock-1', c, undefined, () => c.onuStatus())).rejects.toBeInstanceOf(IdentityMismatchError);
    expect(walkRequests(since)).toHaveLength(0);
  });
});

describe('target guard', () => {
  it('a target outside OLT_TARGET_CIDRS sends 0 requests to the mock', async () => {
    const since = mock.log.lastSeq;
    expect(() => client(MOCK_SNMP_V3, new TargetGuard(['172.30.0.0/24'], ['172.30.0.0/24']))).toThrow(TargetNotAllowedError);
    await new Promise((r) => setTimeout(r, 200));
    expect(mock.log.entries(undefined, since).filter((e) => e.kind.startsWith('snmp'))).toHaveLength(0);
  });
});
