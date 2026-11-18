import { z } from 'zod';
import {
  lanPortsSchema,
  onuDescriptionSchema,
  onuIdSchema,
  onuNameSchema,
  onuTypeSchema,
  portSchema,
  pppoePasswordSchema,
  pppoeUsernameSchema,
  PROVISION_MODES,
  type ProvisionMode,
  serialNumberSchema,
  slotSchema,
  tcontProfileSchema,
  vlanSchema,
} from '../params.js';
import { type AllowedCommand, CommandBuildError, mint } from './allowed.js';

// Fase 2 (CLAUDE.md rule 3; open to real OLTs since 2026-11-13). Allowlist membership and
// "ID still free" are checked by the api and again by the worker; this module guarantees that
// only schema-valid values can ever reach a command line.

/**
 * Registration fields. `mode` picks the template (SPEC §8.5): `default` is the manual's internet
 * template, `bridge`, `pppoe_map` and `bridge_static` field configurations (owner decisions
 * 2026-11-14, 2026-11-15 and 2026-11-17). Without `mode` a job is `default`, so its preview and
 * hash stay what they were. A plain object, so the api can derive its draft from it (Zod 4 refuses
 * `.omit` on a refined schema); see checkProvisionMode.
 */
export const provisionParamsShape = z.strictObject({
  mode: z.enum(PROVISION_MODES).default('default'),
  slot: slotSchema,
  port: portSchema,
  onuId: onuIdSchema,
  sn: serialNumberSchema,
  name: onuNameSchema,
  onuType: onuTypeSchema,
  tcontProfile: tcontProfileSchema,
  vlan: vlanSchema,
  /** Bridge, PPPoE MAP and Bridge Static; without it the `description` line is left out. */
  description: onuDescriptionSchema.optional(),
  /** Bridge and Bridge Static: the bridging VLAN is tagged on eth_0/1 to eth_0/lanPorts. */
  lanPorts: lanPortsSchema.optional(),
  /** Bridge Static only: T-CONT 2 and the bridging service on vport 2 (owner decision 2026-11-17). */
  bridgeTcontProfile: tcontProfileSchema.optional(),
  bridgeVlan: vlanSchema.optional(),
  /** PPPoE MAP only: the ONU's PPPoE account, sent and stored as typed (owner decision 2026-11-15). */
  pppoeUsername: pppoeUsernameSchema.optional(),
  pppoePassword: pppoePasswordSchema.optional(),
});

const MODE_FIELD_NAMES = ['description', 'lanPorts', 'pppoeUsername', 'pppoePassword', 'bridgeTcontProfile', 'bridgeVlan'] as const;
type ModeField = (typeof MODE_FIELD_NAMES)[number];
type ModeFields = { mode: ProvisionMode; vlan: number } & { [K in ModeField]?: string | number | undefined };
type IssueSink = { addIssue(issue: { code: 'custom'; path: PropertyKey[]; message: string }): void };

/** Per mode: the mode-specific fields it uses, and which of them it requires. */
const MODE_FIELDS: Record<ProvisionMode, { allowed: readonly ModeField[]; required: readonly ModeField[] }> = {
  default: { allowed: [], required: [] },
  bridge: { allowed: ['description', 'lanPorts'], required: ['lanPorts'] },
  pppoe_map: { allowed: ['description', 'pppoeUsername', 'pppoePassword'], required: ['pppoeUsername', 'pppoePassword'] },
  bridge_static: { allowed: ['description', 'lanPorts', 'bridgeTcontProfile', 'bridgeVlan'], required: ['lanPorts', 'bridgeTcontProfile', 'bridgeVlan'] },
};

/**
 * The fields that belong to some modes only: required where the template needs them, refused
 * elsewhere. Bridge Static also needs a bridging VLAN other than the static one (2026-11-17).
 */
