import type { NestExpressApplication } from '@nestjs/platform-express';

/** Shared by main.ts and tests. */
export function configureApp(app: NestExpressApplication): void {
  app.setGlobalPrefix('api');
  // Exactly one trusted hop (caddy): req.ip is what caddy saw, client-sent XFF is ignored.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
}
