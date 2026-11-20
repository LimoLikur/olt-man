import { onuDyingGasp } from './onu-dying-gasp.js';
import { onuFlapping } from './onu-flapping.js';
import { onuLos } from './onu-los.js';
import { onuRxLow } from './onu-rx-low.js';
import { oltUnreachable } from './olt-unreachable.js';
import { ponMass } from './pon-mass.js';
import type { AlarmSettings } from './settings.js';
import { type DesiredAlarm, keys, type Snapshot } from './types.js';

export * from './settings.js';
export * from './types.js';

/**
 * All §8.2 rules for one OLT, plus suppression: a held alarm is still returned, with
 * parentKey pointing at the alarm holding it (OLT unreachable > mass > flapping > onu_los / onu_dying_gasp).
 */
export function evaluate(snap: Snapshot, s: AlarmSettings): DesiredAlarm[] {
  const unreachable = oltUnreachable(snap.oltTimeouts, s);
  if (unreachable.length) {
    // While the OLT is unreachable there is no fresh ONU data: keep ONU alarms as children.
    const held = snap.active.filter((a) => a.kind !== 'olt_unreachable').map((a) => ({ ...a, notify: false, parentKey: keys.unreachable() }));
    return [...unreachable, ...held];
  }

  const mass = ponMass(snap.onus, s);
  const flapping = onuFlapping(snap.onus, snap.active, snap.now, s);
  const los = onuLos(snap.onus);
  const gasp = onuDyingGasp(snap.onus);
  const rx = onuRxLow(snap.onus, snap.active, s);

  const massByPort = new Map(mass.filter((m) => m.kind === 'pon_mass_los').map((m) => [m.port!, m.key]));
  const powerByPort = new Map(mass.filter((m) => m.kind === 'pon_mass_power').map((m) => [m.port!, m.key]));
  const flapByOnu = new Map(flapping.map((f) => [f.onuId!, f.key]));
  for (const f of flapping) {
    const parent = massByPort.get(f.port!);
    if (parent) f.parentKey = parent;
  }
  for (const l of los) {
    const parent = massByPort.get(l.port!) ?? flapByOnu.get(l.onuId!);
    if (parent) l.parentKey = parent;
  }
  for (const g of gasp) {
    const parent = powerByPort.get(g.port!);
    if (parent) g.parentKey = parent;
  }
  return [...mass, ...flapping, ...los, ...gasp, ...rx];
}
