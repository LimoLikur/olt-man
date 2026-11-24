import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronsUpDown, ClipboardCheck, Inbox, KeyRound, LayoutDashboard, LogOut, type LucideIcon, Router, Server, ServerCog, Users, Waypoints } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { api } from '../../api';
import { useMe } from '../../auth';
import { initials, ROLE_LABEL } from '../../format';
import { can, type Permission } from '../../permissions';
import { useOlts } from '../../queries';
import { cx, useDismiss } from '../ui';
import { NAValue } from './status';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission: Permission;
  active: (path: string) => boolean;
  badge?: number | undefined;
  badgeTone?: 'critical' | 'warning';
}

export function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
        <Waypoints className="size-4" />
      </span>
      <span className="font-mono text-[15px] font-semibold tracking-tight">OLT-MAN</span>
    </div>
  );
}

/**
 * Left navigation (outside <main>). `collapsed` turns it into an icon rail on md+; below md it
 * is an off-canvas drawer opened from the top bar.
 */
export function AppSidebar({ collapsed, mobileOpen, onClose }: { collapsed: boolean; mobileOpen: boolean; onClose: () => void }) {
  const me = useMe();
  const path = useLocation().pathname;
  const olts = useOlts();
  const approvals = useQuery({ queryKey: ['approvals'], queryFn: () => api.get<unknown[]>('/approvals'), enabled: can(me.role, 'approveRegistration') });
  const activeAlarms = olts.data?.reduce((n, o) => n + o.activeAlarms, 0);

  const groups: { label: string | null; items: NavItem[] }[] = [
    {
      label: null,
      items: [
        { to: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'viewNetwork', active: (p) => p === '/' },
        { to: '/olts', label: 'OLTs', icon: Server, permission: 'viewNetwork', active: (p) => p === '/olts' || /^\/olts\/\d+/.test(p) },
        { to: '/onus', label: 'ONUs', icon: Router, permission: 'viewNetwork', active: (p) => p.startsWith('/onus') },
        { to: '/alarms', label: 'Alarms', icon: Bell, permission: 'viewNetwork', active: (p) => p.startsWith('/alarms'), badge: activeAlarms, badgeTone: 'critical' },
      ],
    },
    {
      label: 'Provisioning',
      items: [
        { to: '/provision/new', label: 'ONU registration', icon: ClipboardCheck, permission: 'composeRegistration', active: (p) => p.startsWith('/provision') },
        { to: '/approvals', label: 'Approvals', icon: Inbox, permission: 'approveRegistration', active: (p) => p.startsWith('/approvals'), badge: approvals.data?.length, badgeTone: 'warning' },
      ],
    },
    {
      label: 'Administration',
      items: [
        { to: '/olts/new', label: 'Add OLT', icon: ServerCog, permission: 'manageOlts', active: (p) => p === '/olts/new' },
        { to: '/users', label: 'Users', icon: Users, permission: 'manageUsers', active: (p) => p.startsWith('/users') },
      ],
    },
  ];

  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-scrim md:hidden" onClick={onClose} aria-hidden />}
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[transform,width] duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed && 'md:w-16',
        )}
      >
        <div className="border-b border-sidebar-border px-2 py-2">
          <UserMenu collapsed={collapsed} />
        </div>
        <nav aria-label="Main menu" className="flex-1 overflow-y-auto px-2 py-2">
          {groups.map((g, gi) => {
            const items = g.items.filter((i) => can(me.role, i.permission));
            if (items.length === 0) return null;
            return (
              <div key={g.label ?? 'main'} className="py-1">
                {gi > 0 && <div className={cx('mx-2 my-2 border-t border-dashed', !collapsed && 'hidden')} />}
                {g.label && <div className={cx('section-label px-3 pb-1 pt-3', collapsed && 'md:hidden')}>{g.label}</div>}
                <ul className="space-y-0.5">
                  {items.map((item) => {
                    const active = item.active(path);
                    return (
                      <li key={item.to}>
                        <Link
                          to={item.to}
                          title={collapsed ? item.label : undefined}
                          aria-current={active ? 'page' : undefined}
                          onClick={onClose}
                          className={cx(
                            'relative flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors',
                            active ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'hover:bg-sidebar-accent/70',
                            collapsed && 'md:justify-center md:px-0',
                          )}
                        >
                          <item.icon className="size-4 shrink-0" />
                          <span className={cx('truncate', collapsed && 'md:sr-only')}>{item.label}</span>
                          {!!item.badge && (
                            <span
                              className={cx(
                                'numeric ml-auto rounded-md px-1.5 text-[11px] font-medium',
                                item.badgeTone === 'critical' ? 'bg-critical-soft text-critical' : 'bg-warning-soft text-orange',
                                collapsed && 'md:absolute md:right-0.5 md:top-0.5 md:ml-0 md:px-1',
                              )}
                            >
                              {item.badge}
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className={cx('border-t border-sidebar-border px-4 py-3', collapsed && 'md:hidden')}>
          <BrandMark />
          <p className="mt-1 text-[11px] text-muted-foreground">ZTE C320 · GPON operations</p>
        </div>
      </aside>
    </>
  );
}

function UserMenu({ collapsed }: { collapsed: boolean }) {
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);

  const logout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    qc.clear();
    navigate('/login', { replace: true });
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx('flex h-12 w-full items-center gap-3 rounded-md px-2 text-left transition-colors hover:bg-sidebar-accent', open && 'bg-sidebar-accent', collapsed && 'md:justify-center md:px-0')}
      >
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border bg-primary-soft text-xs font-semibold text-primary">{initials(me.username)}</span>
        <span data-testid="whoami" className={cx('grid min-w-0 flex-1 leading-tight', collapsed && 'md:sr-only')}>
          <span className="truncate text-sm font-semibold text-foreground">{me.username}</span>
          <span className="sr-only"> · </span>
          <span className="mt-1 w-fit rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{ROLE_LABEL[me.role]}</span>
        </span>
        <ChevronsUpDown className={cx('ml-auto size-4 shrink-0 text-muted-foreground', collapsed && 'md:hidden')} />
      </button>
      {open && (
        <div role="menu" className="absolute left-0 top-full z-50 mt-1 w-60 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-lift">
          <div className="px-2 py-1.5">
            <div className="font-medium">{me.username}</div>
            <div className="text-xs text-muted-foreground">
              {ROLE_LABEL[me.role]} · email <NAValue />
            </div>
          </div>
          <div className="my-1 h-px bg-border" />
          <Link role="menuitem" to="/account/password" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
            <KeyRound className="size-4 text-muted-foreground" /> Change password
          </Link>
          <button role="menuitem" type="button" onClick={() => void logout()} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent">
            <LogOut className="size-4 text-muted-foreground" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
