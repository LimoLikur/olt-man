export class SnmpTimeoutError extends Error {
  constructor(readonly olt: string) {
    super(`SNMP timeout (${olt})`);
    this.name = 'SnmpTimeoutError';
  }
}

/** Wrong user/keys/community, or an impostor without them. Counts towards quarantine (SPEC §2.2 no. 11). */
export class SnmpAuthError extends Error {
  constructor(readonly olt: string) {
    super(`SNMP authentication failed (${olt})`);
    this.name = 'SnmpAuthError';
  }
}

/** A table walk ended short or columns disagree on their rows; the whole cycle is discarded. */
export class SnmpIncompleteError extends Error {
  constructor(
    readonly olt: string,
    detail: string,
  ) {
    super(`incomplete SNMP table (${olt}): ${detail}`);
    this.name = 'SnmpIncompleteError';
  }
}

export class SnmpError extends Error {
  constructor(
    readonly olt: string,
    detail: string,
  ) {
    super(`SNMP error (${olt}): ${detail}`);
    this.name = 'SnmpError';
  }
}
