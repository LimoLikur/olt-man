import type { OnuView } from '@olt/shared/dto';
import { dbm } from './format';
import { rxLevel } from './signal';

/** ONU numbers of one PON port, counted from the OLT's ONU list (port state and capacity are not polled). */
export interface PortStats {
  /** "slot/port", e.g. "1/2". */
  key: string;
  slot: number;
  port: number;
  total: number;
  working: number;
  los: number;
  dyingGasp: number;
  offline: number;
  /** ONUs with Rx below the warning threshold (−25 dBm). */
  lowRx: number;
  minRx: number | null;
}

export type PhaseCount = 'working' | 'los' | 'dyingGasp' | 'offline';

/** One entry per port that has ONUs, sorted by slot and port. */
export function portStats(onus: readonly OnuView[]): PortStats[] {
  const ports = new Map<string, PortStats>();
  for (const o of onus) {
    const key = `${o.slot}/${o.port}`;
    let p = ports.get(key);
    if (!p) {
      p = { key, slot: o.slot, port: o.port, total: 0, working: 0, los: 0, dyingGasp: 0, offline: 0, lowRx: 0, minRx: null };
      ports.set(key, p);
    }
    p.total++;
    if (o.phase === 'working') p.working++;
    else if (o.phase === 'los') p.los++;
    else if (o.phase === 'dying_gasp') p.dyingGasp++;
    else if (o.phase === 'offline') p.offline++;
    const level = rxLevel(o.rxDbm);
    if (level === 'warning' || level === 'critical') p.lowRx++;
    if (o.rxDbm !== null) p.minRx = p.minRx === null ? o.rxDbm : Math.min(p.minRx, o.rxDbm);
  }
  return [...ports.values()].sort((a, b) => a.slot - b.slot || a.port - b.port);
}

/** ONUs in one phase over all ports, and how many ports have at least one of them. */
export function phaseTotal(ports: readonly PortStats[], phase: PhaseCount): { onus: number; ports: number } {
  return { onus: ports.reduce((n, p) => n + p[phase], 0), ports: ports.filter((p) => p[phase] > 0).length };
}

/** Tooltip of a port tile. */
export function portTitle(p: PortStats): string {
  return `PON 1/${p.key}: ${p.working}/${p.total} online · ${p.los} LOS · ${p.dyingGasp} dying gasp · ${p.offline} offline · lowest Rx ${dbm(p.minRx)}`;
}
