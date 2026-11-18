import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PrismaClient, Role } from '@olt/db';
import type { ApiEnv } from '@olt/shared';
import { AuditService } from '../audit/audit.service.js';
import { CidrMatcher } from '../common/cidr.js';
import { type AppRequest, clientIp } from '../common/request.js';
import { API_CONFIG, PRISMA } from '../common/tokens.js';
import { IS_PUBLIC, ROLES } from './decorators.js';
import { SessionService } from './session.service.js';

/**
 * Default-deny RBAC (SPEC §8.6): a route without @Public() or @Roles(...) is refused for
 * everyone, so a forgotten decorator can never open an endpoint.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    const user = ctx.switchToHttp().getRequest<AppRequest>().user;
    if (!roles?.length || !user || !roles.includes(user.role)) throw new ForbiddenException();
    return true;
  }
}

/** Office LAN check for the admin role (CLAUDE.md rule 8), shared by the guard and login. */
@Injectable()
export class AdminLan {
  private readonly lan: CidrMatcher;

  constructor(
    @Inject(API_CONFIG) config: ApiEnv,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly audit: AuditService,
  ) {
    this.lan = new CidrMatcher(config.ADMIN_ALLOWED_CIDRS);
  }

  allows(ip: string): boolean {
    return this.lan.contains(ip);
  }

  async deny(userId: number, ip: string, where: string): Promise<never> {
    await this.prisma.securityEvent.create({ data: { kind: 'admin_offlan_denied', severity: 'warning', detail: { userId, ip, where } } });
    await this.audit.record({ actor: userId, action: 'auth.admin_offlan_denied', target: where.slice(0, 128), ip });
    throw new ForbiddenException('Peran admin hanya bisa dipakai dari jaringan kantor.');
  }
}

/**
 * Enforced in the api on every request, not in the UI or proxy: an admin session used from
 * outside ADMIN_ALLOWED_CIDRS is refused and revoked.
 */
@Injectable()
export class AdminLanGuard implements CanActivate {
  constructor(
    private readonly adminLan: AdminLan,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const user = req.user;
    if (!user || user.role !== 'admin') return true;
    const ip = clientIp(req);
    if (this.adminLan.allows(ip)) return true;
    await this.sessions.revoke(user.sessionHash);
    return this.adminLan.deny(user.id, ip, `${req.method} ${req.path}`);
  }
}
