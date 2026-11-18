import type { OltSummary } from '@olt/shared/dto';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Bell, ClipboardCheck, Router, Server, Signal } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../api';
import { useMe } from '../auth';
import { BarChart, CHART_COLORS } from '../components/app/charts';
import { OltCard } from '../components/app/olt-card';
import { PageBody, PageHeader, Panel, SectionLabel, StatCard } from '../components/app/panel';
import { alarmLabel, NAValue, SeverityBadge } from '../components/app/status';
import { buttonClass, Empty, Loading } from '../components/ui';
import { ago, dateTime, pct, plural } from '../format';
import { can } from '../permissions';
import { useOnuCount } from '../queries';

interface Dashboard {
  totals: { olts: number; onus: number; online: number; offline: number };
  olts: OltSummary[];
  alarms: { id: number; oltId: number; oltName: string; kind: string; severity: string; firstAt: string; children: number; acked: boolean }[];
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

export function DashboardPage() {
  const me = useMe();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/dashboard') });
  const canApprove = can(me.role, 'approveRegistration');
  const approvals = useQuery({ queryKey: ['approvals'], queryFn: () => api.get<unknown[]>('/approvals'), enabled: canApprove });
  const los = useOnuCount({ phase: 'los' });
  const dyingGasp = useOnuCount({ phase: 'dying_gasp' });
  const offline = useOnuCount({ phase: 'offline' });
  const rxOk = useOnuCount({ rx: 'ok' });
  const rxWarn = useOnuCount({ rx: 'warn' });
  const rxCrit = useOnuCount({ rx: 'crit' });

  if (!q.data) return <Loading />;
  const { totals, olts, alarms } = q.data;
  const withIssues = olts.filter((o) => o.status !== 'ok').length;
  const activeAlarms = olts.reduce((n, o) => n + o.activeAlarms, 0);
  const critical = alarms.filter((a) => a.severity === 'critical').length;

  const notOnline = { los: los.data ?? 0, dyingGasp: dyingGasp.data ?? 0, offline: offline.data ?? 0 };
  const other = Math.max(0, totals.offline - notOnline.los - notOnline.dyingGasp - notOnline.offline);
  const status = [
    { label: 'Online', n: totals.online, bar: 'bg-success' },
    { label: 'LOS', n: notOnline.los, bar: 'bg-critical' },
    { label: 'Dying gasp', n: notOnline.dyingGasp, bar: 'bg-orange' },
    { label: 'Offline', n: notOnline.offline, bar: 'bg-muted-foreground/50' },
    { label: 'Other', n: other, bar: 'bg-info/60' },
  ];
  const buckets = [
    { label: '≥ −25', value: rxOk.data ?? 0, color: CHART_COLORS.primary },
    { label: '−27 … −25', value: rxWarn.data ?? 0, color: CHART_COLORS.orange },
    { label: '< −27', value: rxCrit.data ?? 0, color: CHART_COLORS.critical },
  ];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`${plural(totals.olts, 'OLT')} · ${plural(totals.onus, 'ONU')}`}
        actions={
          <span className="text-sm text-muted-foreground">
            {greeting()}, {me.username}
          </span>
        }
      />
      <PageBody>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard title="OLTs" icon={Server} tone="primary" value={totals.olts} chip={withIssues ? `${withIssues} with issues` : 'All operational'} />
          <StatCard
            title="ONUs online"
            icon={Router}
            tone="info"
            value={pct(totals.online, totals.onus, 1)}
            chip={
              <>
                {totals.online} / <span data-testid="total-onus">{totals.onus}</span>
              </>
            }
          />
          <StatCard title="Active alarms" icon={Bell} tone="critical" value={activeAlarms} chip={`${critical} critical`} />
          <StatCard
            title="Pending approvals"
            icon={ClipboardCheck}
            tone="warning"
            value={canApprove ? (approvals.data?.length ?? '—') : <NAValue title="Only NOC and admins see the approval queue" />}
            chip={canApprove ? 'ONU registrations' : 'NOC / admin only'}
          />
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0">
            <SectionLabel
              action={
                <Link to="/olts" className={buttonClass('ghost', 'sm', 'text-muted-foreground')}>
                  View all <ArrowUpRight />
                </Link>
              }
            >
              Optical line terminals
            </SectionLabel>
            {olts.length === 0 ? (
              <div className="panel">
                <Empty icon={<Server />}>No OLTs registered yet.</Empty>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {olts.map((o) => (
                  <OltCard key={o.id} olt={o} />
                ))}
              </div>
            )}
          </div>

          <div className="min-w-0 space-y-6">
            <Panel
              title="Live alarms"
              icon={Bell}
              tone="critical"
              flush
              action={
                <Link to="/alarms" className={buttonClass('ghost', 'sm', 'h-7 text-muted-foreground')}>
                  All
                </Link>
              }
            >
              <ul className="divide-y">
                {alarms.slice(0, 6).map((a) => (
                  <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                    <SeverityBadge severity={a.severity} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{alarmLabel(a.kind)}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {a.oltName}
                        {a.children > 0 && ` · ${a.children} grouped`}
                        {a.acked && ' · acknowledged'}
                      </div>
                    </div>
                    <span className="whitespace-nowrap text-xs text-muted-foreground" title={dateTime(a.firstAt)}>
                      {ago(a.firstAt)}
                    </span>
                  </li>
                ))}
                {alarms.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">No active alarms</li>}
              </ul>
            </Panel>

            <Panel
              title="ONU status"
              icon={Router}
              tone="info"
              action={
                <span className="text-xs text-muted-foreground">
                  Not online{' '}
                  <span className="numeric font-medium text-foreground" data-testid="total-offline">
                    {totals.offline}
                  </span>
                </span>
              }
            >
              <div className="flex h-2.5 overflow-hidden rounded-full bg-segment-empty">
                {status.map((s) => (
                  <div key={s.label} className={s.bar} style={{ width: `${totals.onus ? (s.n / totals.onus) * 100 : 0}%` }} />
                ))}
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                {status.map((s) => (
                  <div key={s.label} className="flex items-center gap-2">
                    <span className={`size-2.5 rounded-sm ${s.bar}`} />
                    <dt className="text-muted-foreground">{s.label}</dt>
                    <dd className="numeric ml-auto font-medium">{s.n.toLocaleString('en-US')}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">Other = syncing, auth failed or unknown.</p>
            </Panel>

            <Panel title="Rx power distribution" icon={Signal} tone="primary">
              <BarChart data={buckets} />
              <p className="mt-2 text-xs text-muted-foreground">ONUs per dBm range · warning below −25, critical below −27. ONUs without a reading are not counted.</p>
            </Panel>
          </div>
        </div>
      </PageBody>
    </div>
  );
}
