import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { AppSidebar } from './app/sidebar';
import { TopBar } from './app/topbar';

const COLLAPSED_KEY = 'oltman.sidebar.collapsed';

// Browser storage can be unavailable (private mode, blocked site data): it is only a preference.
const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
};
const writeCollapsed = (v: boolean) => {
  try {
    localStorage.setItem(COLLAPSED_KEY, v ? '1' : '0');
  } catch {
    // ignore
  }
};

/** Signed-in shell: sidebar (outside <main>), sticky top bar, and the page in <main>. */
export function Layout() {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setMobileOpen(false), [pathname]);

  const toggle = () => {
    if (window.matchMedia('(min-width: 768px)').matches) {
      setCollapsed((c) => {
        writeCollapsed(!c);
        return !c;
      });
    } else setMobileOpen((o) => !o);
  };

  return (
    <div className="flex min-h-screen w-full">
      <AppSidebar collapsed={collapsed} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onToggleSidebar={toggle} />
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
