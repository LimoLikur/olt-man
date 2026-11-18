import { ConflictException, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Query, Req } from '@nestjs/common';
import type { PrismaClient } from '@olt/db';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import { type AppRequest, clientIp, type SessionUser } from '../common/request.js';
import { CLOCK, type Clock, PRISMA } from '../common/tokens.js';
import { IdParam, iso, parse } from '../common/validation.js';

const listSchema = z.strictObject({ state: z.enum(['active', 'cleared', 'all']).default('active'), oltId: z.coerce.number().int().positive().optional() });

@Controller('alarms')
export class AlarmsController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /** Top-level alarms with their held children (SPEC §8.2 suppression). */
  @Roles('admin', 'noc', 'teknisi')
  @Get()
  async list(@Query() query: unknown) {
    const q = parse(listSchema, query);
    const rows = await this.prisma.alarm.findMany({
      where: { ...(q.state === 'all' ? {} : { state: q.state }), ...(q.oltId ? { oltId: q.oltId } : {}) },
      include: { olt: { select: { name: true } }, ponPort: true, onu: { select: { name: true, onuIndex: true } } },
      orderBy: { firstAt: 'desc' },
      take: 500,
    });
    const item = (a: (typeof rows)[number]) => ({
      id: a.id,
      oltId: a.oltId,
      oltName: a.olt.name,
      kind: a.kind,
      severity: a.severity,
      state: a.state,
      port: a.ponPort ? `${a.ponPort.slot}/${a.ponPort.port}` : null,
      onuId: a.onuId,
      onuName: a.onu?.name ?? null,
      firstAt: iso(a.firstAt),
      lastAt: iso(a.lastAt),
      clearedAt: iso(a.clearedAt),
      ackBy: a.ackBy,
      ackAt: iso(a.ackAt),
    });
    const children = new Map<number, ReturnType<typeof item>[]>();
    for (const a of rows) if (a.parentAlarmId) children.set(a.parentAlarmId, [...(children.get(a.parentAlarmId) ?? []), item(a)]);
    return rows.filter((a) => !a.parentAlarmId || !rows.some((p) => p.id === a.parentAlarmId)).map((a) => ({ ...item(a), children: children.get(a.id) ?? [] }));
  }

  /** Ack records who looked at it; it never clears the alarm (SPEC §8.2). */
  @Roles('admin', 'noc')
  @Post(':id/ack')
  @HttpCode(200)
  async ack(@Param('id', IdParam) id: number, @CurrentUser() user: SessionUser, @Req() req: AppRequest) {
    const alarm = await this.prisma.alarm.findUnique({ where: { id } });
    if (!alarm) throw new NotFoundException();
    if (alarm.ackAt) throw new ConflictException('Alarm sudah di-ack.');
    const ackAt = this.clock.now();
    await this.prisma.alarm.update({ where: { id }, data: { ackBy: user.id, ackAt } });
    await this.audit.record({ actor: user.id, action: 'alarm.ack', target: `alarm:${id}`, ip: clientIp(req) });
    return { id, ackBy: user.id, ackAt: ackAt.toISOString() };
  }
}
