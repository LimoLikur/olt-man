// No zod here: the UI imports this module for the algorithm checkboxes.

/**
 * Legacy SSH algorithms an OLT may need on top of ssh2's defaults (SPEC §8.3): older C320
 * firmware offers e.g. only aes128-cbc. The allowlist is exactly what ssh2 supports but does
 * not enable by default; the worker appends the chosen ones, so modern algorithms still win
 * when the OLT offers them. `ssh-rsa` host keys need no entry (ssh2 accepts them by default).
 */
export const SSH_LEGACY_ALGORITHMS = {
  kex: ['diffie-hellman-group14-sha1', 'diffie-hellman-group-exchange-sha1', 'diffie-hellman-group1-sha1'],
  serverHostKey: ['ssh-dss'],
  cipher: ['aes128-cbc', 'aes192-cbc', 'aes256-cbc', '3des-cbc'],
  hmac: ['hmac-sha1-96', 'hmac-md5', 'hmac-md5-96'],
} as const;

export type SshAlgorithmKind = keyof typeof SSH_LEGACY_ALGORITHMS;

/** olt.ssh_algorithms: per kind, the legacy algorithms appended for that OLT. */
export type SshAlgorithms = { [K in SshAlgorithmKind]?: (typeof SSH_LEGACY_ALGORITHMS)[K][number][] | undefined };
