import type { AlarmSettings } from './settings.js';
import { type ActiveAlarm, type DesiredAlarm, keys, type OnuSnapshot, type Severity } from './types.js';

/**
 * onu_rx_low: below rxWarnDbm -> warning, below rxCritDbm -> critical. An active alarm only
 * clears (or drops a level) once Rx is rxHysteresisDb above the threshold. No reading keeps
 * the current state: an ONU without signal is onu_los' business.
 */
export function onuRxLow(onus: OnuSnapshot[], active: ActiveAlarm[], s: AlarmSettings): DesiredAlarm[] {
  const out: DesiredAlarm[] = [];
  for (const o of onus) {
    const current = active.find((a) => a.key === keys.rxLow(o.onuId));
    const severity = level(o.rxDbm, current?.severity, s);
    if (severity) out.push({ key: keys.rxLow(o.onuId), kind: 'onu_rx_low', severity, port: o.port, onuId: o.onuId, notify: false });
  }
  return out;
}

function level(rx: number | null, current: Severity | undefined, s: AlarmSettings): Severity | undefined {
  if (rx === null) return current;
  const h = s.rxHysteresisDb;
  if (rx < s.rxCritDbm || (current === 'critical' && rx < s.rxCritDbm + h)) return 'critical';
  if (rx < s.rxWarnDbm || (current !== undefined && rx < s.rxWarnDbm + h)) return 'warning';
  return undefined;
}
