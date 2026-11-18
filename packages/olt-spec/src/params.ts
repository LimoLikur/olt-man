import { z } from 'zod';

// Strict per-field schemas (CLAUDE.md rule 6). Every value that ends up in a CLI command
// passes through one of these; allowlist regexes leave no room for spaces, CR/LF or controls.

export const slotSchema = z.number().int().min(1).max(22);
export const portSchema = z.number().int().min(1).max(16);
export const onuIdSchema = z.number().int().min(1).max(128);

export const ponRefSchema = z.strictObject({ slot: slotSchema, port: portSchema });
export const onuRefSchema = z.strictObject({ slot: slotSchema, port: portSchema, onuId: onuIdSchema });

/** GPON SN: 4 vendor chars + 8 hex digits, stored upper-case (SPEC §8.5). */
export const serialNumberSchema = z
  .string()
  .regex(/^[A-Za-z0-9]{4}[0-9A-Fa-f]{8}$/)
  .transform((s) => s.toUpperCase());

const token = z.string().regex(/^[A-Za-z0-9._-]{1,32}$/);
export const onuNameSchema = token;
/** Same rule as the name, no spaces (owner decision 2026-11-14). */
export const onuDescriptionSchema = token;
export const onuTypeSchema = token;
export const tcontProfileSchema = token;
export const vlanSchema = z.number().int().min(1).max(4094);
/** LAN ports a bridge registration tags: eth_0/1 to eth_0/N (owner decision 2026-11-14). */
export const lanPortsSchema = z.number().int().min(1).max(4);
/**
 * PPPoE account of a PPPoE MAP registration: letters, digits and `. _ - @` only (owner decision
 * 2026-11-15). Space and `?` mean something to the C320 CLI, quotes and controls are refused.
 */
export const pppoeUsernameSchema = z.string().regex(/^[A-Za-z0-9._@-]{1,64}$/);
export const pppoePasswordSchema = z.string().regex(/^[A-Za-z0-9._@-]{1,32}$/);

/**
 * Registration templates (SPEC §8.5): `default` is the manual's internet template, `bridge` the
 * field bridge configuration (2026-11-14), `pppoe_map` the field PPPoE configuration (2026-11-15),
 * `bridge_static` the field static-plus-bridging configuration (2026-11-17).
 */
export const PROVISION_MODES = ['default', 'bridge', 'pppoe_map', 'bridge_static'] as const;
export type ProvisionMode = (typeof PROVISION_MODES)[number];

export type PonRefInput = z.input<typeof ponRefSchema>;
export type OnuRefInput = z.input<typeof onuRefSchema>;

// Belt and braces: no C0 controls or DEL anywhere in a finished command.
// eslint-disable-next-line no-control-regex
export const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
