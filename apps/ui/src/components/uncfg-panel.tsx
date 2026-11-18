import type { OltSummary } from '@olt/shared/dto';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Radar, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError } from '../api';
import { ago, dateTime } from '../format';
import { Panel } from './app/panel';
import { NAValue, Pill } from './app/status';
import { Button, cx } from './ui';

interface UncfgOnu {
  slot: number;
  port: number;
  index: number;
  sn: string;
  state: string;
}
interface Scan {
  jobId: number;
  status: string;
  at: string;
  onus: UncfgOnu[];
  error: string | null;
}

const SCAN_ERRORS: Record<string, string> = {
  cli_disabled: 'CLI is not enabled for this OLT.',
  cli_unavailable: 'The OLT CLI is not available (sessions full or unreachable). Try again later.',
  cli_auth_failed: 'The OLT refused the CLI login.',
  host_key_not_pinned: "The OLT's SSH host key is not pinned yet.",
  host_key_mismatch: "The OLT's SSH host key changed; the OLT is quarantined.",
  parse_failed: 'The output of "show gpon onu uncfg" was not recognized.',
};

type Pick = (oltId: number, slot: number, port: number, sn: string) => void;

/** Fase 2: unregistered ONUs per OLT (latest `show gpon onu uncfg`), each one a click away from the form. */
export function UncfgPanel({ olts, onPick, selectedSn }: { olts: OltSummary[]; onPick: Pick; selectedSn: string }) {
  return (
    <Panel title="Unregistered ONUs" icon={Radar} tone="primary" flush testId="uncfg-panel" action={<Pill tone="neutral">uncfg</Pill>}>
      <p className="border-b px-4 py-3 text-xs text-muted-foreground">
        “Refresh” runs <code className="font-mono">show gpon onu uncfg</code> on the OLT (read-only). “Use” fills in the form with the OLT, port and serial number.
      </p>
      {olts.length === 0 ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">No OLT has CLI enabled yet.</p> : olts.map((o) => <OltUncfg key={o.id} olt={o} onPick={onPick} selectedSn={selectedSn} />)}
    </Panel>
  );
}

function OltUncfg({ olt, onPick, selectedSn }: { olt: OltSummary; onPick: Pick; selectedSn: string }) {
  const qc = useQueryClient();
  const scan = useQuery({ queryKey: ['uncfg', olt.id], queryFn: async () => (await api.get<{ scan: Scan | null }>(`/olts/${olt.id}/uncfg`)).scan });
  const [jobId, setJobId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useMutation({
    mutationFn: () => api.post<{ jobId: number }>(`/olts/${olt.id}/uncfg/scan`),
    onMutate: () => setError(null),
    onSuccess: (r) => setJobId(r.jobId),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed.'),
  });
  // Follow the scan until it finishes, then reload the list.
  useQuery({
    queryKey: ['job', jobId],
    enabled: jobId !== null,
    refetchInterval: 1000,
    queryFn: async () => {
      const job = await api.get<{ status: string }>(`/jobs/${jobId}`);
      if (['succeeded', 'failed', 'blocked', 'cancelled'].includes(job.status)) {
        setJobId(null);
        await qc.invalidateQueries({ queryKey: ['uncfg', olt.id] });
      }
      return job;
    },
  });
  const s = scan.data;
  const busy = jobId !== null || refresh.isPending;

  return (
    <section className="border-b last:border-b-0" data-testid={`uncfg-olt-${olt.id}`}>
      <div className="flex flex-wrap items-center gap-2 bg-muted/40 px-4 py-2">
        <h3 className="text-sm font-medium">{olt.name}</h3>
        <span className="text-xs text-muted-foreground" title={s ? dateTime(s.at) : undefined}>
          {s ? `scanned ${ago(s.at)}` : 'never scanned'}
        </span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => refresh.mutate()} disabled={busy}>
          <RefreshCw className={cx(busy && 'animate-spin')} /> {busy ? 'Scanning…' : 'Refresh'}
        </Button>
      </div>
      {error && (
        <p role="alert" className="px-4 pt-2 text-sm text-critical">
          {error}
        </p>
      )}
      {s?.error && (
        <p className="px-4 pt-2 text-sm text-critical">
          Last scan failed: {SCAN_ERRORS[s.error] ?? s.error}
        </p>
      )}
      {s && !s.error && s.onus.length === 0 && <p className="px-4 py-4 text-sm text-muted-foreground">No uncfg ONUs.</p>}
      {s && s.onus.length > 0 && (
        <ul className="divide-y">
          {s.onus.map((u) => {
            const picked = selectedSn === u.sn;
            return (
              <li key={`${u.slot}/${u.port}:${u.index}`} className={cx('flex items-center gap-3 px-4 py-3', picked && 'bg-primary-soft')}>
                <div className="min-w-0 flex-1">
                  <div className="font-mono text-[13px] font-medium">{u.sn}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    PON 1/{u.slot}/{u.port} · {u.state}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    Rx <NAValue />
                  </div>
                </div>
                <Button size="sm" variant={picked ? 'primary' : 'outline'} onClick={() => onPick(olt.id, u.slot, u.port, u.sn)}>
                  {picked ? 'Selected' : 'Use'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
