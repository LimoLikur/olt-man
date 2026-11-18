import { z } from 'zod';

const timezone = z
  .string({ error: 'APP_TIMEZONE is required (IANA name, e.g. Asia/Jakarta)' })
  .min(1, { error: 'APP_TIMEZONE is required (IANA name, e.g. Asia/Jakarta)', abort: true })
  .refine(
    (tz) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { error: 'APP_TIMEZONE must be a valid IANA time zone' },
  );

const url = (protocols: string[]) =>
  z.url({ protocol: new RegExp(`^(${protocols.join('|')})$`) });

/** `KEY=` in an env file means "not set". */
const emptyAsUnset = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (v === '' ? undefined : v), schema);

/** Comma-separated IPv4/IPv6 CIDRs, e.g. "172.30.0.0/24,10.20.0.5/32". At least one. */
export const cidrListSchema = z
  .string()
  .transform((s) => s.split(',').map((c) => c.trim()).filter(Boolean))
  .pipe(z.array(z.union([z.cidrv4(), z.cidrv6()])).min(1));

/** Variables shared by api and worker (SPEC §6.8). APP_TIMEZONE has no default on purpose. */
export const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  APP_TIMEZONE: timezone,
  DATABASE_URL: url(['postgres', 'postgresql']),
  REDIS_URL: url(['redis', 'rediss']),
});



export const apiEnvSchema = baseEnvSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Origins allowed for state-changing requests (CSRF defence), comma-separated. */
  APP_ORIGINS: z
    .string()
    .default('https://localhost')
    .transform((s) => s.split(',').map((o) => o.trim()).filter(Boolean))
    .pipe(z.array(z.url()).min(1)),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(24 * 60).default(30),
  SESSION_MAX_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  /** Office LAN: the only networks the admin role may be used from (CLAUDE.md rule 8). */
  ADMIN_ALLOWED_CIDRS: cidrListSchema,
  /** RSA public key (PEM) for sealing OLT credentials, or a file holding it (Docker secret). */
  OLT_CRED_PUBLIC_KEY: z.string().min(1).optional(),
  OLT_CRED_PUBLIC_KEY_FILE: z.string().min(1).optional(),
});

export const workerEnvSchema = baseEnvSchema.extend({
  /** The only addresses the worker may contact (SPEC §2.2 no. 9). Dev/test: mock network only. */
  OLT_TARGET_CIDRS: cidrListSchema,
  /** Mock OLT network; write jobs require the target to be inside it (SPEC §8.5 guard 2). */
  MOCK_OLT_CIDRS: cidrListSchema,
  /** Telegram outbox (E6). Without token + chat ID notifications stay pending. */
  TELEGRAM_BOT_TOKEN: emptyAsUnset(z.string().regex(/^\d+:[\w-]{20,}$/).optional()),
  TELEGRAM_CHAT_ID: emptyAsUnset(z.string().regex(/^-?\d+$/).optional()),
  /** Overridable so tests use a fake Telegram server. */
  TELEGRAM_API_BASE: z.url().default('https://api.telegram.org'),
  /** Public UI URL used for links in messages. */
  UI_BASE_URL: z.url().default('https://localhost'),
  /** Docker secret with the RSA private key (worker only). */
  OLT_CRED_PRIVATE_KEY_FILE: z.string().min(1),
  HEARTBEAT_FILE: z.string().min(1).default('/tmp/worker-heartbeat'),
  HEARTBEAT_INTERVAL_MS: z.coerce.number().int().min(1000).default(10_000),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid environment:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Validates process.env against a schema. Error messages name the variable but never echo
 * its value, so secrets in DATABASE_URL and friends cannot leak into logs.
 */
export function parseEnv<S extends z.ZodType>(schema: S, source: NodeJS.ProcessEnv = process.env): z.infer<S> {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}
