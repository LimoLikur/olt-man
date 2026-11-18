import { MOCK_OLTS } from '@olt/shared';
import { describe, expect, it } from 'vitest';
import { TargetGuard, TargetNotAllowedError } from '../src/guards/target.guard.js';

// Dev/test configuration: only the mock network (compose oltnet) is reachable.
const guard = new TargetGuard(['172.30.0.0/24'], ['172.30.0.0/24']);

describe('TargetGuard (OLT_TARGET_CIDRS)', () => {
  it('rejects 10.0.0.1', () => {
    expect(guard.isAllowed('10.0.0.1')).toBe(false);
    expect(() => guard.assertAllowed('10.0.0.1')).toThrow(TargetNotAllowedError);
  });

  it.each(MOCK_OLTS.map((m) => m.ip))('accepts mock IP %s', (ip) => {
    expect(() => guard.assertAllowed(ip)).not.toThrow();
    expect(guard.isMockNetwork(ip)).toBe(true);
  });

  it.each(['172.30.1.1', '127.0.0.1', '0.0.0.0', '::1', 'mock-olt-1', 'localhost', '172.30.0.11 ', '172.30.0.011', ''])('rejects %j', (target) => {
    expect(guard.isAllowed(target)).toBe(false);
  });

  it('a real OLT allowed for polling is still not a mock (write guard 2)', () => {
    const vps = new TargetGuard(['172.30.0.0/24', '10.20.0.5/32'], ['172.30.0.0/24']);
    expect(vps.isAllowed('10.20.0.5')).toBe(true);
    expect(vps.isMockNetwork('10.20.0.5')).toBe(false);
    expect(vps.isAllowed('10.20.0.6')).toBe(false);
  });

  it('supports IPv6 and refuses an empty allowlist', () => {
    expect(new TargetGuard(['fd00:30::/64'], []).isAllowed('fd00:30::11')).toBe(true);
    expect(() => new TargetGuard([], [])).toThrow();
  });
});
