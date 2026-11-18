import { type DynamicModule, Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createPrisma, type PrismaClient } from '@olt/db';
import type { ApiEnv } from '@olt/shared';
import { Redis } from 'ioredis';
import { API_CONFIG, CLOCK, type Clock, PRISMA, REDIS, systemClock } from './tokens.js';

/** Config, database, Redis and clock for every module. Tests swap the clock. */
@Global()
@Module({})
export class InfraModule {
  static forRoot(config: ApiEnv, clock: Clock = systemClock): DynamicModule {
    return {
      module: InfraModule,
      providers: [
        { provide: API_CONFIG, useValue: config },
        { provide: CLOCK, useValue: clock },
        { provide: PRISMA, useFactory: () => createPrisma(config.DATABASE_URL) },
        { provide: REDIS, useFactory: () => new Redis(config.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 2 }) },
        InfraShutdown,
      ],
      exports: [API_CONFIG, CLOCK, PRISMA, REDIS],
    };
  }
}


@Injectable()
class InfraShutdown implements OnApplicationShutdown {
  constructor(
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.prisma.$disconnect();
    this.redis.disconnect();
  }
}
