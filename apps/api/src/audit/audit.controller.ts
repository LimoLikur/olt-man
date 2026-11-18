import { Controller, Get, Inject } from '@nestjs/common';
import type { PrismaClient } from '@olt/db';
import { Roles } from '../auth/decorators.js';
import { PRISMA } from '../common/tokens.js';

/** Admin only; the UI page is deferred (SPEC §3), the demo reads this endpoint. */
@Controller('audit')
export class AuditController {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  @Roles('admin')
  @Get()
  async list() {
    const rows = await this.prisma.auditLog.findMany({ orderBy: { id: 'desc' }, take: 200 });
    return rows.map((r) => ({ id: Number(r.id), ts: r.ts.toISOString(), actor: r.actor, action: r.action, target: r.target, detail: r.detail, ip: r.ip }));
  }
}
