import { type DesiredAlarm, keys, type OnuSnapshot } from './types.js';

/** onu_dying_gasp: phase is DyingGasp right now; clears when it leaves that phase. No Telegram. */
export const onuDyingGasp = (onus: OnuSnapshot[]): DesiredAlarm[] =>
  onus
    .filter((o) => o.phase === 'dying_gasp')
    .map((o) => ({ key: keys.dyingGasp(o.onuId), kind: 'onu_dying_gasp', severity: 'warning', port: o.port, onuId: o.onuId, notify: false }));
