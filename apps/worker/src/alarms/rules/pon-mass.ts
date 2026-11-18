import type { PhaseState } from '@olt/olt-spec';
import type { AlarmSettings } from './settings.js';
import { type ActiveAlarm, type DesiredAlarm, keys, type OnuSnapshot } from './types.js';

/**
 * pon_mass_los / pon_mass_power: within massWindowMs at least massMinCount ONUs, or at least
 * massRatio of the port (and at least massMinOnus ONUs), went into LOS / DyingGasp. Once
 * active it lasts while the number of ONUs in that state stays at or above the threshold.
 */
export function ponMass(onus: OnuSnapshot[], active: ActiveAlarm[], now: number, s: AlarmSettings): DesiredAlarm[] {
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
      const recent = inState.filter((o) => o.transitions.some((t) => t.to === phase && t.ts <= now && now - t.ts <= s.massWindowMs));
      const wasActive = active.some((a) => a.key === key(port));
      if (threshold(recent.length) || (wasActive && threshold(inState.length))) {
        out.push({ key: key(port), kind, severity: 'critical', port, notify: true });
      }
    }
  }
  return out;
}
