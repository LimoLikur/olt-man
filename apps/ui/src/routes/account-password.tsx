import { useMutation } from '@tanstack/react-query';
import { Check, KeyRound } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import { useMe } from '../auth';
import { PageBody, PageHeader, Panel } from '../components/app/panel';
import { Button, Callout, Field, Input } from '../components/ui';

/** Any user changes their own password (POST /auth/password); other sessions are signed out. */
export function AccountPasswordPage() {
  const me = useMe();
  const [f, setF] = useState({ currentPassword: '', newPassword: '', repeat: '' });
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const change = useMutation({
    mutationFn: () => api.post('/auth/password', { currentPassword: f.currentPassword, newPassword: f.newPassword }),
    onSuccess: () => {
      setF({ currentPassword: '', newPassword: '', repeat: '' });
      setDone(true);
    },
    onError: (e) => setError(e instanceof ApiError ? (e.status === 400 ? 'The new password needs at least 12 characters.' : e.message) : 'Failed.'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);
    if (f.newPassword.length < 12) return setError('The new password needs at least 12 characters.');
    if (f.newPassword !== f.repeat) return setError('The two new passwords do not match.');
    if (f.newPassword === f.currentPassword) return setError('The new password must differ from the current one.');
    change.mutate();
  };
  const field = (label: string, k: keyof typeof f, autoComplete: string) => (
    <Field label={label}>
      <Input name={k} type="password" value={f[k]} onChange={set(k)} required autoComplete={autoComplete} />
    </Field>
  );

  return (
    <div>
      <PageHeader title="Change password" subtitle={`Account ${me.username}`} />
      <PageBody>
        <Panel title="New password" icon={KeyRound} tone="primary" className="max-w-md">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">At least 12 characters. Sessions on other devices are signed out; this one stays signed in.</p>
            {field('Current password', 'currentPassword', 'current-password')}
            {field('New password', 'newPassword', 'new-password')}
            {field('Repeat new password', 'repeat', 'new-password')}
            {error && (
              <p role="alert" className="text-sm text-critical">
                {error}
              </p>
            )}
            {done && (
              <Callout role="status" tone="success" icon={<Check />}>
                The password was changed.
              </Callout>
            )}
            <Button type="submit" disabled={change.isPending}>
              Save new password
            </Button>
          </form>
        </Panel>
      </PageBody>
    </div>
  );
}
