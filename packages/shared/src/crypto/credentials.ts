import { z } from 'zod';

// Credential payloads stored (encrypted) in olt.snmp_cred_enc / olt.cli_cred_enc.

const secret = z.string().min(8).max(128).regex(/^[\x21-\x7e]+$/);

export const snmpCredentialSchema = z.discriminatedUnion('version', [
  z.strictObject({
    version: z.literal('v3'),
    user: z.string().regex(/^[A-Za-z0-9._-]{1,32}$/),
    authProtocol: z.enum(['sha', 'sha256', 'sha512']),
    authKey: secret,
    // des = DES-CBC ("des56" on ZTE): weak, only for firmware without AES.
    privProtocol: z.enum(['aes', 'aes256b', 'aes256r', 'des']),
    privKey: secret,
  }),
  z.strictObject({ version: z.literal('v2c'), community: z.string().min(1).max(64).regex(/^[\x21-\x7e]+$/) }),
]);

export const cliCredentialSchema = z.strictObject({
  username: z.string().regex(/^[A-Za-z0-9._-]{1,32}$/),
  password: z.string().min(1).max(128).regex(/^[\x20-\x7e]+$/),
});

export type SnmpCredential = z.infer<typeof snmpCredentialSchema>;
export type CliCredential = z.infer<typeof cliCredentialSchema>;

export type CredentialField = 'snmp' | 'cli';

/** AAD for a credential blob: ties it to one OLT and one field. */
export const credentialAad = (oltName: string, field: CredentialField) => `olt:${oltName}:${field}`;