export function checkProvisionMode(p: ModeFields, ctx: IssueSink): void {
  const { allowed, required } = MODE_FIELDS[p.mode];
  for (const field of MODE_FIELD_NAMES) {
    if (p[field] === undefined) {
      if (required.includes(field)) ctx.addIssue({ code: 'custom', path: [field], message: `required in mode ${p.mode}` });
    } else if (!allowed.includes(field)) {
      ctx.addIssue({ code: 'custom', path: [field], message: `not used in mode ${p.mode}` });
    }
  }
  if (p.mode === 'bridge_static' && p.bridgeVlan === p.vlan) ctx.addIssue({ code: 'custom', path: ['bridgeVlan'], message: 'must differ from vlan' });
}

export const provisionParamsSchema = provisionParamsShape.superRefine(checkProvisionMode);
export type ProvisionParams = z.output<typeof provisionParamsSchema>;
export type ProvisionParamsInput = z.input<typeof provisionParamsSchema>;

type Line = readonly [text: string, kind: 'session' | 'write'];
const session = (text: string): Line => [text, 'session'];
const config = (text: string): Line => [text, 'write'];

function paramsFor(input: ProvisionParamsInput, mode: ProvisionMode): ProvisionParams {
  const p = provisionParamsSchema.parse(input);
  if (p.mode !== mode) throw new CommandBuildError(`not a ${mode} registration`);
  return p;
}

/**
 * Mode `default`: registers an internet-only ONU, SPEC §8.5 template (manual Bab IV-A, hlm.
 * 12-14) with the `name` line from the field example on hlm. 20. Mode changes are `session`,
 * config lines `write`; a read-mode CLI session refuses all of the latter.
 */
export function registerOnuInternet(input: ProvisionParamsInput): AllowedCommand[] {
  const p = paramsFor(input, 'default');
  const onu = `gpon-onu_1/${p.slot}/${p.port}:${p.onuId}`;
  const lines: Line[] = [
    session('configure terminal'),
    session(`interface gpon-olt_1/${p.slot}/${p.port}`),
    config(`onu ${p.onuId} type ${p.onuType} sn ${p.sn}`),
    session('exit'),
    session(`interface ${onu}`),
    config(`name ${p.name}`),
    config(`tcont 1 name T1 profile ${p.tcontProfile}`),
    config('gemport 1 name gemport1 unicast tcont 1'),
    config(`service-port 1 vport 1 user-vlan ${p.vlan} vlan ${p.vlan}`),
    session('exit'),
    session(`pon-onu-mng ${onu}`),
    config(`service HSI type internet gemport 1 cos 0 vlan ${p.vlan}`),
    config(`vlan port eth_0/1 mode tag vlan ${p.vlan} priority 0`),
    session('end'),
  ];
  return lines.map(([text, kind]) => mint(text, kind));
}

/**
 * Mode `bridge`: the field configuration (owner's example, 2026-11-14). SN binding, T-CONT and
 * gemport "bridging", one service-port, the remote-id sub-option on vport 1 (the vport 2 line was
 * dropped 2026-11-17: only Bridge Static has a vport 2), the bridging service on the VEIP, and the
 * VLAN tagged on eth_0/1 to eth_0/lanPorts. A LAN port the ONU does not have is refused by the
 * OLT: the job stops at that line, without `write` (SPEC §8.5).
 */
export function registerOnuBridge(input: ProvisionParamsInput): AllowedCommand[] {
  const p = paramsFor(input, 'bridge');
  if (p.lanPorts === undefined) throw new CommandBuildError('bridge registration without lanPorts');
  const onu = `gpon-onu_1/${p.slot}/${p.port}:${p.onuId}`;
  const lines: Line[] = [
    session('configure terminal'),
    session(`interface gpon-olt_1/${p.slot}/${p.port}`),
    config(`onu ${p.onuId} type ${p.onuType} sn ${p.sn}`),
    session('exit'),
    session(`interface ${onu}`),
    config(`name ${p.name}`),
    ...(p.description === undefined ? [] : [config(`description ${p.description}`)]),
    config('sn-bind enable sn'),
    config(`tcont 1 profile ${p.tcontProfile}`),
    config('gemport 1 name bridging tcont 1'),
    config(`service-port 1 vport 1 user-vlan ${p.vlan} vlan ${p.vlan}`),
    config('port-identification sub-option remote-id enable vport 1'),
    session('exit'),
    session(`pon-onu-mng ${onu}`),
    config(`service bridging gemport 1 vlan ${p.vlan}`),
    config('switchport-bind switch_0/1 veip 1'),
    ...Array.from({ length: p.lanPorts }, (_, i) => config(`vlan port eth_0/${i + 1} mode tag vlan ${p.vlan}`)),
    session('end'),
  ];
  return lines.map(([text, kind]) => mint(text, kind));
}

