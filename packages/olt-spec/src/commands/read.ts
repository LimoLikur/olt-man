import { onuIdSchema, onuRefSchema, type OnuRefInput, ponRefSchema, type PonRefInput } from '../params.js';
import { type AllowedCommand, mint } from './allowed.js';

const pon = (input: PonRefInput) => {
  const { slot, port } = ponRefSchema.parse(input);
  return `gpon-olt_1/${slot}/${port}`;
};

const onu = (input: OnuRefInput) => {
  const { slot, port, onuId } = onuRefSchema.parse(input);
  return `gpon-onu_1/${slot}/${port}:${onuId}`;
};

// Read-only builders of SPEC §6.2. Full `show running-config` is deliberately absent: it
// contains SNMP communities and OLT user passwords.

/** `show gpon onu state gpon-olt_1/S/P`, or the single-ONU form `... gpon-olt_1/S/P N` (hlm. 21). */
export function showOnuState(port: PonRefInput, onuId?: number): AllowedCommand {
  const suffix = onuId === undefined ? '' : ` ${onuIdSchema.parse(onuId)}`;
  return mint(`show gpon onu state ${pon(port)}${suffix}`, 'read');
}

export const showPortRunningConfig = (port: PonRefInput): AllowedCommand => mint(`show running-config interface ${pon(port)}`, 'read');

export const showOnuDetail = (ref: OnuRefInput): AllowedCommand => mint(`show gpon onu detail-info ${onu(ref)}`, 'read');

export const showAttenuation = (ref: OnuRefInput): AllowedCommand => mint(`show pon power attenuation ${onu(ref)}`, 'read');

export const showOnuInterface = (ref: OnuRefInput): AllowedCommand => mint(`show interface ${onu(ref)}`, 'read');

export const showOnuRunningConfig = (ref: OnuRefInput): AllowedCommand => mint(`show running-config interface ${onu(ref)}`, 'read');

export const showOnuMngConfig = (ref: OnuRefInput): AllowedCommand => mint(`show onu running config ${onu(ref)}`, 'read');

export const showCard = (): AllowedCommand => mint('show card', 'read');

/** `show vlan summary`: every VLAN created on the OLT (format from the owner's C320, 2026-11-13). */
export const showVlanSummary = (): AllowedCommand => mint('show vlan summary', 'read');

/** `show gpon profile tcont`: every T-CONT profile defined on the OLT (owner's C320 format, 2026-11-13). */
export const showTcontProfiles = (): AllowedCommand => mint('show gpon profile tcont', 'read');

/** `show gpon onu uncfg`: ONUs seen on any PON port but not registered (manual hlm. 11; owner's C320). */
export const showOnuUncfg = (): AllowedCommand => mint('show gpon onu uncfg', 'read');
