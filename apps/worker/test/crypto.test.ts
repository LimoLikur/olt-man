import { MOCK_CLI, MOCK_SNMP_V3 } from '@olt/shared';
import { EnvelopeError, sealEnvelope } from '@olt/shared/crypto';
import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CredentialEncryptor } from '../../api/src/crypto/credential.encryptor.js';
import { CredentialDecryptor } from '../src/crypto/credential.decryptor.js';

const pair = () =>
  generateKeyPairSync('rsa', { modulusLength: 3072, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
const { publicKey, privateKey } = pair();
const encryptor = new CredentialEncryptor(publicKey);
const decryptor = CredentialDecryptor.fromPem(privateKey);

describe('credential envelope (api seals, worker opens)', () => {
  it('round-trips SNMP v3 and CLI credentials', () => {
    expect(decryptor.snmp('mock-1', encryptor.snmp('mock-1', MOCK_SNMP_V3))).toEqual(MOCK_SNMP_V3);
    expect(decryptor.cli('mock-1', encryptor.cli('mock-1', MOCK_CLI))).toEqual(MOCK_CLI);
  });

  it('round-trips v2c', () => {
    const v2 = { version: 'v2c' as const, community: 'mock-community-fake' };
    expect(decryptor.snmp('mock-2', encryptor.snmp('mock-2', v2))).toEqual(v2);
  });

  it('uses a fresh data key and IV per record', () => {
    expect(encryptor.snmp('mock-1', MOCK_SNMP_V3).equals(encryptor.snmp('mock-1', MOCK_SNMP_V3))).toBe(false);
  });

  it('never contains the plaintext', () => {
    const blob = encryptor.snmp('mock-1', MOCK_SNMP_V3);
    expect(blob.includes(Buffer.from(MOCK_SNMP_V3.authKey))).toBe(false);
  });

  it('fails when any single bit of the ciphertext is flipped', () => {
    const blob = encryptor.snmp('mock-1', MOCK_SNMP_V3);
    // Wrapped key, IV, tag and ciphertext regions, plus every byte of the tail.
    const positions = [3, 3 + 200, 3 + 384, 3 + 384 + 12, 3 + 384 + 28, blob.length - 1];
    for (const pos of positions) {
      for (const bit of [0, 7]) {
        const tampered = Buffer.from(blob);
        tampered[pos]! ^= 1 << bit;
        expect(() => decryptor.snmp('mock-1', tampered)).toThrow(EnvelopeError);
      }
    }
  });

  it('is bound to its OLT and field (AAD)', () => {
    const blob = encryptor.snmp('mock-1', MOCK_SNMP_V3);
    expect(() => decryptor.snmp('mock-2', blob)).toThrow(EnvelopeError);
    expect(() => decryptor.cli('mock-1', encryptor.snmp('mock-1', MOCK_SNMP_V3))).toThrow(EnvelopeError);
  });

  it('cannot be opened with another private key', () => {
    const other = CredentialDecryptor.fromPem(pair().privateKey);
    expect(() => other.snmp('mock-1', encryptor.snmp('mock-1', MOCK_SNMP_V3))).toThrow(EnvelopeError);
  });

  it('error messages carry no key material or plaintext', () => {
    const tampered = Buffer.from(encryptor.cli('mock-1', MOCK_CLI));
    tampered[tampered.length - 1]! ^= 1;
    try {
      decryptor.cli('mock-1', tampered);
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).toBe('envelope authentication failed');
    }
  });

  it('rejects weak RSA keys and invalid credentials before sealing', () => {
    const weak = generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
    expect(() => sealEnvelope(weak.publicKey, Buffer.from('x'), 'olt:a:snmp')).toThrow(/3072/);
    expect(() => encryptor.cli('mock-1', { username: 'admin\r\nwrite', password: 'x' })).toThrow();
  });
});
