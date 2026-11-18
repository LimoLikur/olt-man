import type { OltSummary } from '@olt/shared/dto';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../api';
import { plural } from '../format';
import { useMe } from '../auth';
import { Panel } from './app/panel';
import { Button, Callout, Field, Input } from './ui';

/**
 * Deletes an OLT and everything the app stored for it (SPEC §8.4). Admin or NOC re-types the
 * name; an OLT whose identity change is not accepted yet is admin-only (enforced by the api).
 */
export function DeleteOltPanel({ olt }: { olt: OltSummary }) {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [confirmName, setConfirmName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: () => api.delete(`/olts/${olt.id}`, { confirmName }),
    onSuccess: () => {
      // Leave the page first, so its queries do not refetch a deleted OLT.
      navigate('/');
      qc.removeQueries({ queryKey: ['olt', String(olt.id)] });
      qc.removeQueries({ queryKey: ['identity', olt.id] });
      void qc.invalidateQueries({ queryKey: ['olts'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed.'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (confirmName !== olt.name) return setError('The OLT name does not match.');
    remove.mutate();
  };
  const adminOnly = olt.identityProblem && me.role !== 'admin';
  const hasData = olt.onus.total > 0 || olt.lastPollOkAt !== null;

  return (
    <Panel title="Delete OLT" icon={Trash} tone="critical" testId="delete-olt-panel">
      {hasData ? (
        <p className="text-sm text-muted-foreground">
          Everything the app stored for this OLT is deleted permanently: <b className="text-foreground">{plural(olt.onus.total, 'ONU')}</b> with their status history and Rx metrics,{' '}
          <b className="text-foreground">{plural(olt.activeAlarms, 'active alarm')}</b> and the alarm history, the job history and the pinned identity. The audit log is kept.
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">This OLT has no polling data yet. Identity candidates and probe history are deleted too; the deletion is still recorded in the audit log.</p>
      )}
      <p className="mt-1 text-sm text-muted-foreground">Deleting changes nothing on the OLT itself. If it is registered again, its identity must be pinned again.</p>
      {adminOnly ? (
        <Callout tone="warning" className="mt-3">
          This OLT's identity changed and the change is not accepted yet. Only an admin (from the office network) can delete it.
        </Callout>
      ) : !open ? (
        <Button variant="outline-destructive" className="mt-3" onClick={() => setOpen(true)}>
          <Trash /> Delete OLT…
        </Button>
      ) : (
        <form role="dialog" aria-label="Delete OLT" onSubmit={submit} className="mt-3 flex max-w-xl flex-col gap-3 rounded-xl border border-critical/20 bg-critical-soft p-4">
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
            <Button type="submit" variant="destructive" disabled={remove.isPending}>
              Delete permanently
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Panel>
  );
}
