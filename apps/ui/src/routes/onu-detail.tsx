import type { OnuView } from '@olt/shared/dto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, ClockArrowLeft, Copy, Gauge, Info, MoveHorizontal, Power, Radio, RefreshCw, Signal } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, ApiError } from '../api';
import { RxChart, type RxPoint } from '../components/app/charts';
import { KeyValue, PageBody, PageHeader, Panel, StatCard, type Tone } from '../components/app/panel';
import { DisabledAction, MockBadge, NAValue, PhaseBadge, RxValue } from '../components/app/status';
import { Button, buttonClass, Callout, cx, Empty, Loading, Segmented, Table, Td, Th } from '../components/ui';
import { ago, dateTime, dbm, duration, onuStatusText, PHASE_LABEL } from '../format';
import { useOlts } from '../queries';
import { RX_CRITICAL, RX_WARNING, rxLevel } from '../signal';

interface History {
  index: number;
  authpassTime: string;
  offlineTime: string | null;
  cause: string | null;
}
interface OnuDetail extends OnuView {
  lastDetail: null | {
    jobId: number;
    at: string;
    detail?: { distanceM: number | null; onlineDurationS: number | null; history: History[] };
    attenuation?: {
      upstream: { oltRxDbm: number | null; onuTxDbm: number | null; attenuationDb: number | null };
      downstream: { oltTxDbm: number | null; onuRxDbm: number | null; attenuationDb: number | null };
    };
  };
}
interface Job {
  status: string;
  result: { error?: string; reason?: string; screen?: string } | null;
}
interface OnuEvent {
  id: number;
  ts: string;
  kind: string;
  from: string | null;
  to: string | null;
}

const JOB_ERRORS: Record<string, string> = {
  cli_unavailable: 'The OLT CLI is not available (sessions full or unreachable). Try again later.',
  cli_auth_failed: 'The OLT refused the CLI login. Contact an admin.',
  host_key_not_pinned: "The OLT's SSH host key is not pinned by an admin yet.",
  host_key_mismatch: "The OLT's SSH host key changed; an admin must check the OLT.",
  cli_disabled: 'CLI is not enabled for this OLT.',
  ssh_negotiation_failed: 'The OLT rejected the app\'s SSH algorithms. An admin needs to set "Legacy SSH algorithms" on the OLT page.',
  ssh_algorithms_invalid: "This OLT's SSH algorithm setting is invalid. Contact an admin.",
};

const LEVEL_TONE: Record<ReturnType<typeof rxLevel>, Tone> = { good: 'success', warning: 'warning', critical: 'critical', none: 'neutral' };
const EVENT_DOT: Record<string, string> = { working: 'bg-success', los: 'bg-critical', dying_gasp: 'bg-orange', offline: 'bg-muted-foreground/60' };
const DAY = 24 * 3600_000;

const fixed = (v: number | null | undefined) => (v === null || v === undefined ? '—' : v.toFixed(2));

