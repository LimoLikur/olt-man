import { type DynamicModule, type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import type { ApiEnv } from '@olt/shared';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { InfraModule } from './common/infra.module.js';
import { RequestLogMiddleware } from './common/request-log.middleware.js';
import type { Clock } from './common/tokens.js';
import { HealthController } from './health/health.controller.js';
import { RestModule } from './rest.module.js';

@Module({})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestLogMiddleware).forRoutes('*path');
  }

  static forRoot(config: ApiEnv, clock?: Clock): DynamicModule {
    return {
      module: AppModule,
      imports: [InfraModule.forRoot(config, clock), AuditModule, AuthModule, RestModule],
      controllers: [HealthController],
    };
  }
}
