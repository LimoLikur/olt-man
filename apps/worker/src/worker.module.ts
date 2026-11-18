import { type DynamicModule, Inject, Injectable, Logger, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { createPrisma, type PrismaClient } from '@olt/db';
import type { WorkerEnv } from '@olt/shared';
import { Redis } from 'ioredis';
import { CredentialDecryptor } from './crypto/credential.decryptor.js';
import { RedisEventPublisher } from './events/publisher.js';
import { TargetGuard } from './guards/target.guard.js';
import { HeartbeatModule } from './heartbeat/heartbeat.module.js';
import { TelegramOutbox } from './notify/telegram.outbox.js';
import { OltRunner } from './runner/olt-runner.js';

const WORKER_ENV = Symbol('WORKER_ENV');

@Injectable()
class RunnerHost implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('OltRunner');
  private runner: OltRunner | undefined;
  private prisma: PrismaClient | undefined;
  private redis: Redis | undefined;

  constructor(@Inject(WORKER_ENV) private readonly env: WorkerEnv) {}

  async onApplicationBootstrap(): Promise<void> {
    const env = this.env;
    this.prisma = createPrisma(env.DATABASE_URL);
    this.redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    const outbox =
      env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID
        ? new TelegramOutbox(this.prisma, { apiBase: env.TELEGRAM_API_BASE, token: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_CHAT_ID })
        : undefined;
    if (!outbox) this.logger.warn('Telegram not configured: notifications stay pending in the outbox');
    const url = new URL(env.REDIS_URL);
    this.runner = new OltRunner({
      connection: { host: url.hostname, port: Number(url.port || 6379), ...(url.password ? { password: decodeURIComponent(url.password) } : {}) },
      deps: {
        prisma: this.prisma,
        decryptor: CredentialDecryptor.fromFile(env.OLT_CRED_PRIVATE_KEY_FILE),
        guard: new TargetGuard(env.OLT_TARGET_CIDRS, env.MOCK_OLT_CIDRS),
        publisher: new RedisEventPublisher(this.redis),
        now: () => new Date(),
      },
      uiBaseUrl: env.UI_BASE_URL,
      ...(outbox ? { outbox } : {}),
      log: {
        info: (msg, data) => this.logger.log(data ? `${msg} ${JSON.stringify(data)}` : msg),
        error: (msg, data) => this.logger.error(data ? `${msg} ${JSON.stringify(data)}` : msg),
      },
    });
    await this.runner.start();
    this.logger.log('started');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.runner?.stop();
    await this.prisma?.$disconnect();
    this.redis?.disconnect();
  }
}

@Module({})
export class WorkerModule {
  static forEnv(env: WorkerEnv): DynamicModule {
    return {
      module: WorkerModule,
      imports: [HeartbeatModule.register({ file: env.HEARTBEAT_FILE, intervalMs: env.HEARTBEAT_INTERVAL_MS })],
      providers: [{ provide: WORKER_ENV, useValue: env }, RunnerHost],
    };
  }
}