export function OnuDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [jobId, setJobId] = useState<number | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'neutral' | 'success' | 'critical' } | null>(null);
  const [range, setRange] = useState<'24h' | '7d'>('24h');
  const [metric, setMetric] = useState<'rx' | 'tx'>('rx');
  const [copied, setCopied] = useState(false);
  const olts = useOlts();
  const onu = useQuery({ queryKey: ['onu', id], queryFn: () => api.get<OnuDetail>(`/onus/${id}`) });
  const metrics = useQuery({
    queryKey: ['onu', id, 'metrics', range],
    queryFn: () => api.get<RxPoint[]>(`/onus/${id}/metrics?${new URLSearchParams({ from: new Date(Date.now() - (range === '24h' ? DAY : 7 * DAY)).toISOString() })}`),
    // poll.optical runs every 5 minutes; no need to reload up to 2000 points every 10 s.
    refetchInterval: 60_000,
  });
  const events = useQuery({ queryKey: ['onu', id, 'events'], queryFn: () => api.get<OnuEvent[]>(`/onus/${id}/events`) });

  // Follow the refresh job until it finishes, then reload the ONU.
  useQuery({
    queryKey: ['job', jobId],
    enabled: jobId !== null,
    refetchInterval: 1000,
    queryFn: async () => {
      const job = await api.get<Job>(`/jobs/${jobId}`);
      if (['succeeded', 'failed', 'blocked', 'cancelled'].includes(job.status)) {
        setJobId(null);
        const why = job.result?.reason ? ` Reason: ${job.result.reason}.` : '';
        const screen = job.result?.screen ? ` Last OLT screen: "${job.result.screen.trim().slice(-200)}"` : '';
        setMessage(
          job.status === 'succeeded'
            ? { text: 'ONU details updated.', tone: 'success' }
            : { text: `${JOB_ERRORS[job.result?.error ?? ''] ?? 'Refresh failed.'}${why}${screen}`, tone: 'critical' },
        );
        await qc.invalidateQueries({ queryKey: ['onu', id] });
      }
      return job;
    },
  });
  const refresh = useMutation({
    mutationFn: () => api.post<{ jobId: number }>(`/onus/${id}/refresh`),
    onSuccess: (r) => {
      setMessage({ text: 'Fetching details from the OLT…', tone: 'neutral' });
      setJobId(r.jobId);
    },
    onError: (e) => setMessage({ text: e instanceof ApiError ? e.message : 'Refresh failed.', tone: 'critical' }),
  });

  if (!onu.data) return <Loading>{onu.isError ? 'ONU not found.' : 'Loading…'}</Loading>;
  const o = onu.data;
  const d = o.lastDetail;
  const att = d?.attenuation;
  const isMock = olts.data?.find((x) => x.id === o.oltId)?.isMock ?? false;
  const level = o.oltStatus === 'ok' ? rxLevel(o.rxDbm) : 'none';
  const points = metrics.data ?? [];
  const rx = points.map((p) => p.rxDbm).filter((v): v is number => v !== null);
  const avgRx = rx.length ? rx.reduce((a, b) => a + b, 0) / rx.length : null;
  const minRx = rx.length ? Math.min(...rx) : null;
  const copy = async () => {
    await navigator.clipboard?.writeText(o.sn).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      <PageHeader
        leading={
          <Link to="/onus" aria-label="Back to the list" className={buttonClass('outline', 'icon')}>
            <ArrowLeft />
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">{o.sn}</span>
            <PhaseBadge phase={o.phase} oltStatus={o.oltStatus} text={onuStatusText(o.phase, o.oltStatus, o.updatedAt)} />
            {isMock && <MockBadge />}
          </span>
        }
        subtitle={
          <>
            {o.name ?? `ONU ${o.onuIndex}`} · ID <NAValue title="Customer ID: not available in OLT-MAN" /> · {o.oltName} 1/{o.slot}/{o.port}:{o.onuIndex}
          </>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => void copy()}>
              {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy SN'}
            </Button>
            <Button onClick={() => refresh.mutate()} disabled={jobId !== null || refresh.isPending}>
              <RefreshCw className={cx(jobId !== null && 'animate-spin')} /> {jobId !== null ? 'Loading…' : 'Refresh from OLT'}
            </Button>
            <DisabledAction reason="ONU reboot is outside the project scope (SPEC §11)">
              <Power /> Reboot ONU
            </DisabledAction>
          </>
        }
      />

      <PageBody>
        {message && (
          <Callout role="status" tone={message.tone}>
            {message.text}
          </Callout>
        )}

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="ONU Rx power"
            icon={Signal}
            tone={LEVEL_TONE[level]}
            value={<RxValue value={o.rxDbm} unit={false} className="font-sans text-[28px]" />}
            chip={level === 'none' ? 'No reading' : level === 'good' ? 'dBm · in range' : 'dBm · low'}
          />
          <StatCard title="ONU Tx power" icon={Radio} tone="primary" value={fixed(att?.upstream.onuTxDbm)} chip="dBm" hint={d ? `From CLI, ${ago(d.at)}` : 'Use “Refresh from OLT”'} />
          <StatCard title="OLT Rx power" icon={Gauge} tone="info" value={fixed(o.oltRxDbm)} chip="dBm" />
          <StatCard
            title="Fiber distance"
            icon={MoveHorizontal}
            tone="neutral"
            value={d?.detail?.distanceM === null || d?.detail?.distanceM === undefined ? '—' : (d.detail.distanceM / 1000).toFixed(2)}
            chip="km"
            hint={d ? `From CLI, ${ago(d.at)}` : 'Use “Refresh from OLT”'}
          />
        </div>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Panel
            title="Optical signal"
            icon={Signal}
            tone="primary"
            action={
              <Segmented
                label="Range"
                value={range}
                onChange={setRange}
                items={[
                  { value: '24h', label: '24 hours' },
                  { value: '7d', label: '7 days' },
                ]}
              />
            }
          >
            <div className="mb-4 flex flex-wrap items-end gap-6 text-sm">
              <div>
                <div className="text-muted-foreground">Average Rx</div>
                <div className="font-mono font-medium">{dbm(avgRx)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Lowest Rx</div>
                <RxValue value={minRx} className="font-medium" />
              </div>
              {metric === 'rx' && (
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 border-t-2 border-dashed border-warning" />
                    Warning {RX_WARNING}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 border-t-2 border-dashed border-critical" />
                    Critical {RX_CRITICAL}
                  </span>
                </div>
              )}
              <div className="ml-auto">
                <Segmented
                  label="Metric"
                  value={metric}
                  onChange={setMetric}
                  items={[
                    { value: 'rx', label: 'Rx power' },
                    { value: 'tx', label: 'Tx power' },
                  ]}
                />
              </div>
            </div>
            {metric === 'tx' ? (
              <Empty icon={<Radio />}>
                <NAValue /> — Tx power history is not recorded. The latest ONU Tx comes from “Refresh from OLT”.
              </Empty>
            ) : points.length > 0 ? (
              <RxChart points={points} range={range} />
            ) : (
              <Empty icon={<Signal />}>{metrics.isLoading ? 'Loading…' : `No optical data in the last ${range === '24h' ? '24 hours' : '7 days'}.`}</Empty>
            )}
          </Panel>

          <div className="min-w-0 space-y-6">
            <Panel title="Details" icon={Info} tone="neutral">
              <dl className="divide-y divide-dashed">
                <KeyValue label="Customer">{o.name ?? '—'}</KeyValue>
                <KeyValue label="Address">
                  <NAValue />
                </KeyValue>
                <KeyValue label="OLT">
                  <Link to={`/olts/${o.oltId}`} className="text-primary hover:underline">
                    {o.oltName}
                  </Link>
                </KeyValue>
                <KeyValue label="PON / ONU ID" mono>
                  1/{o.slot}/{o.port}:{o.onuIndex}
                </KeyValue>
                <KeyValue label="Model">{o.type ?? '—'}</KeyValue>
                <KeyValue label="Firmware">
                  <NAValue />
                </KeyValue>
                <KeyValue label="Service profile">
                  <NAValue />
                </KeyValue>
                <KeyValue label="VLAN">
                  <NAValue />
                </KeyValue>
                <KeyValue label="Description">{o.description ?? '—'}</KeyValue>
                <KeyValue label="Admin state">{o.adminState ?? '—'}</KeyValue>
                <KeyValue label="Attenuation up / down">
                  {fixed(att?.upstream.attenuationDb)} / {fixed(att?.downstream.attenuationDb)} dB
                </KeyValue>
                <KeyValue label="OLT Tx power">{dbm(att?.downstream.oltTxDbm)}</KeyValue>
                <KeyValue label="Online duration">{duration(d?.detail?.onlineDurationS)}</KeyValue>
                <KeyValue label="Registered">
                  <NAValue />
                </KeyValue>
                <KeyValue label="Last change">{dateTime(o.lastChangeAt)}</KeyValue>
                <KeyValue label="Updated">{dateTime(o.updatedAt)}</KeyValue>
                <KeyValue label="CLI details">{d ? dateTime(d.at) : '—'}</KeyValue>
              </dl>
            </Panel>

            <Panel title="Recent events" icon={ClockArrowLeft} tone="neutral" flush>
              {events.data?.length ? (
                <ul className="max-h-96 divide-y overflow-y-auto">
                  {events.data.slice(0, 30).map((e) => (
                    <li key={e.id} className="flex items-start gap-3 px-4 py-3">
                      <span className={cx('mt-1.5 size-1.5 shrink-0 rounded-full', EVENT_DOT[e.to ?? ''] ?? 'bg-info')} />
                      <div className="min-w-0 text-sm">
                        <div className="font-medium">
                          {e.kind === 'state_change' ? `${PHASE_LABEL[e.from ?? ''] ?? e.from ?? '—'} → ${PHASE_LABEL[e.to ?? ''] ?? e.to ?? '—'}` : e.kind.replace(/_/g, ' ')}
                        </div>
                        <div className="text-xs text-muted-foreground" title={dateTime(e.ts)}>
                          {ago(e.ts)}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>No status changes yet.</Empty>
              )}
            </Panel>
          </div>
        </div>

        <Panel title="Offline history (from OLT)" icon={ClockArrowLeft} tone="neutral" flush>
          {d?.detail?.history?.length ? (
            <Table>
              <thead>
                <tr>
                  <Th>#</Th>
                  <Th>Online since</Th>
                  <Th>Offline at</Th>
                  <Th>Cause</Th>
                </tr>
              </thead>
              <tbody>
                {d.detail.history.map((h) => (
                  <tr key={h.index} data-testid="offline-history-row">
                    <Td className="numeric">{h.index}</Td>
                    <Td className="font-mono text-[13px]">{h.authpassTime}</Td>
                    <Td className="font-mono text-[13px]">{h.offlineTime ?? 'still online'}</Td>
                    <Td>{h.cause ?? '—'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty>None yet. Click “Refresh from OLT”.</Empty>
          )}
        </Panel>
      </PageBody>
    </div>
  );
}
