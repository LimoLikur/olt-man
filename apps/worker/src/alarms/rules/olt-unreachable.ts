import type { AlarmSettings } from './settings.js';
import { type DesiredAlarm, keys } from './types.js';

/** olt_unreachable: unreachableCycles consecutive status timeouts; one success clears it. */
export const oltUnreachable = (timeouts: number, s: AlarmSettings): DesiredAlarm[] =>
  timeouts >= s.unreachableCycles ? [{ key: keys.unreachable(), kind: 'olt_unreachable', severity: 'critical', notify: true }] : [];
