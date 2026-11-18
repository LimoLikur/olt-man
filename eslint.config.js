// @ts-check
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Hard rule 1 (CLAUDE.md): only apps/worker and apps/mock-olt may talk to an OLT.
const OLT_TRANSPORT_IMPORTS = [
  {
    group: ['net-snmp', 'net-snmp/*', 'ssh2', 'ssh2/*'],
    message: 'OLT access (net-snmp/ssh2) is only allowed in apps/worker and apps/mock-olt (CLAUDE.md hard rule 1).',
  },
];

// Hard rule 5: only the worker can decrypt OLT credentials.
const DECRYPTOR_IMPORTS = [
  {
    group: ['**/credential.decryptor', '**/credential.decryptor.*', 'worker', 'worker/*', '**/apps/worker/**'],
    message: 'apps/api must never import the credential decryptor or worker code (CLAUDE.md hard rule 5).',
  },
];

// openEnvelope is the decrypt half of the envelope; the api only ever seals.
const DECRYPT_PATHS = [
  { name: '@olt/shared/crypto', importNames: ['openEnvelope'], message: 'apps/api must never decrypt OLT credentials (CLAUDE.md rule 5).' },
];

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '**/*.d.ts', 'packages/db/src/generated/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-imports': ['error', { patterns: OLT_TRANSPORT_IMPORTS }],
    },
  },
  {
    files: ['apps/api/**'],
    rules: {
      'no-restricted-imports': ['error', { paths: DECRYPT_PATHS, patterns: [...OLT_TRANSPORT_IMPORTS, ...DECRYPTOR_IMPORTS] }],
    },
  },
  {
    files: ['apps/worker/**', 'apps/mock-olt/**'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    files: ['apps/ui/**'],
    languageOptions: { globals: { ...globals.browser } },
  },
);
