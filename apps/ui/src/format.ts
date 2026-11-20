let timeZone = 'Asia/Jakarta';
export const setTimeZone = (tz: string) => (timeZone = tz);

const LOCALE = 'en-GB';

const fmt = (opts: Intl.DateTimeFormatOptions) => (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat(LOCALE, { timeZone, hourCycle: 'h23', ...opts }).format(new Date(iso)) : '—';

export const time = fmt({ hour: '2-digit', minute: '2-digit' });
export const dateTime = fmt({ day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const shortDateTime = fmt({ day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const day = fmt({ day: '2-digit', month: 'short' });

/** Shown for data the system does not collect or expose (the design keeps the slot). */
export const NA = 'N/A';

export const dbm = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(2)} dBm`);

/** Age of the last successful poll, from OltSummary.dataAgeS. */
export function age(seconds: number | null): string {
  if (seconds === null) return 'never';
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  return `${Math.floor(seconds / 3600)} h`;
}

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "5 minutes ago", "in 2 hours", "just now". */
export function ago(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const s = Math.round((new Date(iso).getTime() - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return 'just now';
  if (abs < 3600) return relative.format(Math.round(s / 60), 'minute');
  if (abs < 86_400) return relative.format(Math.round(s / 3600), 'hour');
  return relative.format(Math.round(s / 86_400), 'day');
}

/** Duration in seconds as "3d 4h", "2h 5m", "45s". */
export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

/** Share of `part` in `total` as "12.5%"; "—" when there is nothing to divide. */
/** "1 OLT", "3 OLTs", "1,204 ONUs". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

export function pct(part: number, total: number, digits = 0): string {
  if (!total) return '—';
  return `${((part / total) * 100).toFixed(digits)}%`;
}

export const initials = (name: string) => {
  const words = name.split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '?').slice(0, 2);
  return letters.slice(0, 2).toUpperCase();
};

/** "zte-c320-v2.1" -> "C320 V2.1" (the only supported model is the ZTE C320). */
export function oidProfileLabel(profile: string): string {
  const m = /^zte-(c\d+)-v([\d.]+)$/i.exec(profile);
  return m ? `${m[1]!.toUpperCase()} V${m[2]}` : profile;
}

export const PHASE_LABEL: Record<string, string> = {
  working: 'Online',
  los: 'LOS',
  dying_gasp: 'Dying gasp',
  offline: 'Offline',
  syncing: 'Syncing',
  auth_failed: 'Auth failed',
  unknown: 'Unknown',
};

export const OLT_STATUS_LABEL: Record<string, string> = {
  ok: 'Operational',
  stale: 'Stale data',
  unreachable: 'Unreachable',
  quarantined: 'Quarantined',
  pending_pin: 'Pending pin',
  disabled: 'Disabled',
};

export const IDENTITY_LABEL = { strong: 'Strong identity', weak: 'Weak identity', unpinned: 'Not pinned' } as const;

export const ALARM_LABEL: Record<string, string> = {
  onu_los: 'ONU LOS',
  onu_dying_gasp: 'ONU Dying Gasp',
  onu_flapping: 'ONU flapping',
  onu_rx_low: 'Low Rx',
  pon_mass_los: 'Mass LOS',
  pon_mass_power: 'Mass power loss',
  olt_unreachable: 'OLT unreachable',
  olt_identity_mismatch: 'OLT identity changed',
  cli_unavailable: 'CLI unavailable',
};

/** One line per alarm kind (SPEC §8.2), in place of a per-alarm message the API does not have. */
export const ALARM_DESCRIPTION: Record<string, string> = {
  onu_los: 'The ONU lost its optical signal.',
  onu_dying_gasp: 'The ONU sent dying gasp: power at the customer is off.',
  onu_flapping: 'The ONU dropped 3 or more times within an hour.',
  onu_rx_low: 'ONU receive power is below −25 dBm (warning) or −27 dBm (critical).',
  pon_mass_los: 'Several ONUs on one PON port are LOS at the same time.',
  pon_mass_power: 'Several ONUs on one PON port are in dying gasp at the same time: likely a power outage.',
  olt_unreachable: 'Two status cycles in a row timed out.',
  olt_identity_mismatch: 'The OLT identity differs from the pin; polling and CLI are stopped.',
  cli_unavailable: 'A CLI job failed after 3 retries.',
};

export const SEVERITY_LABEL: Record<string, string> = { critical: 'Critical', warning: 'Warning', info: 'Info' };

export const JOB_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  preview: 'Awaiting confirmation',
  pending_approval: 'Awaiting NOC approval',
  confirmed: 'Queued',
  running: 'Running',
  verifying: 'Verifying',
  succeeded: 'Succeeded',
  failed: 'Failed',
  blocked: 'Blocked',
  cancelled: 'Cancelled',
  rejected: 'Rejected',
};

/** Registration templates (SPEC §8.5); a job without a mode is `default`. */
export const PROVISION_MODE_LABEL: Record<string, string> = {
  default: 'Default',
  bridge: 'Bridge',
  pppoe_map: 'PPPoE MAP',
  bridge_static: 'Bridge Static',
};

export const JOB_KIND_LABEL: Record<string, string> = {
  onu_register: 'ONU registration',
  config_save: 'Save configuration (write)',
  onu_detail: 'ONU detail',
  identity_probe: 'Identity probe',
  port_sweep: 'Port sweep',
  list_sync: 'Read lists from OLT',
  uncfg_scan: 'Uncfg scan',
};

export const ROLE_LABEL = { admin: 'Admin', noc: 'NOC', teknisi: 'Technician' } as const;

/** SPEC §8.2: while the OLT is not "ok" the ONU state is unknown; show the last known one. */
export function onuStatusText(phase: string | null, oltStatus: string, updatedAt: string | null): string {
  if (oltStatus !== 'ok') return `Unknown (last: ${phase ?? '—'}, ${time(updatedAt)})`;
  return phase ? (PHASE_LABEL[phase] ?? phase) : '—';
}
