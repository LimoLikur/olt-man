import { Check, Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { setThemePreference, type ThemePreference, useTheme } from '../../theme';
import { cx, useDismiss } from '../ui';

const OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Monitor },
];

/** Icon button (shows the applied theme) with a Light / Dark / System menu. */
export function ThemeMenu({ className }: { className?: string }) {
  const { preference, theme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);

  const Icon = theme === 'dark' ? Moon : Sun;
  const label = OPTIONS.find((o) => o.value === preference)?.label;
  return (
    <div ref={ref} className={cx('relative', className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Theme"
        title={`Theme: ${label}`}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground transition-colors hover:text-foreground"
      >
        <Icon className="size-4" />
      </button>
      {open && (
        <div role="menu" aria-label="Theme" className="absolute right-0 top-full z-50 mt-1 w-36 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-lift">
          {OPTIONS.map((o) => (
            <button
              key={o.value}
              type="button"
              role="menuitemradio"
              aria-checked={preference === o.value}
              onClick={() => {
                setThemePreference(o.value);
                close();
              }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent"
            >
              <o.icon className="size-4 text-muted-foreground" />
              {o.label}
              {preference === o.value && <Check className="ml-auto size-4 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
