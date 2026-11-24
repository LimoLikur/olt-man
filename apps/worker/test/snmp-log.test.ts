import { describe, expect, it } from 'vitest';
import { POLL_YIELDED, SLOW_SNMP_MS, snmpLogWorthy } from '../src/poller/context.js';

describe('snmpLogWorthy', () => {
  const entry = { olt: 'mock-1', op: 'optical' };

  it('logs failed operations, whatever their duration', () => {
    expect(snmpLogWorthy({ ...entry, ms: 12, error: 'SnmpTimeoutError', walks: [{ column: 'rxOnu', ms: 12, error: 'SnmpTimeoutError' }] })).toBe(true);
    expect(snmpLogWorthy({ ...entry, ms: 5, error: 'SnmpIncompleteError' })).toBe(true);
  });

  it('logs slow successful operations, not fast ones', () => {
    expect(snmpLogWorthy({ ...entry, ms: SLOW_SNMP_MS, rows: 48 })).toBe(true);
    expect(snmpLogWorthy({ ...entry, ms: SLOW_SNMP_MS - 1, rows: 48 })).toBe(false);
  });

  it('a cycle that gave way to an on-demand job is not a failure', () => {
    expect(snmpLogWorthy({ ...entry, ms: 4000, error: POLL_YIELDED })).toBe(false);
  });
});
