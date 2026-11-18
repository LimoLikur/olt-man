import {
  type CliCredential,
  cliCredentialSchema,
  credentialAad,
  openEnvelope,
  type SnmpCredential,
  snmpCredentialSchema,
} from '@olt/shared/crypto';
import { createPrivateKey, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * The only holder of the credential private key (SPEC §5, CLAUDE.md rule 5). Decrypted
 * credentials are validated, never logged, and should be dropped right after use.
 */
export class CredentialDecryptor {
  private constructor(private readonly key: KeyObject) {}

  /** Reads the PEM from a Docker secret file (OLT_CRED_PRIVATE_KEY_FILE). */
  static fromFile(path: string): CredentialDecryptor {
    return CredentialDecryptor.fromPem(readFileSync(path, 'utf8'));
  }

  static fromPem(pem: string): CredentialDecryptor {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== 'rsa') throw new Error('credential key must be RSA');
    return new CredentialDecryptor(key);
  }

  snmp(oltName: string, blob: Uint8Array): SnmpCredential {
    return snmpCredentialSchema.parse(JSON.parse(openEnvelope(this.key, Buffer.from(blob), credentialAad(oltName, 'snmp')).toString('utf8')));
  }

  cli(oltName: string, blob: Uint8Array): CliCredential {
    return cliCredentialSchema.parse(JSON.parse(openEnvelope(this.key, Buffer.from(blob), credentialAad(oltName, 'cli')).toString('utf8')));
  }
}
