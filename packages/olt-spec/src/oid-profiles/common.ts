// Conversions shared by both ZTE C320 profiles; checked against recording olt-a (J3).
import type { OnuRef, PhaseState } from '../types.js';
import type { IndexArcs, OnuColumn } from './types.js';

/**
 * Plausible receive power. Rx in a passive optical network cannot exceed the OLT's Tx (class C+:
 * at most +7 dBm), and far below the receiver sensitivity there is no reading. A raw value outside
 * this range decodes to null, like no signal (olt-a 1/1/3:15 reports rxOnu 64432 = +98.9 dBm).
 */
export const RX_VALID_DBM = { min: -50, max: 10 } as const;
const clampDbm = (dbm: number) => Math.min(RX_VALID_DBM.max, Math.max(RX_VALID_DBM.min, dbm));
const plausible = (dbm: number) => (dbm >= RX_VALID_DBM.min && dbm <= RX_VALID_DBM.max ? dbm : null);

// rxOnu column: raw * 0.002 - 30 dBm, 65535 = no signal (olt-a 1/1/1:10: 7499 -> -15.002, CLI -15.001).
export const RX_NO_SIGNAL = 65535;
const RX_ONU_STEP = 0.002;
const RX_ONU_OFFSET = -30;

export function rxOnuDbm(raw: number): number | null {
  if (!Number.isInteger(raw) || raw < 0 || raw >= RX_NO_SIGNAL) return null;
  return plausible(Math.round((raw * RX_ONU_STEP + RX_ONU_OFFSET) * 1000) / 1000);
}

/** Inverse of rxOnuDbm, clamped to what both the column and RX_VALID_DBM allow: [-30, +10] dBm. */
export function rxOnuRaw(dbm: number | null): number {
  if (dbm === null || !Number.isFinite(dbm)) return RX_NO_SIGNAL;
  return Math.max(0, Math.round((clampDbm(dbm) - RX_ONU_OFFSET) / RX_ONU_STEP));
}

// rxOlt column: milli-dBm, -80000 = no signal (olt-a 1/1/1:10: -20767 -> -20.767, CLI -20.767).
export const RX_OLT_NO_SIGNAL = -80000;

export function rxOltDbm(raw: number): number | null {
  if (!Number.isInteger(raw) || raw === RX_OLT_NO_SIGNAL) return null;
  return plausible(raw / 1000);
}

/** Inverse of rxOltDbm, clamped to RX_VALID_DBM. */
export function rxOltRaw(dbm: number | null): number {
  if (dbm === null || !Number.isFinite(dbm)) return RX_OLT_NO_SIGNAL;
  return Math.round(clampDbm(dbm) * 1000);
}

/** Raw value a profile emits (mock) for a phase never observed on a real OLT; it decodes as unknown. */
export const PHASE_RAW_UNOBSERVED = 0;

/**
 * Phase codec from a raw -> state table that lists only values observed on a real OLT.
 * Any other raw decodes to 'unknown' rather than to a guess.
 */
export function phaseCodec(byRaw: Readonly<Record<number, PhaseState>>) {
  const byState = new Map(Object.entries(byRaw).map(([raw, state]) => [state, Number(raw)]));
  return {
    phaseState: (raw: number): PhaseState => byRaw[raw] ?? 'unknown',
    phaseRaw: (state: PhaseState): number => byState.get(state) ?? PHASE_RAW_UNOBSERVED,
  };
}

export const adminStateRaw = (enabled: boolean): number => (enabled ? 1 : 2);
export const adminEnabled = (raw: number): boolean => raw === 1;

/** GPON SN "ZTEGC1192DD7" = 4 ASCII vendor bytes + 4 binary bytes (8 hex digits). */
export function encodeSerial(sn: string): Uint8Array {
  const m = /^([A-Za-z0-9]{4})([0-9A-Fa-f]{8})$/.exec(sn);
  if (!m) throw new RangeError('serial number must be 4 vendor chars + 8 hex digits');
  const out = new Uint8Array(8);
  for (let i = 0; i < 4; i++) out[i] = m[1]!.charCodeAt(i);
  for (let i = 0; i < 4; i++) out[4 + i] = Number.parseInt(m[2]!.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function decodeSerial(raw: Uint8Array): string {
  if (raw.length !== 8) throw new RangeError('serial number must be 8 bytes');
  const vendor = String.fromCharCode(...raw.subarray(0, 4));
  const id = [...raw.subarray(4)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return (vendor + id).toUpperCase();
}

export function assertOnuRef({ slot, port, onuId }: OnuRef): void {
  const ok =
    Number.isInteger(slot) && slot >= 1 && slot <= 255 &&
    Number.isInteger(port) && port >= 1 && port <= 255 &&
    Number.isInteger(onuId) && onuId >= 1 && onuId <= 128;
  if (!ok) throw new RangeError('invalid ONU reference');
}

export const arcsOf = (arcs: IndexArcs, column?: OnuColumn): readonly number[] => (column ? (arcs[column] ?? []) : []);

/** Splits `[ponIfIndex, onuId, ...extra]`; the extra arcs must be exactly `extra`. */
export function suffixPair(suffix: readonly number[], extra: readonly number[] = []): [number, number] {
  const ok =
    suffix.length === 2 + extra.length &&
    suffix.slice(0, 2).every((n) => Number.isInteger(n) && n >= 0) &&
    extra.every((arc, i) => suffix[2 + i] === arc);
  if (!ok) throw new RangeError(`ONU index suffix must be [ponIfIndex, onuId${extra.map((a) => `, ${a}`).join('')}]`);
  return [suffix[0]!, suffix[1]!];
}
