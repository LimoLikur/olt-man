import type { OidProfile, OidProfileId } from './types.js';
import { zteC320V21 } from './zte-c320-v2_1.js';
import { zteC320V22 } from './zte-c320-v2_2.js';

export type { IndexArcs, OidProfile, OidProfileId, OnuColumn, OnuColumns } from './types.js';
export { RX_NO_SIGNAL, RX_OLT_NO_SIGNAL, RX_VALID_DBM } from './common.js';
export { zteC320V21, zteC320V22 };

export const OID_PROFILES: Readonly<Record<OidProfileId, OidProfile>> = {
  'zte-c320-v2.1': zteC320V21,
  'zte-c320-v2.2': zteC320V22,
};

export const SYSTEM_OIDS = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysObjectID: '1.3.6.1.2.1.1.2.0',
  sysUpTime: '1.3.6.1.2.1.1.3.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  snmpEngineID: '1.3.6.1.6.3.10.2.1.1.0',
} as const;

/** Picks a profile from sysDescr ("... Software Version: V2.1.0 ..."): V2.1 -> 1012, V2.2+ -> 1082. */
export function detectProfile(sysDescr: string): OidProfile | null {
  if (!/C320/i.test(sysDescr)) return null;
  const m = /\bV(\d+)\.(\d+)(?:\.\d+)*/i.exec(sysDescr);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  if (major !== 2) return major > 2 ? zteC320V22 : null;
  if (minor <= 1) return zteC320V21;
  return zteC320V22;
}
