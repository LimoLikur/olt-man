import swc from 'unplugin-swc';
import { defineProject, type UserWorkspaceConfig } from 'vitest/config';

interface ProjectOptions {
  name: string;
  /** NestJS packages need SWC so decorator metadata is emitted (esbuild does not). */
  decorators?: boolean;
  environment?: 'node' | 'jsdom';
  /**
   * Start test processes with --openssl-legacy-provider, as the worker and mock-olt run in
   * production: OpenSSL 3 only offers DES-CBC (SNMPv3 "des56" privacy) through it.
   */
  openSslLegacy?: boolean;
}

const UNIT = ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'];
const INT = ['src/**/*.int.test.{ts,tsx}', 'test/**/*.int.test.{ts,tsx}'];

/** `vitest run` runs unit tests; `vitest run --mode int` runs *.int.test.ts. */
export function project({ name, decorators = false, environment = 'node', openSslLegacy = false }: ProjectOptions) {
  return defineProject(({ mode }): UserWorkspaceConfig => {
    const integration = mode === 'int';
    return {
      plugins: decorators
        ? [swc.vite({ jsc: { parser: { syntax: 'typescript', decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true } } })]
        : [],
      resolve: { conditions: ['source'] },
      ssr: { resolve: { conditions: ['source'], externalConditions: ['source'] } },
      test: {
        name,
        environment,
        include: integration ? INT : UNIT,
        exclude: integration ? [] : INT,
        testTimeout: integration ? 60_000 : 5_000,
        ...(openSslLegacy ? { pool: 'forks' as const, execArgv: ['--openssl-legacy-provider'] } : {}),
      },
    };
  });
}
