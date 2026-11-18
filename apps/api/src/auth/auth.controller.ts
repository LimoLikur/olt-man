import { BadRequestException, Body, Controller, Get, HttpCode, HttpException, Inject, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { PrismaClient } from '@olt/db';
import type { Response } from 'express';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { type AppRequest, clientIp, type SessionUser } from '../common/request.js';
import { API_CONFIG, CLOCK, type Clock, PRISMA } from '../common/tokens.js';
import type { ApiEnv } from '@olt/shared';
import { clearSessionCookie, setSessionCookie } from './cookies.js';
import { CurrentUser, Public, Roles } from './decorators.js';
import { PasswordService } from './password.service.js';
import { LoginRateLimiter } from './rate-limit.service.js';
import { AdminLan } from './rbac.guards.js';
import { SessionService } from './session.service.js';

const loginSchema = z.strictObject({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) });
const passwordSchema = z.strictObject({ currentPassword: z.string().min(1).max(256), newPassword: z.string().min(12).max(256) });

const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const r = schema.safeParse(body);
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => i.path.join('.') || 'body'));
  return r.data;
};

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(API_CONFIG) private readonly config: ApiEnv,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordService,
    private readonly limiter: LoginRateLimiter,
    private readonly audit: AuditService,
    private readonly adminLan: AdminLan,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    const ip = clientIp(req);
    const { username, password } = parse(loginSchema, body);
    if (await this.limiter.blocked(ip, username)) {
      await this.audit.record({ actor: null, action: 'auth.login_rate_limited', target: username.slice(0, 64), ip });
      throw new HttpException('Terlalu banyak percobaan login. Coba lagi nanti.', 429);
    }
    const user = await this.prisma.user.findUnique({ where: { username } });
    const ok = (await this.passwords.verify(user?.passwordHash, password)) && user?.active === true;
    if (!ok || !user) {
      await this.limiter.fail(ip, username);
      await this.audit.record({ actor: user?.id ?? null, action: 'auth.login_failed', target: username.slice(0, 64), ip });
      throw new UnauthorizedException('Username atau password salah.');
    }
    await this.limiter.reset(ip);
    if (user.role === 'admin' && !this.adminLan.allows(ip)) await this.adminLan.deny(user.id, ip, 'login');
    const session = await this.sessions.create(user.id, ip, req.headers['user-agent']);
    setSessionCookie(res, session.id, this.sessions.cookieMaxAgeMs());
    await this.audit.record({ actor: user.id, action: 'auth.login', ip });
    return { username: user.username, role: user.role };
  }

  @Roles('admin', 'noc', 'teknisi')
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: SessionUser, @Req() req: AppRequest, @Res({ passthrough: true }) res: Response) {
    await this.sessions.revoke(user.sessionHash);
    clearSessionCookie(res);
    await this.audit.record({ actor: user.id, action: 'auth.logout', ip: clientIp(req) });
  }

  @Roles('admin', 'noc', 'teknisi')
  @Get('me')
  me(@CurrentUser() user: SessionUser) {
    // The UI shows every time in the office time zone, not the browser's.
    return { username: user.username, role: user.role, timeZone: this.config.APP_TIMEZONE };
  }

  @Roles('admin', 'noc', 'teknisi')
  @Post('password')
  @HttpCode(204)
  async changePassword(@CurrentUser() user: SessionUser, @Body() body: unknown, @Req() req: AppRequest) {
    const { currentPassword, newPassword } = parse(passwordSchema, body);
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!(await this.passwords.verify(row.passwordHash, currentPassword))) throw new UnauthorizedException('Password lama salah.');
    // passwordChangedAt invalidates sessions created earlier; this one is kept by moving its
    // creation time forward with the change.
    const now = this.clock.now();
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await this.passwords.hash(newPassword), passwordChangedAt: now } }),
      this.prisma.session.update({ where: { idHash: user.sessionHash }, data: { createdAt: now } }),
    ]);
    const revoked = await this.sessions.revokeOthers(user.id, user.sessionHash);
    await this.audit.record({ actor: user.id, action: 'auth.password_changed', detail: { revokedSessions: revoked }, ip: clientIp(req) });
  }
}
