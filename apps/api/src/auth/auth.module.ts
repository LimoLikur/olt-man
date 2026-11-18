import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { OriginGuard, SessionGuard } from './guards.js';
import { PasswordService } from './password.service.js';
import { LoginRateLimiter } from './rate-limit.service.js';
import { AdminLan, AdminLanGuard, RolesGuard } from './rbac.guards.js';
import { SessionService } from './session.service.js';
import { UsersController } from '../users/users.controller.js';

@Module({
  controllers: [AuthController, UsersController],
  providers: [
    SessionService,
    PasswordService,
    LoginRateLimiter,
    AdminLan,
    // Order matters: Origin (cheap) -> session -> role -> admin only from the LAN.
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: AdminLanGuard },
  ],
  exports: [SessionService, AdminLan],
})
export class AuthModule {}
