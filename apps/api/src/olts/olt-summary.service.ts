import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@olt/db';
import { type IdentityLevel, type OltSummary, sshAlgorithmsSchema } from '@olt/shared/dto';
import { CLOCK, type Clock, PRISMA } from '../common/tokens.js';
import { iso } from '../common/validation.js';
import { IDENTITY_ALARM } from './olt-deletion.js';

/** Builds OLT summaries with an explicit field list: credential columns are never selected. */
@Injectable()
export class OltSummaryService {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(where: { id?: number } = {}): Promise<OltSummary[]> {
    const olts = await this.prisma.olt.findMany({
      where,
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        mgmtIp: true,
        isMock: true,
        status: true,
        oidProfile: true,
        firmware: true,
        snmpVersion: true,
        cliEnabled: true,
        sshAlgorithms: true,
        lastPollOkAt: true,
        identities: { where: { status: 'pinned' }, select: { kind: true } },
        _count: { select: { alarms: { where: { state: 'active', parentAlarmId: null } } } },
      },
    });
    const ids = olts.map((o) => o.id);
    const perOlt = await this.prisma.onu.findMany({
      where: { oltId: { in: ids }, archivedAt: null, removedAt: null },
      select: { oltId: true, state: { select: { phaseState: true } } },
    });
    const flagged = new Set((await this.prisma.alarm.findMany({ where: { oltId: { in: ids }, ...IDENTITY_ALARM }, select: { oltId: true }, distinct: ['oltId'] })).map((a) => a.oltId));
    const now = this.clock.now().getTime();
    return olts.map((o) => {
      const onus = perOlt.filter((x) => x.oltId === o.id);
      const online = onus.filter((x) => x.state?.phaseState === 'working').length;
      return {
        id: o.id,
        name: o.name,
        mgmtIp: o.mgmtIp,
        isMock: o.isMock,
        status: o.status,
        oidProfile: o.oidProfile,
        firmware: o.firmware,
        snmpVersion: o.snmpVersion,
        cliEnabled: o.cliEnabled,
        sshAlgorithms: sshAlgorithmsSchema.catch({}).parse(o.sshAlgorithms),
        identityLevel: identityLevel(o.snmpVersion, o.cliEnabled, o.identities.map((i) => i.kind)),
        lastPollOkAt: iso(o.lastPollOkAt),
        dataAgeS: o.lastPollOkAt ? Math.max(0, Math.round((now - o.lastPollOkAt.getTime()) / 1000)) : null,
        onus: { total: onus.length, online, offline: onus.length - online },
        activeAlarms: o._count.alarms,
        identityProblem: o.status === 'quarantined' || flagged.has(o.id),
      };
    });
  }
}

/** SPEC §8.4: strong = SNMPv3 pinned (and host key pinned when CLI is on); weak = v2c. */
export function identityLevel(version: 'v3' | 'v2c', cliEnabled: boolean, pinned: string[]): IdentityLevel {
  if (version === 'v3') {
    if (!pinned.includes('snmp_engine_id')) return 'unpinned';
    return !cliEnabled || pinned.includes('ssh_hostkey') ? 'strong' : 'unpinned';
  }
  return pinned.includes('snmp_sysinfo') ? 'weak' : 'unpinned';
}
