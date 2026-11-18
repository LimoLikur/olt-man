import { type CanActivate, type ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ApiEnv } from '@olt/shared';
import type { AppRequest } from '../common/request.js';
import { API_CONFIG } from '../common/tokens.js';
import { readSessionCookie } from './cookies.js';
import { IS_PUBLIC } from './decorators.js';
import { SessionService } from './session.service.js';

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** CSRF defence on top of SameSite=Strict: state-changing requests must carry an allowed Origin. */
@Injectable()
export class OriginGuard implements CanActivate {
  constructor(@Inject(API_CONFIG) private readonly config: ApiEnv) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (!UNSAFE.has(req.method)) return true;
    const origin = req.headers.origin;
    if (!origin || !this.config.APP_ORIGINS.includes(origin)) throw new ForbiddenException('origin not allowed');
    return true;
  }
}

/** Attaches the session user; 401 without a valid session unless the route is @Public(). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const user = await this.sessions.resolve(readSessionCookie(req));
    if (user) req.user = user;
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    if (!user) throw new UnauthorizedException();
    return true;
  }
}