/**
 * Mode `pppoe_map`: the field PPPoE configuration (owner's example, 2026-11-15). SN binding, T-CONT
 * and gemport "AUD", one service-port with the PPPoE intermediate agent, the AUD service, the WAN
 * in PPPoE mode on the OLT's vlan-profile "PPPoE" (a prerequisite, like T-CONT profiles), ping and
 * traceroute answered, and web management forwarded. The PPPoE password is a plain parameter:
 * it is in the preview and the job as typed (owner decision 2026-11-15).
 */
export function registerOnuPppoeMap(input: ProvisionParamsInput): AllowedCommand[] {
  const p = paramsFor(input, 'pppoe_map');
  if (p.pppoeUsername === undefined || p.pppoePassword === undefined) throw new CommandBuildError('PPPoE MAP registration without its PPPoE account');
  const onu = `gpon-onu_1/${p.slot}/${p.port}:${p.onuId}`;
  const lines: Line[] = [
    session('configure terminal'),
    session(`interface gpon-olt_1/${p.slot}/${p.port}`),
    config(`onu ${p.onuId} type ${p.onuType} sn ${p.sn}`),
    session('exit'),
    session(`interface ${onu}`),
    config(`name ${p.name}`),
    ...(p.description === undefined ? [] : [config(`description ${p.description}`)]),
    config('sn-bind enable sn'),
    config(`tcont 1 profile ${p.tcontProfile}`),
    config('gemport 1 name AUD tcont 1'),
    config(`service-port 1 vport 1 user-vlan ${p.vlan} vlan ${p.vlan}`),
    config('pppoe-intermediate-agent enable sport 1'),
    session('exit'),
    session(`pon-onu-mng ${onu}`),
    config(`service AUD gemport 1 vlan ${p.vlan}`),
    config(`wan-ip 1 mode pppoe username ${p.pppoeUsername} password ${p.pppoePassword} vlan-profile PPPoE host 1`),
    config('wan-ip 1 ping-response enable traceroute-response enable'),
    config('security-mgmt 1 state enable mode forward protocol web'),
    session('end'),
  ];
  return lines.map(([text, kind]) => mint(text, kind));
}

/**
 * Mode `bridge_static` ("Bridge Static"): the field configuration (owner's example, 2026-11-17).
 * Two services on one ONU: `static` on T-CONT 1, gemport "AUD" and vport 1 with `vlan`, and
 * `bridging` on T-CONT 2, gemport "bridging" and vport 2 with `bridgeVlan`, each with its own
 * T-CONT profile. The remote-id sub-option on vport 1 and 2, the VEIP bind, and `bridgeVlan`
 * tagged on eth_0/1 to eth_0/lanPorts. A missing LAN port stops the job as in mode `bridge`.
 */
