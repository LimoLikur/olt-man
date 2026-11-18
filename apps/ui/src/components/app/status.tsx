import type { ReactNode } from 'react';
import { ALARM_LABEL, IDENTITY_LABEL, NA, OLT_STATUS_LABEL, PHASE_LABEL, SEVERITY_LABEL, dbm } from '../../format';
import { rxLevel } from '../../signal';
import { Button, cx, type ButtonSize, type ButtonVariant } from '../ui';

export type PillTone = 'success' | 'warning' | 'orange' | 'critical' | 'info' | 'primary' | 'neutral';

const PILL: Record<PillTone, string> = {
  success: 'border-success/20 bg-success-soft text-success',
  warning: 'border-warning/30 bg-warning-soft text-orange',
  orange: 'border-orange/25 bg-orange-soft text-orange',
  critical: 'border-critical/20 bg-critical-soft text-critical',
  info: 'border-info/20 bg-info-soft text-info',
  primary: 'border-primary/20 bg-primary-soft text-primary',
  neutral: 'border-border bg-muted text-muted-foreground',
};
const DOT: Record<PillTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  orange: 'bg-orange',
  critical: 'bg-critical',
  info: 'bg-info',
  primary: 'bg-primary',
  neutral: 'bg-muted-foreground/60',
};

export function Pill({ tone, dot, pulse, children, className, title }: { tone: PillTone; dot?: boolean; pulse?: boolean; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium', PILL[tone], className)}>
      {dot && <span aria-hidden className={cx('size-1.5 rounded-full', DOT[tone], pulse && 'animate-pulse-dot')} />}
      {children}
    </span>
  );
}

export const MockBadge = () => (
  <Pill tone="primary" title="Mock OLT for development and demos">
    MOCK
  </Pill>
);

const OLT_TONE: Record<string, PillTone> = { ok: 'success', stale: 'warning', unreachable: 'critical', quarantined: 'critical', pending_pin: 'info', disabled: 'neutral' };

export function OltStatusBadge({ status }: { status: string }) {
  return (
    <Pill tone={OLT_TONE[status] ?? 'neutral'} dot pulse={status === 'unreachable' || status === 'quarantined'}>
      {OLT_STATUS_LABEL[status] ?? status}
    </Pill>
  );
}

export function IdentityBadge({ level }: { level: 'strong' | 'weak' | 'unpinned' }) {
  const tone: PillTone = level === 'strong' ? 'success' : level === 'weak' ? 'warning' : 'neutral';
  return <Pill tone={tone}>{IDENTITY_LABEL[level]}</Pill>;
}

const PHASE_TONE: Record<string, PillTone> = { working: 'success', los: 'critical', dying_gasp: 'orange', offline: 'neutral', syncing: 'info', auth_failed: 'warning', unknown: 'neutral' };

/** ONU phase; while the OLT is not "ok" the state is unknown and `text` explains it. */
export function PhaseBadge({ phase, oltStatus = 'ok', text }: { phase: string | null; oltStatus?: string; text?: string }) {
  if (oltStatus !== 'ok') return <Pill tone="neutral">{text ?? 'Unknown'}</Pill>;
  return (
    <Pill tone={phase ? (PHASE_TONE[phase] ?? 'neutral') : 'neutral'} dot pulse={phase === 'los'}>
      {phase ? (PHASE_LABEL[phase] ?? phase) : '—'}
    </Pill>
  );
}

const SEVERITY_TONE: Record<string, PillTone> = { critical: 'critical', warning: 'warning', info: 'info' };

export function SeverityBadge({ severity }: { severity: string }) {
  return (
    <Pill tone={SEVERITY_TONE[severity] ?? 'neutral'} dot>
      {SEVERITY_LABEL[severity] ?? severity}
    </Pill>
  );
}

export function AlarmStateBadge({ state, acked }: { state: string; acked: boolean }) {
  if (state === 'cleared') return <Pill tone="neutral">Cleared</Pill>;
  return acked ? <Pill tone="primary">Acknowledged</Pill> : <Pill tone="critical">Active</Pill>;
}

export const alarmLabel = (kind: string) => ALARM_LABEL[kind] ?? kind;

const RX_TEXT = { good: 'text-success', warning: 'text-orange', critical: 'text-critical', none: 'text-muted-foreground' } as const;

/** ONU receive power coloured by the SPEC §8.2 thresholds. */
export function RxValue({ value, className, unit = true }: { value: number | null | undefined; className?: string; unit?: boolean }) {
  return (
    <span className={cx('numeric font-mono text-[13px]', RX_TEXT[rxLevel(value)], className)}>{unit ? dbm(value) : value === null || value === undefined ? '—' : value.toFixed(2)}</span>
  );
}

/** Data this system does not collect or expose: the slot stays, the value is N/A. */
export function NAValue({ className, title = 'Not available in OLT-MAN' }: { className?: string; title?: string }) {
  return (
    <span className={cx('text-muted-foreground', className)} title={title}>
      {NA}
    </span>
  );
}

/** An action from the design that the system does not support: shown, but never runs. */
export function DisabledAction({
  children,
  reason = 'not available',
  variant = 'outline',
  size = 'md',
  className,
}: {
  children: ReactNode;
  reason?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  return (
    <span title={`N/A — ${reason}`} className="inline-flex cursor-not-allowed">
      <Button variant={variant} size={size} disabled className={className}>
        {children}
      </Button>
    </span>
  );
}

const SEG_FILL = { success: 'bg-success', warning: 'bg-warning', orange: 'bg-orange', critical: 'bg-critical', primary: 'bg-primary' } as const;

/** Segmented meter (0..1); null = N/A, every segment empty. */
export function SegmentBar({ value, segments = 40, tone, className }: { value: number | null; segments?: number; tone?: keyof typeof SEG_FILL; className?: string }) {
  const v = value === null ? 0 : Math.max(0, Math.min(1, value));
  const filled = Math.round(v * segments);
  const t = tone ?? (v >= 0.88 ? 'orange' : v >= 0.7 ? 'warning' : 'success');
  return (
    <div className={cx('flex h-6 items-stretch gap-[3px]', className)} role="img" aria-label={value === null ? NA : `${Math.round(v * 100)}%`}>
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={cx('flex-1 rounded-[2px]', i < filled ? SEG_FILL[t] : 'bg-segment-empty')}
          style={i < filled ? { opacity: 0.55 + 0.45 * ((i + 1) / filled) } : undefined}
        />
      ))}
    </div>
  );
}
