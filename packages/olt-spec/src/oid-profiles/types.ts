import type { OnuRef, PhaseState } from '../types.js';

export type OidProfileId = 'zte-c320-v2.1' | 'zte-c320-v2.2';

/** Per-ONU table columns. Instance OID = `${columns[c]}.${encodeOnuIndex(ref, c).join('.')}`. */
export interface OnuColumns {
  name: string;
  description: string;
  type: string;
  serialNumber: string;
  adminState: string;
  omccState: string;
  phaseState: string;
  /** Rx power measured at the ONU (downstream). */
  rxOnu: string;
  /** Rx power of this ONU measured at the OLT PON port (upstream). */
  rxOlt: string;
}

export type OnuColumn = keyof OnuColumns;

/** Index arcs a column's table has after `ponIfIndex.onuId`; most columns have none. */
export type IndexArcs = Readonly<Partial<Record<OnuColumn, readonly number[]>>>;

export interface OidProfile {
  id: OidProfileId;
  /** true only after the golden test against a real recording passes (J3). */
  verified: boolean;
  /** Enterprise subtree for this firmware family, e.g. 1.3.6.1.4.1.3902.1012. */
  base: string;
  columns: OnuColumns;
  indexArcs: IndexArcs;
  /** `[ponIfIndex, onuId]`, plus the extra arcs of `column` when given. */
  encodeOnuIndex(ref: OnuRef, column?: OnuColumn): number[];
  /** Inverse of encodeOnuIndex; RangeError when the suffix does not fit (`column`'s arcs included). */
  decodeOnuIndex(suffix: readonly number[], column?: OnuColumn): OnuRef;
  phaseState(raw: number): PhaseState;
  phaseRaw(state: PhaseState): number;
  adminStateRaw(enabled: boolean): number;
  adminEnabled(raw: number): boolean;
  /** rxOnu column: raw * 0.002 - 30 dBm; 65535 = no signal; implausible (RX_VALID_DBM) = null. */
  rxOnuDbm(raw: number): number | null;
  rxOnuRaw(dbm: number | null): number;
  /** rxOlt column: milli-dBm; -80000 = no signal; implausible (RX_VALID_DBM) = null. */
  rxOltDbm(raw: number): number | null;
  rxOltRaw(dbm: number | null): number;
  encodeSerial(sn: string): Uint8Array;
  decodeSerial(raw: Uint8Array): string;
}
