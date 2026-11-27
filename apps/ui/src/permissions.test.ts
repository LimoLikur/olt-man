import { describe, expect, it } from 'vitest';
import { can } from './permissions';

describe('can (SPEC §8.6)', () => {
  it('lets every role view and only NOC/admin acknowledge alarms', () => {
    expect(can('teknisi', 'viewNetwork')).toBe(true);
    expect(can('teknisi', 'acknowledgeAlarm')).toBe(false);
    expect(can('noc', 'acknowledgeAlarm')).toBe(true);
  });

  it('splits Fase 2 between composing (admin, teknisi) and approving (admin, NOC)', () => {
    expect(can('noc', 'composeRegistration')).toBe(false);
    expect(can('teknisi', 'composeRegistration')).toBe(true);
    expect(can('teknisi', 'approveRegistration')).toBe(false);
    expect(can('noc', 'approveRegistration')).toBe(true);
  });

  it('lets every role reboot ONUs (owner decision 2026-11-27)', () => {
    for (const role of ['admin', 'noc', 'teknisi'] as const) expect(can(role, 'rebootOnu')).toBe(true);
  });

  it('keeps users, credentials and write for admins', () => {
    for (const p of ['manageUsers', 'adminOlts', 'runJobs'] as const) {
      expect(can('admin', p)).toBe(true);
      expect(can('noc', p)).toBe(false);
      expect(can('teknisi', p)).toBe(false);
    }
    expect(can(null, 'viewNetwork')).toBe(false);
  });
});
