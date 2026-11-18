import { CONTROL_CHARS, type OidProfile, type OnuColumn, type OnuRef, type PhaseState, SYSTEM_OIDS } from '@olt/olt-spec';
import type { SnmpCredential } from '@olt/shared/crypto';
import snmp from 'net-snmp';
import type { TargetGuard } from '../guards/target.guard.js';
import { SnmpAuthError, SnmpError, SnmpIncompleteError, SnmpTimeoutError } from './errors.js';

export interface OltSnmpTarget {
  name: string;
  ip: string;
  port?: number;
  profile: OidProfile;
  credential: SnmpCredential;
}

export interface SnmpIdentity {
  sysName: string;
  sysObjectId: string;
  sysDescr: string;
  /** Lower-case hex; v3 only. */
  engineId?: string;
}

export interface OnuStatusRow extends OnuRef {
  phase: PhaseState;
  adminEnabled: boolean;
  omccEnabled: boolean;
}

export interface OnuOpticalRow extends OnuRef {
  /** dBm, null = no signal or an implausible reading (outside RX_VALID_DBM). */
  rxOnuDbm: number | null;
  rxOltDbm: number | null;
  name: string | null;
  description: string | null;
  sn: string | null;
  type: string | null;
}

export interface SnmpLogEntry {
  olt: string;
  op: string;
  ms: number;
  rows?: number;
  error?: string;
}

/** Per-call options of the table reads. */
export interface TableReadOptions {
  /**
   * Awaited before each column walk; it may throw to abandon the read between two columns (the
   * worker gives way to a waiting on-demand job this way). A table still counts only when complete.
   */
  checkpoint?: () => Promise<void>;
}

export interface OltSnmpClientOptions {
  timeoutMs?: number;
  retries?: number;
  maxRepetitions?: number;
  /** Receives one entry per operation: no credentials, no values. */
  log?: (entry: SnmpLogEntry) => void;
}

type Varbind = snmp.Varbind;

const AUTH_CODES = new Set([snmp.ResponseInvalidCode.EAuthFailure]);
const RequestTimedOutError = (snmp as unknown as { RequestTimedOutError: new () => { readonly __timedOut: unique symbol } }).RequestTimedOutError;

/**
 * SNMP access to one OLT (SPEC §6.1, §8.1): v3 authPriv or v2c, GETBULK with 20 repetitions,
 * 3 s timeout and 1 retry. The target guard is checked before any socket exists; timeouts and
 * authentication failures are distinct errors; a table counts only when it is complete.
 */
export class OltSnmpClient {
  private readonly session: snmp.Session;
  private readonly opts: Required<Omit<OltSnmpClientOptions, 'log'>> & Pick<OltSnmpClientOptions, 'log'>;

  constructor(
    private readonly target: OltSnmpTarget,
    guard: TargetGuard,
    options: OltSnmpClientOptions = {},
  ) {
    guard.assertAllowed(target.ip);
    this.opts = { timeoutMs: 3000, retries: 1, maxRepetitions: 20, ...options };
    const common = { port: target.port ?? 161, timeout: this.opts.timeoutMs, retries: this.opts.retries, idBitsSize: 32 as const };
    const c = target.credential;
    this.session =
      c.version === 'v3'
        ? snmp.createV3Session(
            target.ip,
            {
              name: c.user,
              level: snmp.SecurityLevel.authPriv,
              authProtocol: snmp.AuthProtocols[c.authProtocol],
              authKey: c.authKey,
              privProtocol: snmp.PrivProtocols[c.privProtocol],
              privKey: c.privKey,
            },
            common,
          )
        : snmp.createSession(target.ip, c.community, { ...common, version: snmp.Version2c });
    this.session.on('error', () => undefined);
  }

  get version(): 'v3' | 'v2c' {
    return this.target.credential.version;
  }

  async identity(): Promise<SnmpIdentity> {
    const oids: string[] = [SYSTEM_OIDS.sysName, SYSTEM_OIDS.sysObjectID, SYSTEM_OIDS.sysDescr];
    if (this.version === 'v3') oids.push(SYSTEM_OIDS.snmpEngineID);
    const vbs = await this.timed('identity', () => this.get(oids));
    const value = (i: number) => {
      const vb = vbs[i];
      if (!vb || snmp.isVarbindError(vb)) throw new SnmpError(this.target.name, `missing ${oids[i]}`);
      return vb.value;
    };
    return {
      sysName: printable(String(value(0))),
      sysObjectId: String(value(1)),
      sysDescr: printable(String(value(2))),
      ...(this.version === 'v3' ? { engineId: Buffer.from(value(3) as Buffer).toString('hex') } : {}),
    };
  }

