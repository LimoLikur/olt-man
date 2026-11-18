import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, TriangleExclamationPoint } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, ApiError } from '../api';
import { dateTime } from '../format';
import { Panel } from './app/panel';
import { Button, Callout } from './ui';

interface Change {
  jobId: number;
  actor: string | null;
  at: string | null;
  appliedCommands: string[] | null;
  before: { portRunningConfig?: string } | null;
  after: { portRunningConfig?: string; onuRunningConfig?: string; onuMngConfig?: string } | null;
}

/** Admin: Fase 2 changes not saved with `write` yet (SPEC §8.5). */
export function UnsavedPanel({ oltId }: { oltId: number }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['unsaved', oltId], queryFn: () => api.get<Change[]>(`/olts/${oltId}/unsaved-changes`) });
  const save = useMutation({
    mutationFn: async () => {
      const job = await api.post<{ id: number; previewSha256: string }>(`/olts/${oltId}/save-config`);
      await api.post(`/jobs/${job.id}/confirm`, { previewSha256: job.previewSha256 });
      return job.id;
    },
    onSuccess: async (jobId) => {
      await qc.invalidateQueries({ queryKey: ['unsaved', oltId] });
      navigate(`/jobs/${jobId}`);
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed.'),
  });
  if (!q.data) return null;
  return (
    <Panel title={`Unsaved changes (${q.data.length})`} icon={Save} tone={q.data.length ? 'warning' : 'neutral'} testId="unsaved-panel">
      {q.data.length === 0 ? (
        <p className="text-sm text-muted-foreground" data-testid="unsaved-empty">
          None. The running config matches the saved one (as far as changes from this app go).
        </p>
      ) : (
        <>
          <Callout tone="warning" icon={<TriangleExclamationPoint />} className="mb-4">
            <code>write</code> saves the <b>entire</b> running config of the OLT, including changes made outside this app.
          </Callout>
          <ul className="mb-4 flex flex-col gap-3">
            {q.data.map((c) => (
              <li key={c.jobId} data-testid="unsaved-change" className="rounded-lg border p-3 text-sm">
                <p className="mb-2">
                  <Link className="font-medium text-primary hover:underline" to={`/jobs/${c.jobId}`}>
                    Job #{c.jobId}
                  </Link>{' '}
                  <span className="text-muted-foreground">
                    by {c.actor ?? '—'} · {dateTime(c.at)}
                  </span>
                </p>
                <div className="grid gap-2 md:grid-cols-2">
                  <div>
                    <p className="section-label mb-1">Before (port)</p>
                    <pre className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">{c.before?.portRunningConfig ?? '—'}</pre>
                  </div>
                  <div>
                    <p className="section-label mb-1">After (port + ONU)</p>
                    <pre data-testid="unsaved-after" className="overflow-x-auto rounded-md bg-muted p-2 font-mono text-xs">
                      {[c.after?.portRunningConfig, c.after?.onuRunningConfig, c.after?.onuMngConfig].filter(Boolean).join('\n\n')}
                    </pre>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="mb-2 text-sm text-critical">
              {error}
            </p>
          )}
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <Save /> Save configuration (write)
          </Button>
        </>
      )}
    </Panel>
  );
}
