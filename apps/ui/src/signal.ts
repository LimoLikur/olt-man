/** SPEC §8.2 ONU receive-power thresholds (dBm), the same ones the api's `rx` filter uses. */
export const RX_WARNING = -25;
export const RX_CRITICAL = -27;

export type SignalLevel = 'good' | 'warning' | 'critical' | 'none';

/** good >= -25, warning -27..-25, critical < -27, none = no reading. */
export function rxLevel(rx: number | null | undefined): SignalLevel {
  if (rx === null || rx === undefined) return 'none';
  if (rx < RX_CRITICAL) return 'critical';
  if (rx < RX_WARNING) return 'warning';
  return 'good';
}
