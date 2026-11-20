import { type AllowedCommand, findCliError, normalize } from '@olt/olt-spec';
import type { CliCredential } from '@olt/shared/crypto';
import { createHash } from 'node:crypto';
import ssh2, { type Algorithms, type AuthHandlerMiddleware, type ClientChannel, type NegotiatedAlgorithms } from 'ssh2';
import type { TargetGuard } from '../guards/target.guard.js';
import { connectCoalescing } from './coalescing-socket.js';
import { CliAuthError, CliError, CliNegotiationError, CliTimeoutError, CliUnavailableError, HostKeyMismatchError, WriteInReadSessionError } from './errors.js';

export interface OltCliTarget {
  name: string;
  ip: string;
  port?: number;
  credential: CliCredential;
  /** Pinned "SHA256:<base64>" fingerprints, at most 2 (active and standby control card). */
  hostKeyPins: string[];
}

export interface OltCliSessionOptions {
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
  maxOutputBytes?: number;
  /** Older firmware may need legacy kex/ciphers: olt.ssh_algorithms, see sshAlgorithms(). */
  algorithms?: Algorithms;
}

/** A prompt hostname: visible ASCII ("!" to "~") except "#" and the parentheses around the mode. */
const HOSTNAME = String.raw`(?:(?![#()])[!-~]){1,64}`;
/**
 * The CLI mode after the hostname, if any: (config), (config-if), (gpon-onu-mng 1/2/8:2).
 * A real C320 (V2.1) adds the ONU index in pon-onu-mng mode; the manual shows (gpon-onu-mng) only.
 */
const MODE = String.raw`(?:\([A-Za-z0-9_-]{1,32}(?: [0-9]{1,2}/[0-9]{1,2}/[0-9]{1,2}(?::[0-9]{1,3})?)?\))?`;

/**
 * The first prompt after login, whatever hostname the OLT has: ZXAN#, OLT-ZTE_C320#, OLT-DUD@JGL#,
 * ZXAN(config)#. Group 1 is the hostname; from then on the session waits for promptFor(hostname).
 */
export const LOGIN_PROMPT = new RegExp(String.raw`(?:^|\n)(${HOSTNAME})${MODE}#[ ]?$`);

/**
 * This OLT's prompt in any mode (OLT-DUD@JGL#, OLT-DUD@JGL(config-if)#): where a command's output
 * ends. Only the hostname read at login counts, so an output line that happens to end in "#" does not.
 */
export function promptFor(hostname: string): RegExp {
  const literal = hostname.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(String.raw`(?:^|\n)${literal}${MODE}#[ ]?$`);
}
const MORE = /--More--\s*$/;

/** ssh2's "Handshake failed: no matching ..." -> "no matching ..."; anything else -> undefined. */
export function negotiationFailure(err: Error & { level?: string }): string | undefined {
  if (err.level !== 'handshake') return undefined;
  return /^Handshake failed: (no matching [A-Za-z>-]+(?: [A-Za-z]+)*)$/.exec(err.message)?.[1];
}

/**
 * How long an SSH connection may take until the OLT has shown its host key and the handshake is
 * done. A C320 needs about 16 s for the group16 key exchange (ssh-algorithms.ts), so this is the
 * budget for CLI sessions and for the identity probe alike.
 */
export const SSH_HANDSHAKE_TIMEOUT_MS = 60_000;

