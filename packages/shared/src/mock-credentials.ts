import type { CliCredential, SnmpCredential } from './crypto/credentials.js'; // type-only: no node:crypto

// FAKE credentials of the mock OLTs (CLAUDE.md rule 5 exception). Single source for the mock
// itself (apps/mock-olt) and for seed-mock (packages/db). Never valid on a real OLT.
export const MOCK_SNMP_V3: Extract<SnmpCredential, { version: 'v3' }> = {
  version: 'v3',
  user: 'mockuser',
  authProtocol: 'sha',
  authKey: 'mock-auth-key-fake-0001',
  privProtocol: 'aes',
  privKey: 'mock-priv-key-fake-0001',
};
/** Same fake keys, DES privacy: the mock also serves this user (firmware without AES). */
export const MOCK_SNMP_V3_DES: Extract<SnmpCredential, { version: 'v3' }> = { ...MOCK_SNMP_V3, user: 'mockuser-des', privProtocol: 'des' };
export const MOCK_SNMP_COMMUNITY = 'mock-community-fake';
export const MOCK_CLI: CliCredential = { username: 'mockadmin', password: 'mock-ssh-password-fake' };

/** Mock instances on oltnet (compose.yaml) with their fixed initial engine IDs. */
export const MOCK_OLTS = [
  { name: 'mock-1', ip: '172.30.0.11', engineId: '80000f3e05a1a1a1a1a1a1', oidProfile: 'zte-c320-v2.1' },
  { name: 'mock-2', ip: '172.30.0.12', engineId: '80000f3e05a2a2a2a2a2a2', oidProfile: 'zte-c320-v2.2' },
  { name: 'mock-3', ip: '172.30.0.13', engineId: '80000f3e05a3a3a3a3a3a3', oidProfile: 'zte-c320-v2.1' },
] as const;
