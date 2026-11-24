import { useQuery } from '@tanstack/react-query';
import { Check, Clock } from 'lucide-react';
import { Link } from 'react-router';
import { api } from '../api';
import { PageBody, PageHeader } from '../components/app/panel';
import { RegistrationTabs } from '../components/app/registration-tabs';
import { NAValue, Pill } from '../components/app/status';
import { buttonClass, Empty } from '../components/ui';
import { ago, dateTime, plural, PROVISION_MODE_LABEL } from '../format';

interface PendingJob {
  id: number;
  oltId: number;
  oltName: string;
  kind: string;
  params: {
    mode?: string;
    slot?: number;
    port?: number;
    onuId?: number;
    sn?: string;
    name?: string;
    vlan?: number;
    onuType?: string;
    tcontProfile?: string;
    description?: string;
    lanPorts?: number;
    pppoeUsername?: string;
    bridgeTcontProfile?: string;
    bridgeVlan?: number;
  };
  requestedBy: string | null;
  createdAt: string;
  submittedAt: string;
}

/** NOC/admin: teknisi ONU registrations waiting for approval. Approve or reject on the job page. */
export function ApprovalsPage() {
  const q = useQuery({ queryKey: ['approvals'], queryFn: () => api.get<PendingJob[]>('/approvals'), refetchInterval: 5000 });
  const rows = q.data ?? [];
  return (
    <div>
      <PageHeader
        title="Approvals"
        subtitle="Technicians' ONU registrations reach the OLT only after approval. Open the job to review the exact commands before approving or rejecting."
      />
      <PageBody>
        <RegistrationTabs current="approvals" />
        {rows.length === 0 ? (
          <div className="panel">
            <Empty icon={<Check className="text-success" />}>{q.isError ? 'Only NOC engineers and admins can review registrations.' : q.isLoading ? 'Loading…' : 'No requests waiting for review.'}</Empty>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {rows.map((j) => (
              <div key={j.id} className="panel p-4" data-testid="approval-row">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-[15px] font-medium">{j.params.sn ?? '—'}</div>
                    <div className="mt-0.5 text-sm text-muted-foreground">
                      {j.params.name ?? '—'} · ID <NAValue />
                    </div>
                  </div>
                  <Pill tone="warning" dot>
                    Pending
                  </Pill>
                </div>
                <div className="divider-dashed my-4" />
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground">OLT</dt>
                    <dd className="font-medium">{j.oltName}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">PON / ONU ID</dt>
                    <dd className="font-mono">
                      1/{j.params.slot}/{j.params.port}:{j.params.onuId}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">ONU type</dt>
                    <dd>{j.params.onuType ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">T-CONT profile</dt>
                    <dd>
                      <span className="tag-mono">{j.params.tcontProfile ?? '—'}</span> <span className="font-mono text-xs text-muted-foreground">VLAN {j.params.vlan ?? '—'}</span>
                      {/* Bridge Static: the bridging service's own T-CONT profile and VLAN (vport 2). */}
                      {j.params.mode === 'bridge_static' && (
                        <span className="mt-1 block">
                          <span className="tag-mono">{j.params.bridgeTcontProfile ?? '—'}</span>{' '}
                          <span className="font-mono text-xs text-muted-foreground">bridge VLAN {j.params.bridgeVlan ?? '—'}</span>
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Mode</dt>
                    <dd className="flex flex-wrap items-center gap-1.5">
                      {/* A job without a mode is `default` (SPEC §8.5). */}
                      <Pill tone={(j.params.mode ?? 'default') === 'default' ? 'neutral' : 'info'}>{PROVISION_MODE_LABEL[j.params.mode ?? 'default'] ?? j.params.mode}</Pill>
                      {(j.params.mode === 'bridge' || j.params.mode === 'bridge_static') && <span className="text-xs text-muted-foreground">{plural(j.params.lanPorts ?? 0, 'LAN port')}</span>}
                      {(j.params.mode === 'pppoe_map' || j.params.mode === 'pppoe_jgl') && <span className="font-mono text-xs text-muted-foreground">{j.params.pppoeUsername ?? '—'}</span>}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Description</dt>
                    <dd>{j.params.description ?? '—'}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground">Address</dt>
                    <dd>
                      <NAValue />
                    </dd>
                  </div>
                </dl>
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
                  <Clock className="size-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground" title={dateTime(j.submittedAt)}>
                    {j.requestedBy ?? '—'} · {ago(j.submittedAt)}
                  </span>
                  <Link className={buttonClass('primary', 'sm', 'ml-auto')} to={`/jobs/${j.id}`}>
                    Review job #{j.id}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </PageBody>
    </div>
  );
}
