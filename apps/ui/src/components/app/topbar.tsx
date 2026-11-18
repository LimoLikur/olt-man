import { useQuery } from '@tanstack/react-query';
import { Bell, PanelLeft } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../../api';
import { CommandSearch } from './command-search';

/** Sticky header: sidebar toggle, quick search and the critical-alarm bell. */
export function TopBar({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const alarms = useQuery({ queryKey: ['alarms', 'active'], queryFn: () => api.get<{ severity: string }[]>('/alarms?state=active') });
  const critical = (alarms.data ?? []).filter((a) => a.severity === 'critical').length;
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-card/80 px-3 backdrop-blur sm:px-4">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label="Toggle sidebar"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <PanelLeft className="size-4" />
      </button>
      <div className="flex min-w-0 flex-1 justify-center">
        <CommandSearch />
      </div>
      <Link
        to="/alarms"
        aria-label={critical ? `Alarms: ${critical} critical` : 'Alarms'}
        className="relative inline-flex size-9 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground transition-colors hover:text-foreground"
      >
        <Bell className="size-4" />
        {critical > 0 && (
          <span className="numeric absolute -right-1.5 -top-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[10px] font-semibold text-primary-foreground">
            {critical}
          </span>
        )}
      </Link>
    </header>
  );
}
