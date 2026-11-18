import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { apiEnvSchema, parseEnv } from '@olt/shared';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';

async function bootstrap(): Promise<void> {
  const env = parseEnv(apiEnvSchema);
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env));
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(env.PORT, '0.0.0.0');
}

bootstrap().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
