// Small shadcn-style building blocks (Tailwind only, no injected <style>: the CSP has style-src 'self').
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// Size groups a caller's className may override (no tailwind-merge: two `h-*` classes would
// otherwise both apply, and the CSS order would decide).
const GROUPS = [/^h-/, /^w-/, /^px-/, /^py-/, /^size-/, /^gap-/, /^text-(xs|sm|base|lg|\[)/];

/** `base` classes, minus unprefixed ones whose size group `className` sets again. */
export function tw(base: string, className?: string | false | null): string {
  if (!className) return base;
  const extra = className.split(/\s+/).filter(Boolean);
  const overridden = GROUPS.filter((g) => extra.some((e) => g.test(e)));
  return [...base.split(/\s+/).filter((b) => !overridden.some((g) => g.test(b))), ...extra].join(' ');
}

const BUTTON_VARIANT = {
  primary: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
  outline: 'border border-input bg-card shadow-xs hover:bg-accent hover:text-accent-foreground',
  ghost: 'hover:bg-accent hover:text-accent-foreground',
  destructive: 'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
  'outline-destructive': 'border border-critical/30 bg-card text-critical shadow-xs hover:bg-critical-soft',
} as const;
const BUTTON_SIZE = { sm: 'h-8 gap-1.5 px-3 text-xs', md: 'h-9 gap-2 px-4 text-sm', icon: 'size-9' } as const;

export type ButtonVariant = keyof typeof BUTTON_VARIANT;
export type ButtonSize = keyof typeof BUTTON_SIZE;

/** Button look for links (react-router <Link>) and other elements. */
export const buttonClass = (variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) =>
  tw(
    cx(
      'inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
      BUTTON_VARIANT[variant],
      BUTTON_SIZE[size],
    ),
    className,
  );

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  type = 'button',
  ...p
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} {...p} className={buttonClass(variant, size, className)} />;
}

const FIELD =
  'rounded-md border border-input bg-card text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground';

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={tw(`${FIELD} h-9 w-full px-3 py-1`, className)} />;

/** Native <select> (e2e and keyboards rely on real options); intrinsic width unless className sets one. */
export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => <select {...p} className={tw(`${FIELD} h-9 px-2.5`, className)} />;

export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...p} className={tw(`${FIELD} min-h-16 w-full px-3 py-2`, className)} />;

/** A labelled form control: the <label> wraps the control, so getByLabel finds it. */
export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string | undefined }) {
  return (
    <label className={cx('flex flex-col gap-1.5 text-sm', className)}>
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

export const Card = ({ children, className, ...rest }: { children: ReactNode; className?: string } & Record<string, unknown>) => (
  <div {...rest} className={cx('panel p-4', className)}>
    {children}
  </div>
);

const CALLOUT = {
  neutral: 'border-border bg-muted/60 text-foreground',
  info: 'border-info/20 bg-info-soft text-info',
  success: 'border-success/20 bg-success-soft text-success',
  warning: 'border-warning/30 bg-warning-soft text-orange',
  critical: 'border-critical/20 bg-critical-soft text-critical',
} as const;

/** Inline message box. Pass role="status"/"alert" only where a live region is wanted. */
export function Callout({
  tone = 'neutral',
  role,
  icon,
  children,
  className,
}: {
  tone?: keyof typeof CALLOUT;
  role?: 'status' | 'alert' | undefined;
  icon?: ReactNode;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <div role={role} className={cx('flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0', CALLOUT[tone], className)}>
      {icon}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export const Table = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cx('w-full overflow-x-auto', className)}>
    <table className="w-full text-left text-sm [&_tbody_tr:hover]:bg-muted/40 [&_tbody_tr:last-child>td]:border-b-0">{children}</table>
  </div>
);
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th className={cx('h-10 whitespace-nowrap border-b px-3 align-middle text-xs font-medium text-muted-foreground first:pl-4 last:pr-4', className)}>{children}</th>
);
export const Td = ({ children, className, colSpan }: { children?: ReactNode; className?: string; colSpan?: number }) => (
  <td colSpan={colSpan} className={cx('border-b border-border/70 px-3 py-2.5 align-middle first:pl-4 last:pr-4', className)}>
    {children}
  </td>
);

export const Empty = ({ children, icon }: { children: ReactNode; icon?: ReactNode }) => (
  <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground [&_svg]:size-5">
    {icon}
    <p>{children}</p>
  </div>
);

export const Loading = ({ children = 'Loading…' }: { children?: ReactNode }) => <p className="p-6 text-sm text-muted-foreground">{children}</p>;

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  count?: number | undefined;
}

/** Underlined tabs (role="tab", so they never count as buttons). */
export function Tabs<T extends string>({ value, onChange, items, className, label }: { value: T; onChange: (v: T) => void; items: TabItem<T>[]; className?: string; label: string }) {
  return (
    <div role="tablist" aria-label={label} className={cx('flex gap-1 overflow-x-auto px-2 pt-2', className)}>
      {items.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cx(
            '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 pb-2.5 pt-1.5 text-sm transition-colors',
            value === t.value ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="numeric rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{t.count.toLocaleString('en-US')}</span>}
        </button>
      ))}
    </div>
  );
}

/** Small segmented control (role="radio" items). */
export function Segmented<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex h-8 items-center rounded-lg bg-muted p-0.5 text-xs">
      {items.map((t) => (
        <button
          key={t.value}
          type="button"
          role="radio"
          aria-checked={value === t.value}
          onClick={() => onChange(t.value)}
          className={cx('h-7 rounded-md px-2.5 font-medium transition-colors', value === t.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