  async onuStatus(opts: TableReadOptions = {}): Promise<OnuStatusRow[]> {
    const p = this.target.profile;
    const [phase, admin, omcc] = await this.timed('status', () => this.columns(['phaseState', 'adminState', 'omccState'], opts.checkpoint));
    return [...phase!].map(([suffix, raw]) => ({
      ...this.decode(suffix),
      phase: p.phaseState(raw as number),
      adminEnabled: p.adminEnabled(admin!.get(suffix) as number),
      omccEnabled: omcc!.get(suffix) === 1,
    }));
  }

  async onuOptical(opts: TableReadOptions = {}): Promise<OnuOpticalRow[]> {
    const p = this.target.profile;
    const [rxOnu, rxOlt, name, description, sn, type] = await this.timed('optical', () =>
      this.columns(['rxOnu', 'rxOlt', 'name', 'description', 'serialNumber', 'type'], opts.checkpoint),
    );
    return [...rxOnu!].map(([suffix, raw]) => {
      const serial = sn!.get(suffix);
      return {
        ...this.decode(suffix),
        rxOnuDbm: p.rxOnuDbm(raw as number),
        rxOltDbm: p.rxOltDbm(rxOlt!.get(suffix) as number),
        name: text(name!.get(suffix)),
        description: text(description!.get(suffix)),
        sn: Buffer.isBuffer(serial) ? decodeSerialOrNull(p, serial) : null,
        type: text(type!.get(suffix)),
      };
    });
  }

  close(): void {
    try {
      this.session.close();
    } catch {
      // already closed
    }
  }

  private decode(suffix: string, column?: OnuColumn): OnuRef {
    try {
      return this.target.profile.decodeOnuIndex(suffix.split('.').map(Number), column);
    } catch {
      throw new SnmpIncompleteError(this.target.name, `undecodable ${column ?? 'ONU'} index ${suffix}`);
    }
  }

  /**
   * Walks several ONU columns; all must have exactly the same row set. Rows are keyed by the plain
   * ONU index, without column-specific arcs (rxOnu is ponIfIndex.onuId.1, rxOlt ponIfIndex.onuId).
   * `checkpoint` runs before each column, never during one.
   */
  private async columns(names: OnuColumn[], checkpoint?: () => Promise<void>): Promise<Map<string, unknown>[]> {
    const p = this.target.profile;
    const out: Map<string, unknown>[] = [];
    for (const name of names) {
      await checkpoint?.();
      const rows = new Map<string, unknown>();
      for (const [suffix, value] of await this.walk(p.columns[name])) rows.set(p.encodeOnuIndex(this.decode(suffix, name)).join('.'), value);
      out.push(rows);
    }
    const keys = [...out[0]!.keys()].sort().join(',');
    out.forEach((col, i) => {
      if ([...col.keys()].sort().join(',') !== keys) throw new SnmpIncompleteError(this.target.name, `column ${names[i]} has ${col.size} rows, expected ${out[0]!.size}`);
    });
    return out;
  }

  private walk(oid: string): Promise<Map<string, unknown>> {
    return new Promise((resolve, reject) => {
      const rows = new Map<string, unknown>();
      this.session.subtree(
        oid,
        this.opts.maxRepetitions,
        (varbinds: Varbind[]) => {
          for (const vb of varbinds) if (!snmp.isVarbindError(vb)) rows.set(vb.oid.slice(oid.length + 1), vb.value);
        },
        (error: Error | null) => (error ? reject(this.translate(error)) : resolve(rows)),
      );
    });
  }

  private get(oids: string[]): Promise<Varbind[]> {
    return new Promise((resolve, reject) =>
      this.session.get(oids, (error, varbinds) => (error ? reject(this.translate(error)) : resolve(varbinds ?? []))),
    );
  }

  private translate(error: Error): Error {
    if (error instanceof RequestTimedOutError) return new SnmpTimeoutError(this.target.name);
    const code = (error as Error & { code?: number }).code;
    if (error.name === 'ResponseInvalidError' && code !== undefined && AUTH_CODES.has(code)) return new SnmpAuthError(this.target.name);
    return new SnmpError(this.target.name, error.name);
  }

  private async timed<T>(op: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.opts.log?.({ olt: this.target.name, op, ms: Date.now() - start, ...(Array.isArray(result) ? { rows: result.length } : {}) });
      return result;
    } catch (error) {
      this.opts.log?.({ olt: this.target.name, op, ms: Date.now() - start, error: (error as Error).name });
      throw error;
    }
  }
}

function decodeSerialOrNull(p: OidProfile, raw: Buffer): string | null {
  try {
    return p.decodeSerial(raw);
  } catch {
    return null;
  }
}

const printable = (s: string) => s.replace(new RegExp(CONTROL_CHARS.source, 'g'), '').slice(0, 256);

function text(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = Buffer.isBuffer(v) ? v.toString('latin1') : String(v);
  return CONTROL_CHARS.test(s) ? null : s.slice(0, 128);
}
