/** Host key not among the pins: the connection was dropped before authentication. */
export class HostKeyMismatchError extends Error {
  constructor(
    readonly olt: string,
    readonly observed: string,
  ) {
    super(`SSH host key mismatch (${olt})`);
    this.name = 'HostKeyMismatchError';
  }
}

/** Wrong username/password: never retried (SPEC §8.3). */
export class CliAuthError extends Error {
  constructor(readonly olt: string) {
    super(`CLI authentication failed (${olt})`);
    this.name = 'CliAuthError';
  }
}

/** No session: refused, timed out, or closed before the prompt (e.g. VTY full). Retried. */
export class CliUnavailableError extends Error {
  constructor(
    readonly olt: string,
    readonly reason: string,
    /** Last screen text before giving up (control characters stripped); stored in the job, never logged. */
    readonly screen?: string,
    /** SSH protocol trace without credentials (OltCliSession.trace); stored in the job, never logged. */
    readonly trace?: readonly string[],
  ) {
    super(`CLI unavailable (${olt}): ${reason}`);
    this.name = 'CliUnavailableError';
  }
}

/**
 * No common SSH algorithm (kex, host key, cipher or MAC) with the OLT: a configuration
 * problem (olt.ssh_algorithms), so never retried. `detail` is ssh2's fixed text, e.g.
 * "no matching C->S cipher".
 */
export class CliNegotiationError extends Error {
  constructor(
    readonly olt: string,
    readonly detail: string,
  ) {
    super(`SSH negotiation failed (${olt}): ${detail}`);
    this.name = 'CliNegotiationError';
  }
}

/** The OLT answered with a `%` line. */
export class CliError extends Error {
  constructor(
    readonly olt: string,
    readonly line: string,
  ) {
    super(`CLI error (${olt}): ${line}`);
    this.name = 'CliError';
  }
}

export class CliTimeoutError extends Error {
  constructor(
    readonly olt: string,
    readonly what: string,
  ) {
    super(`CLI timeout (${olt}): ${what}`);
    this.name = 'CliTimeoutError';
  }
}

/** A write command in a read session, refused before anything is sent (guard 3, SPEC §8.5). */
export class WriteInReadSessionError extends Error {
  constructor() {
    super('write command refused: session opened in read mode');
    this.name = 'WriteInReadSessionError';
  }
}
