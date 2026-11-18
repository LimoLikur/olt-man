// Test support (api F3): opens a credential blob with the worker's decryptor, so api tests can
// check the envelope contract without importing worker code (forbidden by lint in apps/api).
// Usage: decrypt <privateKeyFile> <oltName> <snmp|cli>  (blob as hex on stdin; FAKE mock creds only)
import { readFileSync } from 'node:fs';
import { CredentialDecryptor } from '../../src/crypto/credential.decryptor.js';

const [keyFile, oltName, field] = process.argv.slice(2);
const blob = Buffer.from(readFileSync(0, 'utf8').trim(), 'hex');
const d = CredentialDecryptor.fromFile(keyFile!);
process.stdout.write(JSON.stringify(field === 'cli' ? d.cli(oltName!, blob) : d.snmp(oltName!, blob)));
