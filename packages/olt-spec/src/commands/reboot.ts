import { z } from 'zod';
import { onuIdSchema, portSchema, serialNumberSchema, slotSchema } from '../params.js';
import { type AllowedCommand, mint } from './allowed.js';

// ONU reboot (SPEC §8.5, owner decision 2026-11-27): any role, run at once after the preview is
// confirmed. No configuration changes, so no `write`.

/**
 * The ONU's position and the SN it had when the preview was made. The worker reads the ONU's
 * detail-info first and reboots only when that SN is still there, so a reused ONU ID never
 * reboots another customer's ONU.
 */
export const onuRebootParamsSchema = z.strictObject({ slot: slotSchema, port: portSchema, onuId: onuIdSchema, sn: serialNumberSchema });
export type OnuRebootParams = z.output<typeof onuRebootParamsSchema>;
export type OnuRebootParamsInput = z.input<typeof onuRebootParamsSchema>;

/** What the C320 asks after `reboot` in pon-onu-mng mode (owner's OLT, 2026-11-27). */
export const REBOOT_QUESTION = /Confirm to reboot\? ?\[yes\/no\]: ?$/;

/**
 * `reboot` inside the ONU's pon-onu-mng mode, answered `yes` (owner's C320, 2026-11-27; `restart`
 * is not a command there). The session sends `reboot` only while the prompt shows that mode:
 * "(gpon-onu-mng 1/S/P:N)" on a real C320 V2.1, "(gpon-onu-mng)" in the manual.
 */
export function rebootOnu(input: OnuRebootParamsInput): AllowedCommand[] {
  const p = onuRebootParamsSchema.parse(input);
  const inMode = new RegExp(String.raw`^\(gpon-onu-mng(?: 1/${p.slot}/${p.port}:${p.onuId})?\)$`);
  return [
    mint('configure terminal', 'session'),
    mint(`pon-onu-mng gpon-onu_1/${p.slot}/${p.port}:${p.onuId}`, 'session'),
    mint('reboot', 'write', { inMode, confirm: { question: REBOOT_QUESTION, answer: 'yes' } }),
    mint('end', 'session'),
  ];
}
