import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ListChecks, Send, SquareTerminal, X } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, ApiError } from '../api';
import { useMe } from '../auth';
import { PageBody, PageHeader, Panel } from '../components/app/panel';
import { Pill, type PillTone } from '../components/app/status';
import { Button, Callout, Field, Input, Loading } from '../components/ui';
import { dateTime, JOB_KIND_LABEL, JOB_STATUS_LABEL } from '../format';

export interface JobView {
  id: number;
  oltId: number;
  kind: string;
  status: string;
  params: Record<string, unknown>;
  preview: string | null;
  previewSha256: string | null;
  result: { error?: string; message?: string; saved?: boolean; rejectReason?: string } | null;
  appliedCommands?: string[] | null;
  createdAt: string;
  updatedAt: string;
  requestedBy?: number | null;
}

const DONE = new Set(['succeeded', 'failed', 'blocked', 'cancelled', 'rejected']);
const statusTone = (s: string): PillTone => (s === 'succeeded' ? 'success' : s === 'pending_approval' || s === 'preview' ? 'warning' : DONE.has(s) ? 'critical' : 'info');

export function JobPage() {
  const { id } = useParams();
  const me = useMe();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['job', id], queryFn: () => api.get<JobView>(`/jobs/${id}`), refetchInterval: (query) => (query.state.data && DONE.has(query.state.data.status) ? false : 1000) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['job', id] });
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : 'Failed.');
  const confirm = useMutation({ mutationFn: () => api.post(`/jobs/${id}/confirm`, { previewSha256: q.data!.previewSha256 }), onSuccess: refresh, onError: fail });
  const cancel = useMutation({ mutationFn: () => api.post(`/jobs/${id}/cancel`), onSuccess: refresh, onError: fail });
  const approve = useMutation({ mutationFn: () => api.post(`/jobs/${id}/approve`, { previewSha256: q.data!.previewSha256 }), onSuccess: refresh, onError: fail });
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const reject = useMutation({ mutationFn: () => api.post(`/jobs/${id}/reject`, { reason }), onSuccess: refresh, onError: fail });
  if (!q.data) return <Loading>{q.isError ? 'Job not found.' : 'Loading…'}</Loading>;
  const j = q.data;
  // A reboot runs once its owner, whatever the role, confirms it (owner decision 2026-11-27); the api checks ownership.
  const reboot = j.kind === 'onu_reboot';
  const canConfirm = j.status === 'preview' && (reboot || (me.role !== 'noc' && (me.role === 'admin' || j.kind === 'onu_register')));
  const canApprove = j.status === 'pending_approval' && (me.role === 'admin' || me.role === 'noc');
  const canCancel = (reboot || me.role !== 'noc') && (j.status === 'preview' || j.status === 'pending_approval' || j.status === 'confirmed');

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {JOB_KIND_LABEL[j.kind] ?? j.kind} #{j.id}
            <Pill tone={statusTone(j.status)} dot pulse={!DONE.has(j.status) && j.status !== 'preview' && j.status !== 'pending_approval'}>
              <span data-testid="job-status">{JOB_STATUS_LABEL[j.status] ?? j.status}</span>
            </Pill>
          </span>
        }
        subtitle={
          <>
            Created {dateTime(j.createdAt)} · last updated {dateTime(j.updatedAt)} ·{' '}
            <Link className="text-primary hover:underline" to={`/olts/${j.oltId}`}>
              view OLT
            </Link>
          </>
        }
      />
      <PageBody>
        {j.result?.message && (
          <Callout role="alert" tone={j.status === 'succeeded' ? 'warning' : 'critical'}>
            {j.result.message}
          </Callout>
        )}
        {j.status === 'succeeded' && reboot && (
          <Callout role="status" tone="success" icon={<Check />}>
            The OLT accepted the reboot. The ONU restarts and is offline for about 1–2 minutes.
          </Callout>
        )}
        {j.status === 'succeeded' && j.result?.saved === true && (
          <Callout role="status" tone="success" icon={<Check />}>
            Verified and saved on the OLT (<code>write</code>).
          </Callout>
        )}
        {j.result?.error && !j.result.message && (
          <Callout role="alert" tone="critical">
            Error: {j.result.error}
          </Callout>
        )}
        {j.status === 'rejected' && j.result?.rejectReason && <Callout tone="critical">Rejected: {j.result.rejectReason}</Callout>}

        <div className="grid items-start gap-6 lg:grid-cols-2">
          {j.preview && (
            <Panel title="Confirmed preview" icon={SquareTerminal} tone="primary">
              <pre data-testid="job-preview" className="mb-2 overflow-x-auto rounded-lg bg-code p-3 font-mono text-xs text-code-foreground">
                {j.preview}
              </pre>
              <p className="break-all text-xs text-muted-foreground">sha256: {j.previewSha256}</p>
            </Panel>
          )}
          {j.appliedCommands && (
            <Panel title={`Commands sent (${j.appliedCommands.length})`} icon={ListChecks} tone="success">
              <pre data-testid="job-applied" className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">
                {j.appliedCommands.join('\n')}
              </pre>
            </Panel>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-critical">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {canConfirm && (
            <Button onClick={() => confirm.mutate()} disabled={confirm.isPending}>
              <Send /> {me.role === 'teknisi' && !reboot ? 'Submit to NOC' : 'Confirm and run'}
            </Button>
          )}
          {canApprove && (
            <Button onClick={() => approve.mutate()} disabled={approve.isPending}>
              <Check /> Approve and run
            </Button>
          )}
          {canApprove && !rejecting && (
            <Button variant="outline-destructive" onClick={() => setRejecting(true)}>
              <X /> Reject…
            </Button>
          )}
          {canCancel && (
            <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
              Cancel job
            </Button>
          )}
        </div>
        {canApprove && rejecting && (
          <form
            role="dialog"
            aria-label="Reject registration"
            className="flex max-w-xl flex-col gap-3 rounded-xl border border-critical/20 bg-critical-soft p-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (reason.trim().length < 5) return setError('A rejection reason is required (at least 5 characters).');
              reject.mutate();
            }}
          >
            <Field label="Rejection reason (visible to the technician and recorded in the audit log)">
              <Input name="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" disabled={reject.isPending}>
                Reject registration
              </Button>
              <Button variant="outline" onClick={() => setRejecting(false)}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </PageBody>
    </div>
  );
}
