import type { AlarmSettings } from './settings.js';
import { type ActiveAlarm, type DesiredAlarm, keys, type OnuSnapshot } from './types.js';

/** working -> LOS / offline counts as a drop; DyingGasp (power) does not (SPEC §8.2). */
export const drops = (o: OnuSnapshot) => o.transitions.filter((t) => t.from === 'working' && (t.to === 'los' || t.to === 'offline'));

/**
 * onu_flapping: >= flapCount drops within flapWindowMs. Once active it stays until
 * flapQuietMs pass without a drop.
 */
export function onuFlapping(onus: OnuSnapshot[], active: ActiveAlarm[], now: number, s: AlarmSettings): DesiredAlarm[] {
  const out: DesiredAlarm[] = [];
  for (const o of onus) {
    const d = drops(o);
    const inWindow = d.filter((t) => t.ts <= now && now - t.ts <= s.flapWindowMs).length;
    const wasActive = active.some((a) => a.key === keys.flapping(o.onuId));
    const lastDrop = d.at(-1)?.ts;
    const stillNoisy = wasActive && lastDrop !== undefined && now - lastDrop < s.flapQuietMs;
    if (inWindow >= s.flapCount || stillNoisy) {
      out.push({ key: keys.flapping(o.onuId), kind: 'onu_flapping', severity: 'warning', port: o.port, onuId: o.onuId, notify: true });
    }
  }
  return out;
}
