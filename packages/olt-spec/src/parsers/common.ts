import type { PhaseState } from '../types.js';

export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export const ONU_IFACE = /gpon-onu_1\/(\d{1,2})\/(\d{1,2}):(\d{1,3})/;
export const PON_IFACE = /gpon-olt_1\/(\d{1,2})\/(\d{1,2})/;

export function onuRefFrom(m: RegExpExecArray | null): { slot: number; port: number; onuId: number } | null {
  return m ? { slot: Number(m[1]), port: Number(m[2]), onuId: Number(m[3]) } : null;
}

const PHASES: Record<string, PhaseState> = {
  working: 'working',
  los: 'los',
  dyinggasp: 'dying_gasp',
  offline: 'offline',
  syncmib: 'syncing',
  logging: 'syncing',
  authfailed: 'auth_failed',
};

/** CLI phase label -> PhaseState; unrecognised labels map to 'unknown'. */
export const phaseFromLabel = (label: string): PhaseState => PHASES[label.toLowerCase()] ?? 'unknown';

/** "-20.850(dbm)" / "23.718(dB)" -> number; "no signal" / "N/A" -> null. */
export function powerValue(raw: string): number | null {
  const m = /^(-?\d+(?:\.\d+)?)\s*\(d[bB]m?\)$/.exec(raw.trim());
  return m ? Number(m[1]) : null;
}

/** "10h 42m 07s" (optionally "3d 10h ...") -> seconds. */
export function durationSeconds(raw: string): number | null {
  const m = /^(?:(\d+)d\s*)?(\d+)h\s*(\d+)m\s*(\d+)s$/.exec(raw.trim());
  if (!m) return null;
  return Number(m[1] ?? 0) * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}
