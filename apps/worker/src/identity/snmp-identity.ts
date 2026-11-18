import type { OltSnmpClient, SnmpIdentity } from '../snmp/olt-snmp.client.js';

/** Pinned SNMP identity of an OLT (olt_identity). */
export type SnmpPin = { kind: 'snmp_engine_id'; value: string } | { kind: 'snmp_sysinfo'; value: string };

export type IdentityStrength = 'strong' | 'weak';

export class IdentityMismatchError extends Error {
  constructor(
    readonly olt: string,
    readonly kind: SnmpPin['kind'] | 'ssh_hostkey' | 'missing_pin',
    readonly expected: string,
    readonly observed: string,
  ) {
    super(`identity mismatch on ${olt} (${kind})`);
    this.name = 'IdentityMismatchError';
  }
}

/** v2c identity value: "sysName|sysObjectID" (weak; consistency check only). */
export const sysInfoValue = (id: Pick<SnmpIdentity, 'sysName' | 'sysObjectId'>) => `${id.sysName}|${id.sysObjectId}`;

/**
 * Checks the OLT against its pin before anything else is read (SPEC §8.4 step 3, CLAUDE.md
 * rule 7). v3 compares the engine ID from an authenticated GET; v2c compares sysName and
 * sysObjectID and is only ever "weak". Timeouts and auth errors propagate unchanged.
 */
export async function verifySnmpIdentity(olt: string, client: OltSnmpClient, pin: SnmpPin | undefined): Promise<{ identity: SnmpIdentity; strength: IdentityStrength }> {
  if (!pin) throw new IdentityMismatchError(olt, 'missing_pin', '', '');
  const identity = await client.identity();
  if (client.version === 'v3') {
    if (pin.kind !== 'snmp_engine_id') throw new IdentityMismatchError(olt, 'missing_pin', pin.kind, 'v3');
    const observed = identity.engineId ?? '';
    if (observed !== pin.value.toLowerCase()) throw new IdentityMismatchError(olt, 'snmp_engine_id', pin.value.toLowerCase(), observed);
    return { identity, strength: 'strong' };
  }
  if (pin.kind !== 'snmp_sysinfo') throw new IdentityMismatchError(olt, 'missing_pin', pin.kind, 'v2c');
  const observed = sysInfoValue(identity);
  if (observed !== pin.value) throw new IdentityMismatchError(olt, 'snmp_sysinfo', pin.value, observed);
  return { identity, strength: 'weak' };
}

/** Runs `read` only after the identity check passed; a mismatch never reaches the tables. */
export async function withVerifiedIdentity<T>(olt: string, client: OltSnmpClient, pin: SnmpPin | undefined, read: () => Promise<T>): Promise<T> {
  await verifySnmpIdentity(olt, client, pin);
  return read();
}
