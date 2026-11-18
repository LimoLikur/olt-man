import type { OnuView } from '@olt/shared/dto';
import { describe, expect, it } from 'vitest';
import { phaseTotal, portStats, portTitle } from './pon';

const onu = (slot: number, port: number, phase: string | null, rxDbm: number | null): OnuView => ({
  id: 0,
  oltId: 1,
  oltName: 'mock-1',
  oltStatus: 'ok',
  slot,
  port,
  onuIndex: 1,
  name: null,
  description: null,
  sn: 'ZTEG00000001',
  type: null,
  phase,
  adminState: null,
  rxDbm,
  oltRxDbm: null,
  lastChangeAt: null,
  updatedAt: null,
});

describe('portStats', () => {
  const ports = portStats([
    onu(2, 1, 'working', -20),
    onu(1, 3, 'los', null),
    onu(1, 3, 'working', -26),
    onu(1, 3, 'dying_gasp', -18.5),
    onu(1, 1, 'offline', -28),
    onu(1, 1, 'syncing', null),
  ]);

  it('groups ONUs per port, sorted by slot then port', () => {
    expect(ports.map((p) => p.key)).toEqual(['1/1', '1/3', '2/1']);
    expect(ports[1]).toEqual({ key: '1/3', slot: 1, port: 3, total: 3, working: 1, los: 1, dyingGasp: 1, offline: 0, lowRx: 1, minRx: -26 });
  });

  it('counts phases outside the four named ones only in the total', () => {
    expect(ports[0]).toMatchObject({ total: 2, working: 0, los: 0, dyingGasp: 0, offline: 1, lowRx: 1, minRx: -28 });
  });

  it('sums a phase over the ports and counts the ports that have it', () => {
    expect(phaseTotal(ports, 'working')).toEqual({ onus: 2, ports: 2 });
    expect(phaseTotal(ports, 'los')).toEqual({ onus: 1, ports: 1 });
    expect(phaseTotal(ports, 'offline')).toEqual({ onus: 1, ports: 1 });
    expect(phaseTotal([], 'dyingGasp')).toEqual({ onus: 0, ports: 0 });
  });

  it('describes a port for the tile tooltip', () => {
    expect(portTitle(ports[1]!)).toBe('PON 1/1/3: 1/3 online · 1 LOS · 1 dying gasp · 0 offline · lowest Rx -26.00 dBm');
  });
});