export const fingerprint = (key: Buffer) => `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;

/**
 * One SSH CLI session per job (SPEC §8.3): open, run, close. The host key is compared with the
 * pins inside ssh2's hostVerifier, i.e. during the handshake, before credentials are sent
 * (CLAUDE.md rule 7). Read sessions refuse write commands before they reach the wire.
 */
export class OltCliSession {
  private client: ssh2.Client | undefined;
  private shell: ClientChannel | undefined;
  private buffer = '';
  /** This OLT's prompt, from the hostname in the first prompt after login (promptFor). */
  private prompt: RegExp | undefined;
  private onData: (() => void) | undefined;
  private mode: 'read' | 'write' = 'read';
  private closed = false;
  private readonly opts: Required<Omit<OltCliSessionOptions, 'algorithms'>> & Pick<OltCliSessionOptions, 'algorithms'>;
  /** Commands and outputs, for job.result. The authentication phase is never part of it. */
  readonly transcript: { command: string; output: string }[] = [];
  /** Algorithms agreed in the last key exchange (public names; for diagnostics and tests). */
  negotiated: NegotiatedAlgorithms | undefined;
  /**
   * ssh2's protocol trace plus the login steps, ms since open(); last 80 lines, credentials
   * replaced. Attached to CliUnavailableError so job.result shows how far a failed login got.
   */
  readonly trace: string[] = [];
  private openedAt = Date.now();

  constructor(
    private readonly target: OltCliTarget,
    private readonly guard: TargetGuard,
    options: OltCliSessionOptions = {},
  ) {
    if (target.hostKeyPins.length === 0 || target.hostKeyPins.length > 2) throw new Error('OltCliSession needs 1-2 pinned host keys');
    // 60 s: OpenSSH took up to ~23 s to reach the password prompt on a C320 (4096-bit group16-sha512, see ssh-algorithms.ts).
    this.opts = { connectTimeoutMs: SSH_HANDSHAKE_TIMEOUT_MS, commandTimeoutMs: 30_000, maxOutputBytes: 1024 * 1024, ...options };
  }

  async open(mode: 'read' | 'write'): Promise<void> {
    this.guard.assertAllowed(this.target.ip);
    this.mode = mode;
    this.openedAt = Date.now();
    const client = new ssh2.Client();
    this.client = client;
    let observedKey: string | undefined;
    let mismatch = false;
    // Where an abrupt drop happened: before key exchange finished, or during/after login.
    let stage = 'before handshake';
    // The negotiated algorithms (public names only) help compare with a client that does log in.
    client.once('handshake', (n) => {
      this.negotiated = n;
      stage = `during login (kex ${n.kex}, host key ${n.serverHostKey}, cipher ${n.cs.cipher}, mac ${n.cs.mac || 'aead'})`;
    });
    // Same order as OpenSSH: "none" first (the server answers with the methods it allows), then
    // password. ssh2 calls this after SERVICE_ACCEPT; `false` ends with a client-authentication error.
    const methods = ['none', 'password'] as const;
    let attempt = 0;
    const authHandler = (authsLeft: string[] | null) => {
      const method = methods[attempt++];
      this.note(`auth: ${method ?? 'no methods left'} (server allows: ${authsLeft?.join(',') || 'not asked yet'})`);
      return method ?? false;
    };
    const unavailable = (reason: string) => new CliUnavailableError(this.target.name, reason, undefined, [...this.trace]);

    await new Promise<void>((resolve, reject) => {
      const fail = (err: Error) => {
        client.end();
        reject(err);
      };
      client.once('ready', () => {
        this.note('auth: accepted');
        resolve();
      });
      client.once('error', (err: Error & { level?: string }) => {
        if (mismatch) return fail(new HostKeyMismatchError(this.target.name, observedKey ?? ''));
        if (err.level === 'client-authentication') return fail(new CliAuthError(this.target.name));
        const negotiation = negotiationFailure(err);
        if (negotiation) return fail(new CliNegotiationError(this.target.name, negotiation));
        if (err.level === 'client-timeout') return fail(unavailable(`connect timeout ${stage}`));
        fail(unavailable(`${(err as NodeJS.ErrnoException).code ?? err.name} ${stage}`));
      });
      client.once('close', () => fail(unavailable(`closed ${stage}`)));
      // Our own socket, connecting before ssh2 gets it (ssh2 then waits for 'connect'): each SSH
      // packet goes out with its MAC in one write, as with OpenSSH (coalescing-socket.ts).
      const port = this.target.port ?? 22;
      this.note(`tcp: connecting to ${this.target.ip}:${port} (packet and MAC in one write)`);
      const sock = connectCoalescing({ host: this.target.ip, port });
      client.connect({
        sock,
        username: this.target.credential.username,
        password: this.target.credential.password,
        readyTimeout: this.opts.connectTimeoutMs,
        tryKeyboard: false,
        // @types/ssh2 has no `false` for "no more methods"; ssh2 itself accepts a returned value.
        authHandler: authHandler as unknown as AuthHandlerMiddleware,
        debug: (line: string) => this.note(line),
        ...(this.opts.algorithms ? { algorithms: this.opts.algorithms } : {}),
        hostVerifier: (key: Buffer) => {
          observedKey = fingerprint(key);
          mismatch = !this.target.hostKeyPins.includes(observedKey);
          return !mismatch;
        },
      });
    });

    this.shell = await new Promise<ClientChannel>((resolve, reject) =>
      client.shell({ term: 'vt100', cols: 200, rows: 24 }, (err, stream) => (err ? reject(unavailable('no shell')) : resolve(stream))),
    );
    this.shell.on('data', (d: Buffer) => {
      this.buffer += d.toString('latin1');
      this.onData?.();
    });
    this.shell.on('close', () => {
      this.closed = true;
      this.onData?.();
    });
    // The prompt must appear; a session closed before it (VTY full) is "unavailable". The
    // hostname is read inside the check: more output may follow before this function resumes.
    let hostname = '';
    try {
      await this.until(
        () => {
          hostname = LOGIN_PROMPT.exec(this.buffer)?.[1] ?? '';
          return hostname !== '';
        },
        this.opts.connectTimeoutMs,
        'prompt',
      );
    } catch (e) {
      this.client.end();
      if (e instanceof CliUnavailableError || e instanceof CliTimeoutError)
        throw new CliUnavailableError(this.target.name, e instanceof CliTimeoutError ? 'no prompt' : 'closed before prompt', this.screenTail(), [...this.trace]);
      throw e;
    }
    this.prompt = promptFor(hostname);
  }

  async run(cmd: AllowedCommand, timeoutMs = this.opts.commandTimeoutMs): Promise<string> {
    if (cmd.kind === 'write' && this.mode !== 'write') throw new WriteInReadSessionError();
    const prompt = this.prompt;
    if (!this.shell || this.closed || !prompt) throw new CliUnavailableError(this.target.name, 'session not open');
    this.buffer = '';
    this.shell.write(`${cmd.text}\r`);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      await this.until(() => prompt.test(this.buffer) || MORE.test(this.buffer), deadline - Date.now(), cmd.text);
      if (this.buffer.length > this.opts.maxOutputBytes) throw new CliError(this.target.name, 'output exceeds limit');
      if (!MORE.test(this.buffer)) break;
      const before = this.buffer.length;
      this.shell.write(' ');
      await this.until(() => this.buffer.length > before, deadline - Date.now(), cmd.text);
    }
    const lines = normalize(this.buffer).split('\n');
    // Drop the echoed command (first line) and the trailing prompt.
    const output = lines.slice(lines[0]?.trim().endsWith(cmd.text) ? 1 : 0, prompt.test(lines.at(-1) ?? '') ? -1 : undefined).join('\n');
    this.transcript.push({ command: cmd.text, output });
    const error = findCliError(output);
    if (error) throw new CliError(this.target.name, error);
    return output;
  }

  /** Always call from finally. */
  async close(): Promise<void> {
    if (!this.client) return;
    try {
      if (this.shell && !this.closed) this.shell.write('exit\r');
    } finally {
      const client = this.client;
      this.client = undefined;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 1000);
        client.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
        client.end();
      });
    }
  }

  /** Adds one trace line with the credentials replaced (ssh2's debug lines carry none; this is a second guard). */
  private note(line: string): void {
    const { username, password } = this.target.credential;
    let clean = password ? line.split(password).join('***') : line;
    if (username) clean = clean.split(username).join('<user>');
    this.trace.push(`${Date.now() - this.openedAt}ms ${clean}`.slice(0, 300));
    if (this.trace.length > 80) this.trace.shift();
  }

  /** What the OLT printed so far, for diagnosing a missing prompt: printable text only, credentials replaced as in the trace. */
  private screenTail(): string {
    const { username, password } = this.target.credential;
    // eslint-disable-next-line no-control-regex -- strips ANSI escapes from OLT output
    let text = this.buffer.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/[^\x20-\x7e\n]/g, '');
    if (password) text = text.split(password).join('***');
    if (username) text = text.split(username).join('<user>');
    return text.slice(-400);
  }

  private until(test: () => boolean, ms: number, what: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (test()) return resolve();
      if (this.closed) return reject(new CliUnavailableError(this.target.name, 'session closed'));
      const timer = setTimeout(() => {
        this.onData = undefined;
        reject(new CliTimeoutError(this.target.name, what));
      }, Math.max(0, ms));
      this.onData = () => {
        if (test()) {
          clearTimeout(timer);
          this.onData = undefined;
          resolve();
        } else if (this.closed) {
          clearTimeout(timer);
          this.onData = undefined;
          reject(new CliUnavailableError(this.target.name, 'session closed'));
        }
      };
    });
  }
}
