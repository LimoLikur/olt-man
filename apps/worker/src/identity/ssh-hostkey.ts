import ssh2, { type Algorithms } from 'ssh2';
import { fingerprint, negotiationFailure, SSH_HANDSHAKE_TIMEOUT_MS } from '../cli/olt-cli.session.js';
import type { TargetGuard } from '../guards/target.guard.js';

export type HostKeyProbeResult = { ok: true; fingerprint: string; algo: string } | { ok: false; error: string };

/** Key type from an SSH public key blob (RFC 4253 §6.6: string "ssh-rsa", "ssh-ed25519", ...). */
export function keyType(blob: Buffer): string {
  if (blob.length < 4) return 'unknown';
  const len = blob.readUInt32BE(0);
  const type = blob.subarray(4, 4 + len).toString('latin1');
  return len > 0 && len <= 64 && type.length === len && /^[a-z0-9@.-]+$/.test(type) ? type : 'unknown';
}

/**
 * Reads the SSH host key fingerprint and drops the connection inside the handshake, before
 * any authentication: hostVerifier returns false, so no username or password is ever sent.
 * `algorithms` are the OLT's legacy algorithms; without a common algorithm the OLT never
 * shows its key, and the result says which negotiation step failed. The default timeout is the
 * CLI's handshake budget: a C320 shows its key only after a key exchange of about 16 s.
 */
export function probeSshHostKey(ip: string, port: number, guard: TargetGuard, opts: { timeoutMs?: number; algorithms?: Algorithms | undefined } = {}): Promise<HostKeyProbeResult> {
  guard.assertAllowed(ip);
  return new Promise((resolve) => {
    const client = new ssh2.Client();
    let result: HostKeyProbeResult = { ok: false, error: 'no_answer' };
    const done = () => {
      client.end();
      resolve(result);
    };
    client.on('error', (err: Error & { level?: string }) => {
      const negotiation = negotiationFailure(err);
      if (negotiation && !result.ok) result = { ok: false, error: `negotiation: ${negotiation}` };
      done();
    });
    client.on('close', done);
    client.connect({
      host: ip,
      port,
      username: 'identity-probe', // never used: the handshake is aborted first
      readyTimeout: opts.timeoutMs ?? SSH_HANDSHAKE_TIMEOUT_MS,
      tryKeyboard: false,
      ...(opts.algorithms ? { algorithms: opts.algorithms } : {}),
      hostVerifier: (key: Buffer) => {
        result = { ok: true, fingerprint: fingerprint(key), algo: keyType(key) };
        return false;
      },
    });
  });
}
