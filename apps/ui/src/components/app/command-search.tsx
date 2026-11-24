import type { OnuView } from '@olt/shared/dto';
import { useQuery } from '@tanstack/react-query';
import { Router, Search, Server } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../../api';
import { oidProfileLabel, onuStatusText } from '../../format';
import { useOlts } from '../../queries';
import { cx } from '../ui';
import { PhaseBadge } from './status';

/** ⌘K / Ctrl+K quick search: OLTs from the cached list, ONUs by name or SN from the api. */
export function CommandSearch() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 w-full max-w-md items-center gap-2 rounded-lg border bg-card px-3 text-sm text-muted-foreground shadow-panel transition-colors hover:border-primary/30"
      >
        <Search className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">Search SN, customer or OLT…</span>
        <kbd className="tag-mono hidden sm:inline">Ctrl K</kbd>
      </button>
      {/* Rendered only while open, so its input never matches page locators. */}
      {open && <Palette onClose={() => setOpen(false)} />}
    </>
  );
}

interface Hit {
  key: string;
  to: string;
  kind: 'olt' | 'onu';
  title: string;
  detail: string;
  extra?: ReactNode;
}

function Palette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim().slice(0, 64)), 200);
    return () => clearTimeout(t);
  }, [q]);

  const olts = useOlts();
  const onus = useQuery({
    queryKey: ['palette-onus', term],
    queryFn: () => api.get<{ items: OnuView[] }>(`/onus?${new URLSearchParams({ q: term, limit: '8' })}`),
    enabled: term.length >= 2,
    refetchInterval: false,
    staleTime: 30_000,
  });

  const query = q.trim().toLowerCase();
  const hits: Hit[] = [
    ...(olts.data ?? [])
      .filter((o) => !query || `${o.name} ${o.mgmtIp} ${o.oidProfile}`.toLowerCase().includes(query))
      .slice(0, 6)
      .map((o): Hit => ({ key: `olt-${o.id}`, to: `/olts/${o.id}`, kind: 'olt', title: o.name, detail: o.mgmtIp, extra: <span className="tag-mono">{oidProfileLabel(o.oidProfile)}</span> })),
    ...(term.length >= 2 ? (onus.data?.items ?? []) : []).map(
      (o): Hit => ({
        key: `onu-${o.id}`,
        to: `/onus/${o.id}`,
        kind: 'onu',
        title: o.sn,
        detail: `${o.name ?? `ONU ${o.onuIndex}`} · ${o.oltName} 1/${o.slot}/${o.port}:${o.onuIndex}`,
        extra: <PhaseBadge phase={o.phase} oltStatus={o.oltStatus} text={onuStatusText(o.phase, o.oltStatus, o.updatedAt)} />,
      }),
    ),
  ];
  const current = Math.min(active, Math.max(0, hits.length - 1));

  const go = (hit: Hit | undefined) => {
    if (!hit) return;
    onClose();
    navigate(hit.to);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((current + 1) % Math.max(1, hits.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((current - 1 + hits.length) % Math.max(1, hits.length));
    } else if (e.key === 'Enter') go(hits[current]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-scrim p-4 pt-[12vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Quick search" className="panel w-full max-w-lg overflow-hidden shadow-lift">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            aria-label="Quick search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKey}
            placeholder="Type a serial number, customer or OLT…"
            className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="tag-mono">Esc</kbd>
        </div>
        <ul className="max-h-80 overflow-y-auto p-1" role="listbox" aria-label="Results">
          {hits.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted-foreground">{term.length >= 2 && onus.isFetching ? 'Searching…' : 'No matches found.'}</li>}
          {hits.map((h, i) => (
            <li key={h.key} role="option" aria-selected={i === current}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => go(h)}
                className={cx('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm', i === current && 'bg-accent')}
              >
                {h.kind === 'olt' ? <Server className="size-4 shrink-0 text-muted-foreground" /> : <Router className="size-4 shrink-0 text-muted-foreground" />}
                <span className={cx('shrink-0 font-medium', h.kind === 'onu' && 'font-mono text-[13px]')}>{h.title}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">{h.detail}</span>
                <span className="shrink-0">{h.extra}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
