import { Controller, Get, Inject } from '@nestjs/common';
import type { PrismaClient } from '@olt/db';
import { Roles } from '../auth/decorators.js';
import { PRISMA } from '../common/tokens.js';
import { iso } from '../common/validation.js';
import { OltSummaryService } from '../olts/olt-summary.service.js';

@Controller('dashboard')
export class DashboardController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly summaries: OltSummaryService,
  ) {}

  /** Per-OLT summary, totals and active top-level alarms (SPEC §6.5). */
  @Roles('admin', 'noc', 'teknisi')
  @Get()
  async get() {
    const olts = await this.summaries.list();
    const alarms = await this.prisma.alarm.findMany({
      where: { state: 'active', parentAlarmId: null },
      include: { olt: { select: { name: true } }, _count: { select: { children: true } } },
      orderBy: { firstAt: 'desc' },
      take: 50,
    });
    return {
      totals: olts.reduce((t, o) => ({ olts: t.olts + 1, onus: t.onus + o.onus.total, online: t.online + o.onus.online, offline: t.offline + o.onus.offline }), { olts: 0, onus: 0, online: 0, offline: 0 }),
      olts,
      alarms: alarms.map((a) => ({ id: a.id, oltId: a.oltId, oltName: a.olt.name, kind: a.kind, severity: a.severity, firstAt: iso(a.firstAt), children: a._count.children, acked: a.ackAt !== null })),
    };
  }
}
