import type { PhaseState } from '@olt/olt-spec';
import type { AlarmSettings } from './settings.js';
import { type DesiredAlarm, keys, type OnuSnapshot } from './types.js';

/**
 * pon_mass_los / pon_mass_power: at least massMinCount ONUs, or at least massRatio of the port
 * (and at least massMinOnus ONUs), are in LOS / DyingGasp right now. The current state is
 * counted, not only recent transitions, so ONUs already down when polling starts count too.
 * The alarm lasts while the count stays at or above the threshold.
 */
export function ponMass(onus: OnuSnapshot[], s: AlarmSettings): DesiredAlarm[] {
  const out: DesiredAlarm[] = [];
  const ports = new Map<string, OnuSnapshot[]>();
  for (const o of onus) ports.set(o.port, [...(ports.get(o.port) ?? []), o]);

  const rules: [PhaseState, 'pon_mass_los' | 'pon_mass_power', (p: string) => string][] = [
    ['los', 'pon_mass_los', keys.massLos],
    ['dying_gasp', 'pon_mass_power', keys.massPower],
  ];
  for (const [port, members] of ports) {
    const threshold = (n: number) => n >= s.massMinCount || (n >= s.massMinOnus && n >= s.massRatio * members.length);
    for (const [phase, kind, key] of rules) {
      const inState = members.filter((o) => o.phase === phase);
      if (threshold(inState.length)) {
        out.push({ key: key(port), kind, severity: 'critical', port, notify: true });
      }
    }
  }
  return out;
}