export function registerOnuBridgeStatic(input: ProvisionParamsInput): AllowedCommand[] {
  const p = paramsFor(input, 'bridge_static');
  if (p.lanPorts === undefined || p.bridgeTcontProfile === undefined || p.bridgeVlan === undefined) {
    throw new CommandBuildError('Bridge Static registration without its bridging fields');
  }
  const onu = `gpon-onu_1/${p.slot}/${p.port}:${p.onuId}`;
  const lines: Line[] = [
    session('configure terminal'),
    session(`interface gpon-olt_1/${p.slot}/${p.port}`),
    config(`onu ${p.onuId} type ${p.onuType} sn ${p.sn}`),
    session('exit'),
    session(`interface ${onu}`),
    config(`name ${p.name}`),
    ...(p.description === undefined ? [] : [config(`description ${p.description}`)]),
    config('sn-bind enable sn'),
    config(`tcont 1 profile ${p.tcontProfile}`),
    config(`tcont 2 profile ${p.bridgeTcontProfile}`),
    config('gemport 1 name AUD tcont 1'),
    config('gemport 2 name bridging tcont 2'),
    config(`service-port 1 vport 1 user-vlan ${p.vlan} vlan ${p.vlan}`),
    config(`service-port 2 vport 2 user-vlan ${p.bridgeVlan} vlan ${p.bridgeVlan}`),
    config('port-identification sub-option remote-id enable vport 1'),
    config('port-identification sub-option remote-id enable vport 2'),
    session('exit'),
    session(`pon-onu-mng ${onu}`),
    config(`service static gemport 1 vlan ${p.vlan}`),
    config(`service bridging gemport 2 vlan ${p.bridgeVlan}`),
    config('switchport-bind switch_0/1 veip 1'),
    ...Array.from({ length: p.lanPorts }, (_, i) => config(`vlan port eth_0/${i + 1} mode tag vlan ${p.bridgeVlan}`)),
    session('end'),
  ];
  return lines.map(([text, kind]) => mint(text, kind));
}

/** The registration in the template of its mode. */
export function registerOnu(input: ProvisionParamsInput): AllowedCommand[] {
  const p = provisionParamsSchema.parse(input);
  switch (p.mode) {
    case 'bridge':
      return registerOnuBridge(p);
    case 'pppoe_map':
      return registerOnuPppoeMap(p);
    case 'bridge_static':
      return registerOnuBridgeStatic(p);
    case 'default':
      return registerOnuInternet(p);
  }
}

/** Saves the whole running-config: after a verified registration, or as the admin's config.save. */
export const writeConfig = (): AllowedCommand => mint('write', 'write');

/**
 * The onu_register plan as previewed and hashed: the registration, then `write`. The worker
 * sends the last command only after the registration has been verified (SPEC §8.5).
 */
export function registerOnuAndSave(input: ProvisionParamsInput): AllowedCommand[] {
  return [...registerOnu(input), writeConfig()];
}

/**
 * What the verification step requires (SPEC §8.5): lines the ONU's running-config (`running`)
 * and its pon-onu-mng config (`mng`) must contain after the registration.
 */
export function expectedRegistrationLines(input: ProvisionParamsInput): { running: string[]; mng: string[] } {
  const p = provisionParamsSchema.parse(input);
  const running = [`name ${p.name}`, `user-vlan ${p.vlan} vlan ${p.vlan}`];
  if (p.mode === 'default') return { running, mng: [`vlan ${p.vlan}`] };
  const withDescription = [...running, ...(p.description === undefined ? [] : [`description ${p.description}`])];
  if (p.mode === 'pppoe_map') {
    // The WAN line up to the username: how the OLT shows the password does not matter here.
    return { running: withDescription, mng: [`service AUD gemport 1 vlan ${p.vlan}`, `wan-ip 1 mode pppoe username ${p.pppoeUsername}`] };
  }
  if (p.mode === 'bridge_static') {
    return {
      running: [...withDescription, `user-vlan ${p.bridgeVlan} vlan ${p.bridgeVlan}`],
      mng: [
        `service static gemport 1 vlan ${p.vlan}`,
        `service bridging gemport 2 vlan ${p.bridgeVlan}`,
        ...Array.from({ length: p.lanPorts ?? 0 }, (_, i) => `vlan port eth_0/${i + 1} mode tag vlan ${p.bridgeVlan}`),
      ],
    };
  }
  return {
    running: withDescription,
    mng: [`service bridging gemport 1 vlan ${p.vlan}`, ...Array.from({ length: p.lanPorts ?? 0 }, (_, i) => `vlan port eth_0/${i + 1} mode tag vlan ${p.vlan}`)],
  };
}
