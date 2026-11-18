import { constants, createCipheriv, createDecipheriv, createPublicKey, type KeyObject, privateDecrypt, publicEncrypt, randomBytes } from 'node:crypto';

// Envelope encryption for OLT credentials (SPEC §2.2 no. 1, CLAUDE.md rule 5):
// a fresh AES-256-GCM data key per record, wrapped with the worker's RSA public key
// (RSA-OAEP, SHA-256). The api holds only the public key, so it can seal but never open.
//
// Blob layout (version 1):
//   [0]       version = 1
//   [1..2]    wrapped key length N (uint16 BE)
//   [3..3+N)  RSA-OAEP-SHA256(data key)
//   next 12   GCM IV
//   next 16   GCM tag
//   rest      ciphertext
// The AAD binds a blob to its context (e.g. "olt:mock-1:snmp"), so ciphertexts cannot be
// swapped between OLTs or fields.

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const OAEP = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' } as const;

export class EnvelopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnvelopeError';
  }
}

export function sealEnvelope(publicKey: string | KeyObject, plaintext: Buffer, aad: string): Buffer {
  const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey;
  if (key.asymmetricKeyType !== 'rsa' || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) {
    throw new EnvelopeError('public key must be RSA >= 3072 bits');
  }
  const dataKey = randomBytes(32);
  const iv = randomBytes(IV_BYTES);
  try {
    const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const wrapped = publicEncrypt({ key, ...OAEP }, dataKey);
    const header = Buffer.alloc(3);
    header.writeUInt8(VERSION, 0);
    header.writeUInt16BE(wrapped.length, 1);
    return Buffer.concat([header, wrapped, iv, cipher.getAuthTag(), ciphertext]);
  } finally {
    dataKey.fill(0);
  }
}

/** Worker only (ESLint forbids this import in apps/api). Throws EnvelopeError on any tampering. */
export function openEnvelope(privateKey: KeyObject, blob: Buffer, aad: string): Buffer {
  if (blob.length < 3 || blob.readUInt8(0) !== VERSION) throw new EnvelopeError('unknown envelope version');
  const n = blob.readUInt16BE(1);
  const ivAt = 3 + n;
  const tagAt = ivAt + IV_BYTES;
  const dataAt = tagAt + TAG_BYTES;
  if (blob.length < dataAt) throw new EnvelopeError('truncated envelope');
  let dataKey: Buffer | undefined;
  try {
    dataKey = privateDecrypt({ key: privateKey, ...OAEP }, blob.subarray(3, ivAt));
    const decipher = createDecipheriv('aes-256-gcm', dataKey, blob.subarray(ivAt, tagAt));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(blob.subarray(tagAt, dataAt));
    return Buffer.concat([decipher.update(blob.subarray(dataAt)), decipher.final()]);
  } catch {
    // Never surface crypto details (or partial plaintext).
    throw new EnvelopeError('envelope authentication failed');
  } finally {
    dataKey?.fill(0);
  }
}
