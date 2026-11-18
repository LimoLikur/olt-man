import { sshAlgorithmsSchema } from '@olt/shared/dto';
import { SSH_LEGACY_ALGORITHMS } from '@olt/shared/ssh-algorithms';
import type { Algorithms } from 'ssh2';
import type { OltCliSessionOptions } from './olt-cli.session.js';

const KINDS = ['kex', 'serverHostKey', 'cipher', 'hmac'] as const;

/**
 * Default kex entries moved behind the SHA-512 groups, which is OpenSSH's order: a C320
 * (ZTE_SSH.1.0) then negotiates group16-sha512, as with OpenSSH. The C320's login resets of
 * Nov 2026 were caused by split packets (coalescing-socket.ts), not by group14-sha256; the
 * 4096-bit group16 exchange costs the C320 about 16 s per connection.
 */
const DEMOTED_KEX = ['diffie-hellman-group14-sha256'];

/**
 * olt.ssh_algorithms -> ssh2 `algorithms`. The value comes from the database, so it is
 * re-validated against the allowlist (CLAUDE.md rule 6); anything else throws. The legacy
 * entries are appended to ssh2's defaults, which keep their preference order, and among
 * themselves follow the allowlist order (strongest first, e.g. aes128-cbc before 3des-cbc),
 * not the stored order (OpenSSH also picks aes128-cbc on a C320 offering aes128-cbc and 3des-cbc).
 */
export function sshAlgorithms(raw: unknown): Algorithms {
  const parsed = sshAlgorithmsSchema.parse(raw ?? {});
  const legacy = (kind: (typeof KINDS)[number]) => {
    const rank = (a: string) => (SSH_LEGACY_ALGORITHMS[kind] as readonly string[]).indexOf(a);
    return [...(parsed[kind] ?? [])].sort((a, b) => rank(a) - rank(b));
  };
  // ssh2 applies the operations in key order, so `remove` then `append` moves an entry to the
  // end. @types/ssh2 wants all three operations; empty lists are no-ops at runtime.
  const out: Record<string, unknown> = { kex: { remove: DEMOTED_KEX, append: [...DEMOTED_KEX, ...legacy('kex')], prepend: [] } };
  for (const kind of KINDS) {
    const list = legacy(kind);
    if (kind !== 'kex' && list.length) out[kind] = { append: list, prepend: [], remove: [] };
  }
  return out as Algorithms;
}

/** Session options for one OLT: the worker-wide options plus that OLT's SSH algorithms. */
export function cliSessionOptions(base: OltCliSessionOptions | undefined, raw: unknown): OltCliSessionOptions {
  return { ...base, algorithms: sshAlgorithms(raw) };
}
