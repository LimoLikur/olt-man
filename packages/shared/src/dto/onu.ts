import { z } from 'zod';

const int = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

export const onuQuerySchema = z.strictObject({
  oltId: int(1, 2 ** 31 - 1).optional(),
  slot: int(1, 22).optional(),
  port: int(1, 16).optional(),
  phase: z.enum(['working', 'los', 'dying_gasp', 'offline', 'syncing', 'auth_failed', 'unknown']).optional(),
  /** ok >= -25, warn -27..-25, crit < -27 dBm (SPEC §8.2 thresholds). */
  rx: z.enum(['ok', 'warn', 'crit']).optional(),
  /** Name, SN or ONU index. */
  q: z.string().trim().min(1).max(64).optional(),
  page: int(1, 10_000).default(1),
  limit: int(1, 500).default(100),
});
export type OnuQuery = z.infer<typeof onuQuerySchema>;

export const metricsQuerySchema = z
  .strictObject({ from: z.iso.datetime({ offset: true }).optional(), to: z.iso.datetime({ offset: true }).optional() })
  .refine((v) => !v.from || !v.to || v.from <= v.to, 'from > to');

export interface OnuView {
  id: number;
  oltId: number;
  oltName: string;
  /** When not "ok" the ONU state is stale: the UI shows "tidak diketahui (terakhir: ...)". */
  oltStatus: string;
  slot: number;
  port: number;
  onuIndex: number;
  name: string | null;
  description: string | null;
  sn: string;
  type: string | null;
  phase: string | null;
  adminState: string | null;
  rxDbm: number | null;
  oltRxDbm: number | null;
  lastChangeAt: string | null;
  updatedAt: string | null;
}
