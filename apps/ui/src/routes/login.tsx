import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Bell, ClipboardCheck, Lock, Server, Signal, User } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { api, ApiError } from '../api';
import { IconTile } from '../components/app/panel';
import { BrandMark } from '../components/app/sidebar';
import { OltStatusBadge, Pill, SegmentBar } from '../components/app/status';
import { Button, Input } from '../components/ui';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/login', { username, password });
      await qc.invalidateQueries({ queryKey: ['me'] });
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/', { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Incorrect username or password.'
          : err instanceof ApiError && err.status === 429
            ? 'Too many sign-in attempts. Try again later.'
            : err instanceof ApiError && err.status === 403
              ? 'Access denied. The admin role can only be used from the office network.'
              : 'Cannot reach the server.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <BrandMark />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to your NOC console</h1>
          <p className="mt-2 text-sm text-muted-foreground">Monitor ZTE C320 OLTs, track ONU signal health and approve new registrations.</p>

          <form onSubmit={(e) => void submit(e)} className="mt-8 space-y-4">
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Username</span>
              <span className="relative block">
                <User className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input name="username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} className="h-10 pl-9" required />
              </span>
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="font-medium">Password</span>
              <span className="relative block">
                <Lock className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input name="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" className="h-10 pl-9" required />
              </span>
            </label>
            {error && (
              <p role="alert" className="rounded-md border border-critical/20 bg-critical-soft px-3 py-2 text-sm text-critical">
                {error}
              </p>
            )}
            <Button type="submit" className="h-10 w-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'} <ArrowRight />
            </Button>
          </form>
          <p className="mt-6 text-xs text-muted-foreground">Admin accounts can only sign in from the office network. Sessions end after 30 minutes of inactivity.</p>
        </div>
      </div>

      {/* Decorative: an illustration of the console, no live data before sign-in. */}
      <div className="relative hidden overflow-hidden border-l bg-primary-soft lg:block" aria-hidden>
        <div className="absolute inset-0 opacity-60 [background-image:radial-gradient(color-mix(in_oklab,var(--color-primary)_22%,transparent)_1px,transparent_1px)] [background-size:22px_22px]" />
        <div className="relative flex h-full flex-col justify-center gap-5 px-16">
          <div className="panel w-[420px] p-4 shadow-lift">
            <div className="flex items-start gap-3">
              <IconTile icon={Server} size="lg" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">OLT health</span>
                  <span className="tag-mono">C320 V2.1</span>
                </div>
                <div className="text-sm text-muted-foreground">Status, pinned identity and data age</div>
              </div>
              <OltStatusBadge status="ok" />
            </div>
            <div className="divider-dashed my-4" />
            <div className="grid grid-cols-3 text-sm">
              <div>
                <div className="text-muted-foreground">ONUs</div>
                <div className="font-medium">online</div>
              </div>
              <div className="text-center">
                <div className="text-muted-foreground">PON</div>
                <div className="font-medium">per port</div>
              </div>
              <div className="text-right">
                <div className="text-muted-foreground">Alarms</div>
                <div className="font-medium">live</div>
              </div>
            </div>
            <SegmentBar value={0.6} tone="primary" className="mt-3" />
          </div>
          <div className="panel ml-20 w-[360px] p-4 shadow-lift">
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 font-medium">
                <Signal className="size-4 text-primary" /> ONU Rx power
              </span>
              <Pill tone="warning">−25 / −27 dBm</Pill>
            </div>
            <svg viewBox="0 0 300 70" className="h-16 w-full">
              <path d="M0 40 C 30 30, 50 44, 80 36 S 130 26, 160 34 S 220 46, 250 32 S 290 30, 300 34" fill="none" stroke="var(--color-primary)" strokeWidth="2.5" />
              <line x1="0" x2="300" y1="56" y2="56" stroke="var(--color-warning)" strokeDasharray="4 4" />
              <line x1="0" x2="300" y1="64" y2="64" stroke="var(--color-critical)" strokeDasharray="4 4" />
            </svg>
          </div>
          <div className="flex gap-3">
            <div className="panel flex items-center gap-2 px-3 py-2 text-sm">
              <Bell className="size-4 text-critical" /> Alarm triage
            </div>
            <div className="panel flex items-center gap-2 px-3 py-2 text-sm">
              <ClipboardCheck className="size-4 text-primary" /> Approval-based provisioning
            </div>
          </div>
          <p className="max-w-md text-sm text-muted-foreground">One console for OLT health, ONU optical levels, alarm triage and approval-based ONU registration.</p>
        </div>
      </div>
    </div>
  );
}
