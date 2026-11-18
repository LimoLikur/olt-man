import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { parseEnv, workerEnvSchema } from '@olt/shared';
import { WorkerModule } from './worker.module.js';

async function bootstrap(): Promise<void> {
  const env = parseEnv(workerEnvSchema);
  const app = await NestFactory.createApplicationContext(WorkerModule.forEnv(env));
  app.enableShutdownHooks();
  // Keep the event loop alive until a shutdown signal; jobs and schedulers arrive in E2.
  setInterval(() => undefined, 1 << 30);
}

bootstrap().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
