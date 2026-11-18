import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cx } from '../ui';

export type Tone = 'primary' | 'info' | 'success' | 'warning' | 'critical' | 'neutral';

const ICON_TILE_TONE: Record<Tone, string> = {
  primary: 'border-primary/15 bg-primary-soft text-primary',
  info: 'border-info/15 bg-info-soft text-info',
  success: 'border-success/15 bg-success-soft text-success',
  warning: 'border-warning/25 bg-warning-soft text-orange',
  critical: 'border-critical/15 bg-critical-soft text-critical',
  neutral: 'border-border bg-muted text-foreground',
};
const ICON_TILE_SIZE = { sm: 'size-7', md: 'size-8', lg: 'size-11 rounded-xl [&_svg]:size-5' } as const;

export function IconTile({ icon: Icon, tone = 'neutral', size = 'md', className }: { icon: LucideIcon; tone?: Tone | undefined; size?: keyof typeof ICON_TILE_SIZE; className?: string }) {
  return (
    <span className={cx('inline-flex shrink-0 items-center justify-center rounded-lg border [&_svg]:size-4', ICON_TILE_TONE[tone], ICON_TILE_SIZE[size], className)}>
      <Icon />
    </span>
  );
}

/** White card with an optional header (icon, title, actions). `flush` drops the body padding (tables). */
export function Panel({
  title,
  icon,
  tone,
  action,
  children,
  className,
  bodyClassName,
  flush = false,
  testId,
}: {
  title?: ReactNode;
  icon?: LucideIcon | undefined;
  tone?: Tone | undefined;
  action?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
  bodyClassName?: string | undefined;
  flush?: boolean;
  testId?: string;
}) {
  return (
    <section className={cx('panel min-w-0 overflow-hidden', className)} data-testid={testId}>
      {title && (
        <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
          {icon && <IconTile icon={icon} tone={tone} size="sm" />}
          <h2 className="text-[15px] font-medium tracking-tight">{title}</h2>
          {action && <div className="ml-auto flex flex-wrap items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={cx(!flush && 'p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function StatCard({
  title,
  icon,
  tone = 'primary',
  value,
  chip,
  hint,
}: {
  title: string;
  icon: LucideIcon;
  tone?: Tone;
  value: ReactNode;
  chip?: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <section className="panel">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <IconTile icon={icon} tone={tone} />
        <h2 className="text-[15px] font-medium tracking-tight">{title}</h2>
      </header>
      <div className="flex items-end justify-between gap-3 px-4 py-4">
        <div className="min-w-0">
          <div className="numeric text-[28px] font-medium leading-none tracking-tight">{value}</div>
          {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
        </div>
        {chip !== undefined && <span className="numeric shrink-0 rounded-md bg-muted px-2 py-1 text-xs text-secondary-foreground">{chip}</span>}
      </div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, leading }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; leading?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-4 border-b bg-card/60 px-4 py-4 sm:px-6">
      {leading}
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-0.5 text-sm text-muted-foreground">{subtitle}</div>}
      </div>
      {actions && <div className="ml-auto flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export const PageBody = ({ children, className }: { children: ReactNode; className?: string }) => <div className={cx('space-y-6 p-4 sm:p-6', className)}>{children}</div>;

export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2">
      <span className="text-muted-foreground" aria-hidden>
        ▾
      </span>
      <span className="section-label">{children}</span>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

export function KeyValue({ label, children, mono }: { label: ReactNode; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cx('min-w-0 break-words text-right font-medium', mono && 'font-mono text-[13px]')}>{children}</dd>
    </div>
  );
}
