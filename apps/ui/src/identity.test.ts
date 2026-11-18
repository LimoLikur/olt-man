import { describe, expect, it } from 'vitest';
import { setTimeZone } from './format';
import { type ProbeJob, probeState, probeText } from './identity';

const now = Date.parse('2026-11-14T01:40:00Z');
const job = (status: string, result: ProbeJob['result'], updatedAt = '2026-11-14T01:39:30Z'): ProbeJob => ({ status, result, updatedAt });

describe('identity probe status', () => {
  it('tells a running probe from one that was cut off', () => {
    expect(probeState(null, now)).toBe('none');
    expect(probeState(job('running', null), now)).toBe('running');
    expect(probeState(job('confirmed', null), now)).toBe('running');
    expect(probeState(job('running', null, '2026-11-14T00:49:59Z'), now)).toBe('stalled');
    expect(probeState(job('failed', { errors: ['target_not_allowed'] }), now)).toBe('failed');
    expect(probeState(job('blocked', { error: 'identity_mismatch' }), now)).toBe('failed');
    expect(probeState(job('succeeded', { errors: [] }), now)).toBe('done');
  });

  it('explains the worker error codes and keeps unknown ones', () => {
    setTimeZone('UTC');
    expect(probeText(null, now)).toBe('No probe yet.');
    expect(probeText(job('succeeded', { errors: [] }), now)).toBe('Last probe: succeeded');
    expect(probeText(job('failed', { errors: ['target_not_allowed'] }), now)).toBe('Last probe: failed (the OLT address is outside the worker’s OLT_TARGET_CIDRS)');
    expect(probeText(job('failed', { errors: ['snmp:SnmpTimeoutError', 'ssh:negotiation: kex'] }), now)).toBe('Last probe: failed (SNMP: no answer (timeout); ssh:negotiation: kex)');
    expect(probeText(job('blocked', { error: 'identity_mismatch' }), now)).toBe('Last probe: blocked (the key differs from the pinned one)');
    expect(probeText(job('running', null, '2026-11-14T00:49:59Z'), now)).toBe('The last probe did not finish (started 00:49). Probe again.');
  });
});
