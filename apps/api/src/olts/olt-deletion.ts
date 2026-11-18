import type { Prisma } from '@olt/db';

/** An identity mismatch that no admin has accepted yet (CLAUDE.md rule 7). */
export const IDENTITY_ALARM = { kind: 'olt_identity_mismatch', state: 'active' } satisfies Prisma.AlarmWhereInput;

/**
 * Quarantined, or still carrying an unaccepted identity mismatch (e.g. disabled while
 * quarantined). Only an admin may delete such an OLT: deleting and re-registering it would
 * otherwise let a NOC user skip accept-change, which is the admin's decision (SPEC §8.4).
 */
export const hasIdentityProblem = (status: string, activeIdentityAlarms: number) => status === 'quarantined' || activeIdentityAlarms > 0;

/** The same rule as a delete filter, so a quarantine that lands meanwhile makes a NOC delete a no-op. */
export const withoutIdentityProblem = (id: number) =>
  ({ id, status: { not: 'quarantined' }, alarms: { none: IDENTITY_ALARM } }) satisfies Prisma.OltWhereInput;
