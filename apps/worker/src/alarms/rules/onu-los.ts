import { type DesiredAlarm, keys, type OnuSnapshot } from './types.js';

/** onu_los: phase is LOS; clears when it is back to working (or anything else). No Telegram. */
export const onuLos = (onus: OnuSnapshot[]): DesiredAlarm[] =>
  onus.filter((o) => o.phase === 'los').map((o) => ({ key: keys.onuLos(o.onuId), kind: 'onu_los', severity: 'warning', port: o.port, onuId: o.onuId, notify: false }));
