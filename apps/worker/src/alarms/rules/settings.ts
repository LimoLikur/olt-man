import { z } from 'zod';

/** Per-OLT alarm settings (olt.alarm_settings, SPEC §2.2 no. 7). Defaults follow SPEC §8.2. */
export const alarmSettingsSchema = z.object({
  massWindowMs: z.number().int().positive().default(2 * 60_000),
  massMinCount: z.number().int().positive().default(4),
  massRatio: z.number().positive().max(1).default(0.5),
  /** Interpretation of §2.2 no. 10: the ratio rule needs at least this many ONUs in the condition. */
  massMinOnus: z.number().int().positive().default(2),
  flapCount: z.number().int().positive().default(3),
  flapWindowMs: z.number().int().positive().default(60 * 60_000),
  flapQuietMs: z.number().int().positive().default(60 * 60_000),
  rxWarnDbm: z.number().default(-25),
  rxCritDbm: z.number().default(-27),
  rxHysteresisDb: z.number().nonnegative().default(1),
  unreachableCycles: z.number().int().positive().default(2),
});
export type AlarmSettings = z.infer<typeof alarmSettingsSchema>;

/** Fast timing for mock OLTs so a demo does not wait an hour (thresholds unchanged). */
const PROFILES: Record<string, Partial<AlarmSettings>> = {
  'mock-fast': { flapWindowMs: 15 * 60_000, flapQuietMs: 5 * 60_000 },
};

/** `{ profile: 'mock-fast', ...overrides }` from olt.alarm_settings -> full settings. */
export function resolveAlarmSettings(raw: unknown): AlarmSettings {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const { profile, ...overrides } = obj;
  const base = typeof profile === 'string' ? (PROFILES[profile] ?? {}) : {};
  return alarmSettingsSchema.parse({ ...base, ...overrides });
}

export const DEFAULT_ALARM_SETTINGS = alarmSettingsSchema.parse({});
