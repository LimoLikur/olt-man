import { ESLint } from 'eslint';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: fileURLToPath(new URL('..', import.meta.url)) });

async function restrictedImportErrors(code: string, filePath: string): Promise<number> {
  const [result] = await eslint.lintText(code, { filePath });
  return result!.messages.filter((m) => m.ruleId === 'no-restricted-imports' && m.severity === 2).length;
}

describe('hard rule 1: OLT transports only in worker and mock-olt', () => {
  it.each([
    ["import 'ssh2';", 'apps/api/src/x.ts'],
    ["import { Client } from 'ssh2';", 'apps/api/src/x.ts'],
    ["import snmp from 'net-snmp';", 'apps/api/src/x.ts'],
    ["import 'ssh2';", 'packages/olt-spec/src/x.ts'],
    ["import 'net-snmp';", 'apps/ui/src/x.ts'],
  ])('rejects %s in %s', async (code, file) => {
    expect(await restrictedImportErrors(code, file)).toBe(1);
  });

  it.each([
    ["import 'ssh2';", 'apps/worker/src/x.ts'],
    ["import 'net-snmp';", 'apps/mock-olt/src/x.ts'],
  ])('allows %s in %s', async (code, file) => {
    expect(await restrictedImportErrors(code, file)).toBe(0);
  });
});

describe('hard rule 5: api cannot import the decryptor', () => {
  it.each([
    "import { CredentialDecryptor } from '../../worker/src/crypto/credential.decryptor';",
    "import { CredentialDecryptor } from 'worker/src/crypto/credential.decryptor.js';",
  ])('rejects %s', async (code) => {
    expect(await restrictedImportErrors(code, 'apps/api/src/olts/x.ts')).toBe(1);
  });

  it('rejects openEnvelope but allows sealEnvelope', async () => {
    expect(await restrictedImportErrors("import { openEnvelope } from '@olt/shared/crypto';", 'apps/api/src/x.ts')).toBe(1);
    expect(await restrictedImportErrors("import { sealEnvelope } from '@olt/shared/crypto';", 'apps/api/src/x.ts')).toBe(0);
    expect(await restrictedImportErrors("import { openEnvelope } from '@olt/shared/crypto';", 'apps/worker/src/x.ts')).toBe(0);
  });

  it('allows the encryptor', async () => {
    expect(await restrictedImportErrors("import './crypto/credential.encryptor';", 'apps/api/src/x.ts')).toBe(0);
  });
});
