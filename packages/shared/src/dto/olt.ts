import { z } from 'zod';
import { cliCredentialSchema, snmpCredentialSchema } from '../crypto/credentials.js';
import { SSH_LEGACY_ALGORITHMS, type SshAlgorithms } from '../ssh-algorithms.js';

export { SSH_LEGACY_ALGORITHMS, type SshAlgorithms } from '../ssh-algorithms.js';

// Request DTOs (validated in the api). Responses never contain credential fields.

const oltName = z.string().regex(/^[a-z0-9][a-z0-9-]{1,31}$/, 'huruf kecil, angka, dan tanda minus');

const legacyList = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .array(z.enum(values))
    .max(values.length)
    .refine((a) => new Set(a).size === a.length, 'duplikat');

/** Stored in olt.ssh_algorithms; also re-validated by the worker before it reaches ssh2. */
export const sshAlgorithmsSchema: z.ZodType<SshAlgorithms> = z
  .strictObject({
    kex: legacyList(SSH_LEGACY_ALGORITHMS.kex),
    serverHostKey: legacyList(SSH_LEGACY_ALGORITHMS.serverHostKey),
    cipher: legacyList(SSH_LEGACY_ALGORITHMS.cipher),
    hmac: legacyList(SSH_LEGACY_ALGORITHMS.hmac),
  })
  .partial();

export const createOltSchema = z.strictObject({
  name: oltName,
  mgmtIp: z.union([z.ipv4(), z.ipv6()]),
  isMock: z.boolean(),
  oidProfile: z.enum(['zte-c320-v2.1', 'zte-c320-v2.2']),
  mgmtPath: z.enum(['inband', 'outband', 'unknown']).default('unknown'),
  snmp: snmpCredentialSchema,
  cli: cliCredentialSchema.optional(),
  sshAlgorithms: sshAlgorithmsSchema.default({}),
  statusIntervalS: z.number().int().min(30).max(3600).default(60),
});
export type CreateOltInput = z.input<typeof createOltSchema>;

/** is_mock, name and the management IP cannot be changed (re-register instead). */
export const patchOltSchema = z
  .strictObject({
    mgmtPath: z.enum(['inband', 'outband', 'unknown']),
    snmp: snmpCredentialSchema,
    cli: cliCredentialSchema,
    cliEnabled: z.boolean(),
    sshAlgorithms: sshAlgorithmsSchema,
    statusIntervalS: z.number().int().min(30).max(3600),
    disabled: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'kosong');
export type PatchOltInput = z.input<typeof patchOltSchema>;

export type IdentityLevel = 'strong' | 'weak' | 'unpinned';

export interface OltSummary {
  id: number;
  name: string;
  mgmtIp: string;
  isMock: boolean;
  status: string;
  oidProfile: string;
  firmware: string | null;
  snmpVersion: 'v3' | 'v2c';
  cliEnabled: boolean;
  /** Not a secret: which legacy algorithms are appended for this OLT's SSH sessions. */
  sshAlgorithms: SshAlgorithms;
  identityLevel: IdentityLevel;
  lastPollOkAt: string | null;
  /** Seconds since the last successful status poll; null = never. */
  dataAgeS: number | null;
  onus: { total: number; online: number; offline: number };
  activeAlarms: number;
  /**
   * Quarantined, or an identity mismatch not accepted yet (also after disabling): only an
   * admin may delete the OLT then (SPEC §8.4). Any other OLT can be deleted by admin or NOC.
   */
  identityProblem: boolean;
}
