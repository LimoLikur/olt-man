import { Body, Controller, ForbiddenException, Get, HttpCode, Inject, NotFoundException, Param, Post, Req } from '@nestjs/common';
import type { PrismaClient } from '@olt/db';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser, Roles } from '../auth/decorators.js';
import { PasswordService } from '../auth/password.service.js';
import { type AppRequest, clientIp, type SessionUser } from '../common/request.js';
import { CLOCK, type Clock, PRISMA } from '../common/tokens.js';
import { IdParam, iso, parse } from '../common/validation.js';

/** Same length rule as a user changing their own password (auth.controller). */
const resetSchema = z.strictObject({ newPassword: z.string().min(12).max(256) });

/** Roles whose password an admin may reset. Admin passwords are only changed by their owner. */
const RESETTABLE = new Set(['noc', 'teknisi']);

/** User management for admins (LAN only, enforced by AdminLanGuard). */
@Controller('users')
export class UsersController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  @Roles('admin')
  @Get()
  async list() {
    const users = await this.prisma.user.findMany({ orderBy: [{ role: 'asc' }, { username: 'asc' }], select: { id: true, username: true, role: true, active: true, passwordChangedAt: true } });
    return users.map((u) => ({ ...u, passwordChangedAt: iso(u.passwordChangedAt), passwordResettable: RESETTABLE.has(u.role) }));
  }

  /**
   * Sets a new password for a NOC or teknisi user. passwordChangedAt moves forward, so every
   * session of that user stops resolving; they are also revoked explicitly.
   */
  @Roles('admin')
  @Post(':id/password')
  @HttpCode(204)
  async resetPassword(@Param('id', IdParam) id: number, @Body() body: unknown, @CurrentUser() admin: SessionUser, @Req() req: AppRequest) {
    const { newPassword } = parse(resetSchema, body);
    const target = await this.prisma.user.findUnique({ where: { id }, select: { id: true, username: true, role: true } });
    if (!target) throw new NotFoundException();
    if (!RESETTABLE.has(target.role)) throw new ForbiddenException('Password admin hanya bisa diganti oleh pemiliknya.');
    const now = this.clock.now();
    const hash = await this.passwords.hash(newPassword);
    const [, revoked] = await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { passwordHash: hash, passwordChangedAt: now } }),
      this.prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } }),
    ]);
    await this.audit.record({
      actor: admin.id,
      action: 'user.password_reset',
      target: `user:${id}`,
      detail: { username: target.username, role: target.role, revokedSessions: revoked.count },
      ip: clientIp(req),
    });
  }
}
