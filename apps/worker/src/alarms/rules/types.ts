import type { PhaseState } from '@olt/olt-spec';

export type AlarmKind = 'onu_los' | 'onu_flapping' | 'onu_rx_low' | 'pon_mass_los' | 'pon_mass_power' | 'olt_unreachable';
export type Severity = 'info' | 'warning' | 'critical';

export interface Transition {
  /** Worker observation time (ms). */
  ts: number;
  from: PhaseState;
  to: PhaseState;
}

export interface OnuSnapshot {
  onuId: number;
  /** "slot/port" */
  port: string;
  phase: PhaseState;
  /** ONU-side Rx in dBm; null = no reading / no signal. */
  rxDbm: number | null;
  /** Recent transitions, oldest first (at least the flapping window). */
  transitions: Transition[];
}

export interface ActiveAlarm {
  key: string;
  kind: AlarmKind;
  severity: Severity;
}

export interface Snapshot {
  now: number;
  /** Consecutive status cycles that timed out. */
  oltTimeouts: number;
  /** Every active ONU of the OLT (port sizes come from here). */
  onus: OnuSnapshot[];
  /** Alarms currently active, for hysteresis / clear conditions. */
  active: ActiveAlarm[];
}

export interface DesiredAlarm {
  key: string;
  kind: AlarmKind;
  severity: Severity;
  port?: string;
  onuId?: number;
  /** Key of the alarm holding this one (suppression, SPEC §8.2). */
  parentKey?: string;
  /** Telegram on start and end (SPEC §8.2 column "Telegram"). */
  notify: boolean;
}

export const keys = {
  onuLos: (onuId: number) => `onu_los:onu:${onuId}`,
  flapping: (onuId: number) => `onu_flapping:onu:${onuId}`,
  rxLow: (onuId: number) => `onu_rx_low:onu:${onuId}`,
  massLos: (port: string) => `pon_mass_los:port:${port}`,
  massPower: (port: string) => `pon_mass_power:port:${port}`,
  unreachable: () => 'olt_unreachable',
};
