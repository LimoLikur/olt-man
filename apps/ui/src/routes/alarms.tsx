import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Check, CircleExclamationPoint, Eye, Info, OctagonExclamationPoint, TriangleExclamationPoint, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../api';
import { useMe } from '../auth';
import { PageBody, PageHeader, StatCard } from '../components/app/panel';
import { AlarmStateBadge, alarmLabel, DisabledAction, NAValue, SeverityBadge } from '../components/app/status';
import { Button, Callout, Empty, Select, Table, Tabs, Td, Th } from '../components/ui';
import { ago, ALARM_DESCRIPTION, dateTime, plural, shortDateTime } from '../format';
import { can } from '../permissions';

interface AlarmItem {
  id: number;
  oltId: number;
  oltName: string;
  kind: string;
  severity: string;
  state: string;
  port: string | null;
  onuId: number | null;
  onuName: string | null;
  firstAt: string;
  lastAt: string | null;
  clearedAt: string | null;
  ackBy: number | null;
  ackAt: string | null;
}
interface AlarmTree extends AlarmItem {
  children: AlarmItem[];
}

type Tab = 'active' | 'unacked' | 'cleared' | 'all';

export function AlarmsPage() {
  const me = useMe();
  const qc = useQueryClient();
  const canAck = can(me.role, 'acknowledgeAlarm');
  const [tab, setTab] = useState<Tab>('active');
  const [severity, setSeverity] = useState('');
  // Active and cleared are fetched apart: the api returns at most 500 rows per request.
  const active = useQuery({ queryKey: ['alarms', 'active'], queryFn: () => api.get<AlarmTree[]>('/alarms?state=active') });
  const cleared = useQuery({ queryKey: ['alarms', 'cleared'], queryFn: () => api.get<AlarmTree[]>('/alarms?state=cleared'), refetchInterval: 60_000 });
  const ack = useMutation({
    mutationFn: (id: number) => api.post(`/alarms/${id}/ack`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['alarms'] });
      await qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const open = active.data ?? [];
  const done = cleared.data ?? [];
  const bySeverity = (s: string) => open.filter((a) => a.severity === s).length;
  const lists: Record<Tab, AlarmTree[]> = {
    active: open,
    unacked: open.filter((a) => !a.ackAt),
    cleared: done,
    all: [...open, ...done].sort((a, b) => b.firstAt.localeCompare(a.firstAt)),
  };
  const rows = lists[tab].filter((a) => !severity || a.severity === severity);
  const loading = !active.data;

  return (
    <div>
      <PageHeader title="Alarms" subtitle={`${open.length} active · ${open.filter((a) => a.ackAt).length} acknowledged`} />
      <PageBody>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          <StatCard title="Critical" icon={OctagonExclamationPoint} tone="critical" value={bySeverity('critical')} chip="open" />
          <StatCard title="Major" icon={TriangleExclamationPoint} tone="warning" value={<NAValue title="OLT-MAN has no major severity" />} chip="open" />
          <StatCard title="Minor" icon={CircleExclamationPoint} tone="warning" value={<NAValue title="OLT-MAN has no minor severity" />} chip="open" />
          <StatCard title="Warning" icon={TriangleExclamationPoint} tone="warning" value={bySeverity('warning')} chip="open" />
          <StatCard title="Info" icon={Info} tone="info" value={bySeverity('info')} chip="open" />
        </div>

        {!canAck && (
          <Callout tone="info" icon={<Eye />}>
            View-only access: only NOC engineers and admins can acknowledge alarms.
          </Callout>
        )}

        <div className="panel overflow-hidden">
          <div className="flex flex-wrap items-end gap-2 border-b">
            <Tabs<Tab>
              label="Alarm state"
              value={tab}
              onChange={setTab}
              items={[
                { value: 'active', label: 'Active', count: lists.active.length },
                { value: 'unacked', label: 'Unacknowledged', count: lists.unacked.length },
                { value: 'cleared', label: 'Cleared', count: lists.cleared.length },
                { value: 'all', label: 'All', count: lists.all.length },
              ]}
            />
            <div className="ml-auto pb-2 pr-2">
              <Select aria-label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value)} className="h-8 w-40">
                <option value="">All severities</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </Select>
            </div>
          </div>

          <Table>
            <thead>
              <tr>
                <Th>Severity</Th>
                <Th>Alarm</Th>
                <Th>Source</Th>
                <Th>Raised</Th>
                <Th>Status</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id} data-testid="alarm" className="align-top">
                  <Td>
                    <SeverityBadge severity={a.severity} />
                  </Td>
                  <Td className="min-w-64">
                    <div className="font-medium">{alarmLabel(a.kind)}</div>
                    <div className="max-w-md text-xs text-muted-foreground">{ALARM_DESCRIPTION[a.kind] ?? <NAValue />}</div>
                    {a.children.length > 0 && (
                      <details className="mt-2 text-xs" open>
                        <summary className="cursor-pointer text-muted-foreground" data-testid="alarm-children">
                          {plural(a.children.length, 'grouped alarm')}
                        </summary>
                        <ul className="ml-4 mt-1 list-disc space-y-0.5">
                          {a.children.map((c) => (
                            <li key={c.id}>
                              {alarmLabel(c.kind)}{' '}
                              {c.onuId ? (
                                <Link className="font-mono hover:text-primary" to={`/onus/${c.onuId}`}>
                                  {c.onuName ?? `ONU ${c.onuId}`}
                                </Link>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </Td>
                  <Td className="text-sm">
                    <Link to={`/olts/${a.oltId}`} className="font-medium hover:text-primary">
                      {a.oltName}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {a.port && <span className="font-mono">PON 1/{a.port}</span>}
                      {a.port && a.onuId && ' · '}
                      {a.onuId && (
                        <Link to={`/onus/${a.onuId}`} className="font-mono hover:text-primary">
                          {a.onuName ?? `ONU ${a.onuId}`}
                        </Link>
                      )}
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap text-sm">
                    <span title={dateTime(a.firstAt)}>{ago(a.firstAt)}</span>
                  </Td>
                  <Td>
                    <AlarmStateBadge state={a.state} acked={a.ackAt !== null} />
                    {a.state !== 'cleared' && a.ackAt && (
                      <div className="mt-1 whitespace-nowrap text-xs text-muted-foreground">
                        {shortDateTime(a.ackAt)} · by <NAValue />
                      </div>
                    )}
                    {a.state === 'cleared' && <div className="mt-1 whitespace-nowrap text-xs text-muted-foreground">{ago(a.clearedAt)}</div>}
                  </Td>
                  <Td className="text-right">
                    {canAck && a.state !== 'cleared' ? (
                      <div className="flex justify-end gap-1.5">
                        {!a.ackAt && (
                          <Button size="sm" variant="outline" onClick={() => ack.mutate(a.id)} disabled={ack.isPending}>
                            <Check /> Ack
                          </Button>
                        )}
                        <DisabledAction size="sm" variant="ghost" reason="alarms clear automatically when the condition recovers">
                          <X /> Clear
                        </DisabledAction>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {!loading && rows.length === 0 && <Empty icon={<BellRing />}>Nothing here — the network is quiet.</Empty>}
          {loading && <Empty>Loading…</Empty>}
        </div>
      </PageBody>
    </div>
  );
}
