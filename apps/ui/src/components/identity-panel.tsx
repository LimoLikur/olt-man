import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FingerprintPattern, RefreshCw } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { api, ApiError } from '../api';
import { useMe } from '../auth';
import { dateTime } from '../format';
import { type Identity, IDENTITY_KIND_LABEL, type IdentityRow, probeState, probeText } from '../identity';
import { can } from '../permissions';
import { useIdentity, usePinIdentity } from '../queries';
import { Panel } from './app/panel';
import { Button, Callout, Field, Input } from './ui';

/** Pins, candidates and history; probe and pin for admin and NOC, accept-change for admins (SPEC §8.4). */
export function IdentityPanel({ oltId }: { oltId: number }) {
  const me = useMe();
  const qc = useQueryClient();
  const isAdmin = can(me.role, 'adminOlts');
  const canPin = can(me.role, 'manageOlts');
  const q = useIdentity(oltId, { enabled: me.role !== 'teknisi', refetchInterval: 3000 });
  const [error, setError] = useState<string | null>(null);
  const done = async () => {
    setError(null);
    await qc.invalidateQueries({ queryKey: ['identity', oltId] });
    await qc.invalidateQueries({ queryKey: ['olt', String(oltId)] });
  };
  const fail = (e: unknown) => setError(e instanceof ApiError ? e.message : 'Failed.');
  const pin = usePinIdentity(oltId);
  const probe = useMutation({ mutationFn: () => api.post(`/olts/${oltId}/identity/probe`), onSuccess: done, onError: fail });

  if (me.role === 'teknisi' || !q.data) return null;
  const { olt, pinned, candidates, retired, lastProbe } = q.data;
  const quarantined = olt.status === 'quarantined';
  const probeStatus = probeState(lastProbe);

  return (
    <Panel
      title="OLT identity"
      icon={FingerprintPattern}
      tone={quarantined ? 'critical' : 'neutral'}
      testId="identity-panel"
      action={
        canPin &&
        !quarantined && (
          <Button variant="outline" size="sm" onClick={() => probe.mutate()} disabled={probe.isPending}>
            <RefreshCw /> Probe again
          </Button>
        )
      }
    >
      {quarantined && (
        <Callout tone="critical" className="mb-4">
          The observed identity differs from the pinned one. Polling and CLI are stopped. Compare the candidates below with the OLT console before accepting the change.
        </Callout>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Rows title="Pinned" testId="identity-pinned" rows={pinned} empty="None yet." />
        <Rows title={quarantined ? 'Observed (differs from the pin)' : 'Candidates from probe'} testId="identity-candidates" rows={candidates} empty={<span className={probeStatus === 'failed' || probeStatus === 'stalled' ? 'text-critical' : undefined}>{probeText(lastProbe)}</span>} highlight />
      </div>
      {retired.length > 0 && (
        <div className="mt-4">
          <Rows title="History (retired)" testId="identity-retired" rows={retired} />
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-critical">
          {error}
        </p>
      )}
      {canPin && !quarantined && candidates.length > 0 && (
        <Button className="mt-4" onClick={() => pin.mutate(undefined, { onSuccess: done, onError: fail })} disabled={pin.isPending}>
          Pin candidate
        </Button>
      )}
      {isAdmin && quarantined && <AcceptChange olt={olt} onDone={done} />}
    </Panel>
  );
}

function Rows({ title, testId, rows, empty, highlight }: { title: string; testId: string; rows: IdentityRow[]; empty?: ReactNode; highlight?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="section-label mb-2">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.id} className={`rounded-lg border px-3 py-2 text-sm ${highlight ? 'border-primary/25 bg-primary-soft/50' : 'bg-muted/30'}`} data-testid={testId}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{IDENTITY_KIND_LABEL[r.kind]}</span>
                {r.algo && <span className="tag-mono">{r.algo}</span>}
                <span className="ml-auto text-xs text-muted-foreground">{dateTime(r.pinnedAt ?? r.createdAt)}</span>
              </div>
              <code className="mt-1 block break-all font-mono text-xs">{r.value}</code>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AcceptChange({ olt, onDone }: { olt: Identity['olt']; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const accept = useMutation({
    mutationFn: () => api.post(`/olts/${olt.id}/identity/accept-change`, { reason, confirmName }),
    onSuccess: async () => {
      setOpen(false);
      await onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed.'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (confirmName !== olt.name) return setError('The OLT name does not match.');
    if (reason.trim().length < 5) return setError('A reason is required (at least 5 characters).');
    accept.mutate();
  };
  if (!open)
    return (
      <Button className="mt-4" onClick={() => setOpen(true)}>
        Accept change…
      </Button>
    );
  return (
    <form role="dialog" aria-label="Accept identity change" onSubmit={submit} className="mt-4 flex max-w-xl flex-col gap-3 rounded-xl border border-critical/20 bg-critical-soft p-4">
      <Field label="Reason (recorded in the audit log)">
        <Input name="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field
        label={
          <>
            Type the OLT name to confirm: <b>{olt.name}</b>
          </>
        }
      >
        <Input name="confirmName" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />
      </Field>
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={accept.isPending}>
          Accept and resume polling
        </Button>
        <Button variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
