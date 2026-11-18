import type { OltSummary } from '@olt/shared/dto';
import type { SshAlgorithms } from '@olt/shared/ssh-algorithms';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SquareTerminal } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import { Panel } from './app/panel';
import { Pill } from './app/status';
import { algorithmList, SshAlgorithmsField } from './ssh-algorithms-field';
import { Button, Field, Input } from './ui';

const same = (a: SshAlgorithms, b: SshAlgorithms) => JSON.stringify(algorithmList(a).sort()) === JSON.stringify(algorithmList(b).sort());

/**
 * Admin: switch CLI over SSH on or off for an existing OLT, rotate its CLI credentials, and set
 * legacy SSH algorithms. Switching on (or new algorithms) queues an identity probe; the host
 * key candidate is then pinned in the identity panel.
 */
export function CliPanel({ olt }: { olt: OltSummary }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(olt.cliEnabled);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [algorithms, setAlgorithms] = useState<SshAlgorithms>(olt.sshAlgorithms);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const start = () => {
    setEnabled(olt.cliEnabled);
    setUsername('');
    setPassword('');
    setAlgorithms(olt.sshAlgorithms);
    setError(null);
    setNotice(null);
    setOpen(true);
  };
  const probes = enabled && (!olt.cliEnabled || !same(algorithms, olt.sshAlgorithms));
  const save = useMutation({
    mutationFn: () =>
      api.patch<OltSummary>(`/olts/${olt.id}`, {
        cliEnabled: enabled,
        ...(username || password ? { cli: { username, password } } : {}),
        ...(enabled && !same(algorithms, olt.sshAlgorithms) ? { sshAlgorithms: algorithms } : {}),
      }),
    onSuccess: async () => {
      setOpen(false);
      setPassword('');
      setNotice(probes ? 'Saved. An SSH host key probe is running; check its candidate in the OLT identity panel, then pin it.' : 'Saved.');
      await qc.invalidateQueries({ queryKey: ['olt', String(olt.id)] });
      await qc.invalidateQueries({ queryKey: ['identity', olt.id] });
    },
    // 'Isi …' is the api's own (Indonesian) message for missing credentials; it is shown as is.
    onError: (e) => setError(e instanceof ApiError ? (e.status === 400 && !e.message.startsWith('Isi') ? 'Invalid input. Check the username, password and algorithms.' : e.message) : 'Failed.'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if ((username === '') !== (password === '')) return setError('Fill in the CLI username and password together, or leave both empty.');
    save.mutate();
  };
  const current = algorithmList(olt.sshAlgorithms);

  return (
    <Panel
      title="CLI (SSH)"
      icon={SquareTerminal}
      tone="neutral"
      testId="cli-panel"
      action={
        <>
          <Pill tone={olt.cliEnabled ? 'success' : 'neutral'} dot>
            {olt.cliEnabled ? 'Enabled' : 'Disabled'}
          </Pill>
          {!open && (
            <Button variant="outline" size="sm" onClick={start}>
              Edit…
            </Button>
          )}
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        Legacy SSH algorithms:{' '}
        {current.length
          ? current.map((a) => (
              <code key={a} className="tag-mono mr-1">
                {a}
              </code>
            ))
          : 'none (ssh2 defaults)'}
      </p>
      {notice && <p className="mt-2 text-sm text-success">{notice}</p>}
      {open && (
        <form role="dialog" aria-label="Edit CLI" onSubmit={submit} className="mt-4 flex max-w-xl flex-col gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="cliEnabled" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-4 accent-primary" /> CLI over SSH enabled
          </label>
          <Field label="CLI username">
            <Input name="cliUser" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="CLI password">
            <Input name="cliPassword" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
          </Field>
          <p className="text-xs text-muted-foreground">Required when CLI is enabled for the first time. Leave both empty to keep the current credentials. Credentials are encrypted and never shown again.</p>
          {enabled && <SshAlgorithmsField value={algorithms} onChange={setAlgorithms} />}
          {error && (
            <p role="alert" className="text-sm text-critical">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" disabled={save.isPending}>
              Save
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
