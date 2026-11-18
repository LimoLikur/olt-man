export const PHASE_STATES = ['working', 'los', 'dying_gasp', 'offline', 'syncing', 'auth_failed', 'unknown'] as const;
export type PhaseState = (typeof PHASE_STATES)[number];

/** Rack and shelf are always 1 on a C320, so an ONU is addressed by slot/port:onuId. */
export interface OnuRef {
  slot: number;
  port: number;
  onuId: number;
}

export interface PonRef {
  slot: number;
  port: number;
}

export const C320_LIMITS = { slotMin: 1, slotMax: 22, portMax: 16, onuIdMax: 128 } as const;
