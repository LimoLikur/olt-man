// Generates the credential key pair (RSA-3072). Run where the worker runs (the VPS), so the
// private key never travels. Usage: pnpm keys:generate [outDir=./secrets]
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'secrets');
const privatePath = join(dir, 'olt-cred.key');
const publicPath = join(dir, 'olt-cred.pub');

if (existsSync(privatePath)) {
  console.error(`${privatePath} already exists; refusing to overwrite (existing credentials depend on it)`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true, mode: 0o700 });
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
writeFileSync(privatePath, privateKey, { mode: 0o600, flag: 'wx' });
writeFileSync(publicPath, publicKey, { mode: 0o644, flag: 'wx' });
console.log(`private key: ${privatePath} (worker secret only)\npublic key:  ${publicPath} (OLT_CRED_PUBLIC_KEY for api)`);
