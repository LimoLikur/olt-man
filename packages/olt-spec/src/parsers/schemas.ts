import { z } from 'zod';
import { CONTROL_CHARS, onuIdSchema, onuRefSchema, ponRefSchema, slotSchema, vlanSchema } from '../params.js';
import { PHASE_STATES } from '../types.js';

// Parsed CLI output is validated before anything downstream (DB, command builders) sees it.

const label = z.string().regex(/^[\x21-\x7e]{1,64}$/);
const text = z
  .string()
  .max(256)
  .refine((v) => !CONTROL_CHARS.test(v), 'control characters');
const oltTime = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
const dbm = z.number().min(-60).max(30).nullable();

export const onuStateSchema = z.object({
  rows: z.array(
    onuRefSchema.extend({
      adminState: label,
      omccState: label,
      /** Manual layout only; V2.1.0 has no O7 column. */
      o7State: label.optional(),
      phase: z.enum(PHASE_STATES),
      phaseLabel: label,
      /** V2.1.0 only, e.g. "1(GPON)". */
      channel: label.optional(),
    }),
  ),
  onuNumber: z.object({ online: z.number().int().min(0), total: z.number().int().min(0) }).nullable(),
});

export const attenuationSchema = z.object({
  upstream: z.object({ oltRxDbm: dbm, onuTxDbm: dbm, attenuationDb: z.number().min(0).max(60).nullable() }),
  downstream: z.object({ oltTxDbm: dbm, onuRxDbm: dbm, attenuationDb: z.number().min(0).max(60).nullable() }),
});

export const detailInfoSchema = z.object({
  onu: onuRefSchema,
  name: text,
  type: text,
  state: text,
  adminState: text,
  phase: z.enum(PHASE_STATES),
  phaseLabel: text,
  serialNumber: text,
  description: text,
  distanceM: z.number().int().min(0).max(100_000).nullable(),
  onlineDurationS: z.number().int().min(0).nullable(),
  history: z.array(
    z.object({
      index: z.number().int().min(1),
      authpassTime: oltTime,
      /** null = still online (OLT prints 0000-00-00 00:00:00). */
      offlineTime: oltTime.nullable(),
      /** Kept verbatim, e.g. LOS, LOSi, DyingGasp. */
      cause: label.nullable(),
    }),
  ),
});

export const onuInterfaceSchema = z.object({
  inputBps: z.number().int().min(0),
  inputPps: z.number().int().min(0),
  outputBps: z.number().int().min(0),
  outputPps: z.number().int().min(0),
  inputThroughputPct: z.number().min(0).max(100).nullable(),
  outputThroughputPct: z.number().min(0).max(100).nullable(),
});

export const onuRunningConfigSchema = z.object({
  onu: onuRefSchema,
  name: label.nullable(),
  description: label.nullable(),
  tconts: z.array(z.object({ id: z.number().int(), name: label, profile: label })),
  gemports: z.array(z.object({ id: z.number().int(), name: label, tcont: z.number().int() })),
  servicePorts: z.array(z.object({ id: z.number().int(), vport: z.number().int(), userVlan: vlanSchema, vlan: vlanSchema, svlan: vlanSchema.nullable() })),
  lines: z.array(text),
});

export const onuMngConfigSchema = z.object({
  onu: onuRefSchema,
  services: z.array(z.object({ name: label, gemport: z.number().int(), vlan: vlanSchema })),
  vlanPorts: z.array(z.object({ port: label, mode: label, vlan: vlanSchema })),
  lines: z.array(text),
});

export const portRunningConfigSchema = z.object({
  pon: ponRefSchema,
  onus: z.array(z.object({ onuId: onuIdSchema, type: label, sn: label })),
});

export const cardSchema = z.array(
  z.object({
    rack: z.number().int(),
    shelf: z.number().int(),
    slot: slotSchema,
    cfgType: label,
    realType: label,
    ports: z.number().int().min(0),
    hardVer: label,
    softVer: label,
    status: label,
  }),
);

export const writeResultSchema = z.object({ ok: z.boolean() });

export const vlanSummarySchema = z.object({ total: z.number().int().min(0), vlans: z.array(z.number().int().min(1).max(4094)) });

export const onuUncfgSchema = z.object({
  onus: z.array(z.object({ slot: z.number().int().min(1), port: z.number().int().min(1), index: z.number().int().min(1), sn: z.string().regex(/^[A-Za-z0-9]{1,32}$/), state: z.string().min(1) })),
});

const kbps = z.number().int().min(0);
export const tcontProfilesSchema = z.object({
  profiles: z.array(z.object({ name: z.string().min(1), type: z.number().int().min(1).max(5), fbwKbps: kbps, abwKbps: kbps, mbwKbps: kbps })).min(1),
});

export type OnuState = z.infer<typeof onuStateSchema>;
export type VlanSummary = z.infer<typeof vlanSummarySchema>;
export type TcontProfiles = z.infer<typeof tcontProfilesSchema>;
export type OnuUncfg = z.infer<typeof onuUncfgSchema>;
export type Attenuation = z.infer<typeof attenuationSchema>;
export type DetailInfo = z.infer<typeof detailInfoSchema>;
export type OnuInterface = z.infer<typeof onuInterfaceSchema>;
export type OnuRunningConfig = z.infer<typeof onuRunningConfigSchema>;
export type OnuMngConfig = z.infer<typeof onuMngConfigSchema>;
export type PortRunningConfig = z.infer<typeof portRunningConfigSchema>;
export type CardRow = z.infer<typeof cardSchema>[number];
