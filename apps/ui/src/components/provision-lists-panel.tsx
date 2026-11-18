import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ListChecks } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import { Panel } from './app/panel';
import { Button, Callout, Field, Input } from './ui';

const SYNC_ERRORS: Record<string, string> = {
  cli_disabled: 'CLI is not enabled for this OLT.',
  cli_unavailable: 'The OLT CLI is not available (sessions full or unreachable). Try again later.',
  cli_auth_failed: 'The OLT refused the CLI login.',
  host_key_not_pinned: "The OLT's SSH host key is not pinned yet.",
  host_key_mismatch: "The OLT's SSH host key changed; the OLT is quarantined.",
  ssh_negotiation_failed: "The OLT rejected the app's SSH algorithms.",
};

const LISTS = {
  vlans: { label: 'VLAN', path: 'vlans', body: (v: string) => ({ vlan: Number(v) }), input: { type: 'number', min: 1, max: 4094, placeholder: '1–4094' }, invalid: 'A VLAN is an integer from 1 to 4094.' },
  tcontProfiles: {
    label: 'T-CONT profile',
    path: 'tcont-profiles',
    body: (v: string) => ({ profile: v.trim() }),
    input: { type: 'text', placeholder: 'e.g. UP-50M' },
    invalid: 'Profile names allow only letters, digits, dot, hyphen and underscore (max. 32).',
  },
} as const;
type ListKey = keyof typeof LISTS;

interface ListResult {
  found?: string[];
  added?: number;
  /** found on the OLT but unusable in a template (name rules), so not stored */
  skipped?: string[];
  error?: string;
}
interface SyncJob {
  status: string;
  result: ({ error?: string; failedLists?: string[] } & Partial<Record<ListKey, ListResult>>) | null;
}

/** "VLAN: 14 found, 3 new; T-CONT profile: output format not recognized" */
function summary(result: NonNullable<SyncJob['result']>): string {
  return (Object.keys(LISTS) as ListKey[])
    .filter((k) => result[k])
    .map((k) => {
      const r = result[k]!;
      if (r.error) return `${LISTS[k].label}: output format not recognized, nothing stored`;
      const skipped = r.skipped?.length ? `, ${r.skipped.length} skipped because the name cannot be used (${r.skipped.join(', ')})` : '';
      return `${LISTS[k].label}: ${r.found?.length ?? 0} found, ${r.added ?? 0} new${skipped}`;
    })
    .join('; ');
}

/**
 * NOC and admin: the VLANs and T-CONT profiles ONU registrations may use on this OLT (SPEC §8.5).
 * The lists live in the app: adding a value does not change the OLT, and "Read from OLT" only
 * reads `show` output and adds what it finds.
 */
export function ProvisionListsPanel({ oltId }: { oltId: number }) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncJob, setSyncJob] = useState<number | null>(null);
  const refresh = () => {
    for (const k of Object.keys(LISTS) as ListKey[]) void qc.invalidateQueries({ queryKey: [LISTS[k].path, oltId] });
    void qc.invalidateQueries({ queryKey: ['provision-options', String(oltId)] });
  };
  const sync = useMutation({
    mutationFn: () => api.post<{ jobId: number }>(`/olts/${oltId}/provision-lists/sync`),
    onMutate: () => {
      setError(null);
      setNotice(null);
    },
    onSuccess: (r) => setSyncJob(r.jobId),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed.'),
  });
  // Follow the sync job until it finishes.
  useQuery({
    queryKey: ['job', syncJob],
    enabled: syncJob !== null,
    refetchInterval: 1000,
    queryFn: async () => {
      const job = await api.get<SyncJob>(`/jobs/${syncJob}`);
      if (['succeeded', 'failed', 'blocked', 'cancelled'].includes(job.status)) {
        setSyncJob(null);
        const r = job.result ?? {};
        if (job.status === 'succeeded') setNotice(summary(r));
        else if (r.error === 'parse_failed') setError(summary(r));
        else setError(SYNC_ERRORS[r.error ?? ''] ?? `Could not read the lists from the OLT (${r.error ?? job.status}).`);
        refresh();
      }
      return job;
    },
  });

  return (
    <Panel
      title="Registration lists"
      icon={ListChecks}
      tone="neutral"
      testId="provision-lists-panel"
      action={
        <Button variant="outline" size="sm" onClick={() => sync.mutate()} disabled={syncJob !== null || sync.isPending}>
          <Download /> {syncJob !== null ? 'Reading…' : 'Read from OLT'}
        </Button>
      }
    >
      <p className="mb-4 text-sm text-muted-foreground">
        These lists live in the app. “Read from OLT” only reads the VLANs and T-CONT profiles already defined on the OLT and adds them; adding a value here does not change the OLT.
      </p>
      {notice && (
        <Callout role="status" tone="success" className="mb-4">
          {notice}
        </Callout>
      )}
      {error && (
        <p role="alert" className="mb-4 text-sm text-critical">
          {error}
        </p>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        {(Object.keys(LISTS) as ListKey[]).map((k) => (
          <ListSection key={k} oltId={oltId} list={k} onAdded={refresh} />
        ))}
      </div>
    </Panel>
  );
}

function ListSection({ oltId, list, onAdded }: { oltId: number; list: ListKey; onAdded: () => void }) {
  const def = LISTS[list];
  const values = useQuery({ queryKey: [def.path, oltId], queryFn: () => api.get<(string | number)[]>(`/olts/${oltId}/${def.path}`) });
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => api.post(`/olts/${oltId}/${def.path}`, def.body(value)),
    onMutate: () => setError(null),
    onSuccess: () => {
      setValue('');
      onAdded();
    },
    onError: (e) => setError(e instanceof ApiError ? (e.status === 400 ? def.invalid : e.message) : 'Failed.'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };

  return (
    <section data-testid={`list-${def.path}`}>
      <h3 className="section-label mb-2">{def.label}</h3>
      {values.data && values.data.length > 0 ? (
        <ul className="mb-3 flex flex-wrap gap-1.5">
          {values.data.map((v) => (
            <li key={v} className="tag-mono">
              {v}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-3 text-sm text-muted-foreground">None yet.</p>
      )}
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <Field label={`Add ${def.label}`} className="min-w-40 flex-1">
          <Input name={def.path} {...def.input} value={value} onChange={(e) => setValue(e.target.value)} required autoComplete="off" />
        </Field>
        <Button type="submit" disabled={add.isPending}>
          Add
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-critical">
          {error}
        </p>
      )}
    </section>
  );
}
