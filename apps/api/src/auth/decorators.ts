import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Role } from '@olt/db';
import type { AppRequest, SessionUser } from '../common/request.js';

export const IS_PUBLIC = 'auth:public';
export const ROLES = 'auth:roles';

/** No session required (health, login). Every other route needs @Roles (F2, default-deny). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): SessionUser | undefined => ctx.switchToHttp().getRequest<AppRequest>().user);
