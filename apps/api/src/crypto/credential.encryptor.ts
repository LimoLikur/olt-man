import {
  type CliCredential,
  cliCredentialSchema,
  credentialAad,
  sealEnvelope,
  type SnmpCredential,
  snmpCredentialSchema,
} from '@olt/shared/crypto';
import { createPublicKey, type KeyObject } from 'node:crypto';

/**
 * Seals OLT credentials with the worker's public key. The api cannot decrypt what it
 * stores (SPEC §2.2 no. 1); plaintext only passes through here on the way in.
 */
export class CredentialEncryptor {
  private readonly key: KeyObject;

  constructor(publicKeyPem: string) {
    this.key = createPublicKey(publicKeyPem);
  }

  snmp(oltName: string, credential: SnmpCredential): Buffer {
    const value = snmpCredentialSchema.parse(credential);
    return sealEnvelope(this.key, Buffer.from(JSON.stringify(value)), credentialAad(oltName, 'snmp'));
  }

  cli(oltName: string, credential: CliCredential): Buffer {
    const value = cliCredentialSchema.parse(credential);
    return sealEnvelope(this.key, Buffer.from(JSON.stringify(value)), credentialAad(oltName, 'cli'));
  }
}
