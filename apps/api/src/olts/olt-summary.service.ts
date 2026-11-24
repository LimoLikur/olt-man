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
    const lastOptical = await this.lastOpticalOk(ids);
    const now = this.clock.now().getTime();
    const ageS = (at: Date | null | undefined) => (at ? Math.max(0, Math.round((now - at.getTime()) / 1000)) : null);
    return olts.map((o) => {
      const onus = perOlt.filter((x) => x.oltId === o.id);
      const online = onus.filter((x) => x.state?.phaseState === 'working').length;
      const opticalAt = lastOptical.get(o.id);
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
        dataAgeS: ageS(o.lastPollOkAt),
        lastOpticalOkAt: iso(opticalAt),
        opticalAgeS: ageS(opticalAt),
        onus: { total: onus.length, online, offline: onus.length - online },
        activeAlarms: o._count.alarms,
        identityProblem: o.status === 'quarantined' || flagged.has(o.id),
      };
    });
  }

  /**
   * End of the last successful optical cycle per OLT (SPEC §8.1). One lookup per OLT on the
   * (olt_id, kind, started_at) index: it stops at the newest ok row instead of scanning 90 days.
   */
  private async lastOpticalOk(ids: number[]): Promise<Map<number, Date | null>> {
    const runs = await Promise.all(
      ids.map((oltId) => this.prisma.pollRun.findFirst({ where: { oltId, kind: 'optical', ok: true }, orderBy: { startedAt: 'desc' }, select: { oltId: true, finishedAt: true } })),
    );
    return new Map(runs.flatMap((r) => (r ? [[r.oltId, r.finishedAt] as const] : [])));
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
