import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Minus, ShieldCheck, Signal, UserPlus, Users, Wrench } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError, type Role } from '../api';
import { useMe } from '../auth';
import { PageBody, PageHeader, Panel, StatCard } from '../components/app/panel';
import { DisabledAction, NAValue, Pill, type PillTone } from '../components/app/status';
import { Button, Callout, cx, Input, Loading, Select, Table, Td, Th } from '../components/ui';
import { initials, plural, ROLE_LABEL, shortDateTime } from '../format';
import { can, PERMISSION_LABELS, PERMISSIONS, ROLES, type Permission } from '../permissions';

interface UserRow {
  id: number;
  username: string;
  role: Role;
  active: boolean;
  passwordChangedAt: string | null;
  passwordResettable: boolean;
}

const ROLE_TONE: Record<Role, PillTone> = { admin: 'primary', noc: 'info', teknisi: 'neutral' };
const NOT_SUPPORTED = 'users are created by the seed; roles and access cannot be changed in the app';

/** Admin (LAN only): list users and set a new password for NOC and teknisi accounts. */
export function UsersPage() {
  const me = useMe();
  const q = useQuery({ queryKey: ['users'], queryFn: () => api.get<UserRow[]>('/users') });
  const [editing, setEditing] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (q.isError) return <Loading>Only admins, from the office network, can manage users.</Loading>;
  if (!q.data) return <Loading />;
  const users = q.data;
  const count = (r: Role) => users.filter((u) => u.role === r && u.active).length;

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={`${plural(users.filter((u) => u.active).length, 'active operator')}`}
        actions={
          <DisabledAction variant="primary" reason={NOT_SUPPORTED}>
            <UserPlus /> Add user
          </DisabledAction>
        }
      />
      <PageBody>
        <Callout tone="info">
          Admins can set a new password for NOC and technician accounts; all sessions of that user end at once. An admin password can only be changed by its owner, under{' '}
          <Link className="font-medium underline" to="/account/password">
            Change password
          </Link>
          .
        </Callout>
        {done && (
          <Callout role="status" tone="success" icon={<Check />}>
            {done}
          </Callout>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard title="Administrators" icon={ShieldCheck} tone="primary" value={count('admin')} chip="active" />
          <StatCard title="NOC engineers" icon={Signal} tone="info" value={count('noc')} chip="active" />
          <StatCard title="Technicians" icon={Wrench} tone="neutral" value={count('teknisi')} chip="active" />
        </div>

        <div className="grid items-start gap-6 2xl:grid-cols-[minmax(0,1fr)_440px]">
          <Panel title="Operators" icon={Users} tone="neutral" flush>
            <Table>
              <thead>
                <tr>
                  <Th>User</Th>
                  <Th>Role</Th>
                  <Th>Region</Th>
                  <Th>Last active</Th>
                  <Th>Password changed</Th>
                  <Th>Access</Th>
                  <Th className="text-right">Password</Th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => {
                  const self = u.username === me.username;
                  return (
                    <tr key={u.id} data-testid="user-row" className={cx('align-top', !u.active && 'opacity-60')}>
                      <Td>
                        <div className="flex items-center gap-3">
                          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border bg-primary-soft text-[11px] font-semibold text-primary">{initials(u.username)}</span>
                          <div>
                            <div className="font-medium">
                              {u.username} {self && <span className="text-xs text-muted-foreground">(you)</span>}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              email <NAValue />
                            </div>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        {self ? (
                          <Pill tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Pill>
                        ) : (
                          <span title={`N/A — ${NOT_SUPPORTED}`} className="inline-flex cursor-not-allowed">
                            <Select disabled value={u.role} aria-label={`Role of ${u.username}`} className="h-8 w-36" onChange={() => undefined}>
                              {ROLES.map((r) => (
                                <option key={r} value={r}>
                                  {ROLE_LABEL[r]}
                                </option>
                              ))}
                            </Select>
                          </span>
                        )}
                      </Td>
                      <Td>
                        <NAValue />
                      </Td>
                      <Td>
                        <NAValue />
                      </Td>
                      <Td className="whitespace-nowrap text-muted-foreground">{shortDateTime(u.passwordChangedAt)}</Td>
                      <Td>
                        <span title={`N/A — ${NOT_SUPPORTED}`} className="inline-flex cursor-not-allowed items-center gap-2">
                          <button
                            type="button"
                            role="switch"
                            aria-checked={u.active}
                            aria-label={`Access for ${u.username}`}
                            disabled
                            className={cx('relative inline-flex h-5 w-9 shrink-0 items-center rounded-full opacity-60 transition-colors', u.active ? 'bg-primary' : 'bg-input')}
                          >
                            <span className={cx('inline-block size-4 rounded-full bg-card shadow transition-transform', u.active ? 'translate-x-4' : 'translate-x-0.5')} />
                          </button>
                          <span className="text-xs text-muted-foreground">{u.active ? 'Enabled' : 'Disabled'}</span>
                        </span>
                      </Td>
                      <Td className="text-right">
                        {u.passwordResettable &&
                          (editing === u.id ? (
                            <ResetForm
                              user={u}
                              onClose={() => setEditing(null)}
                              onDone={() => {
                                setEditing(null);
                                setDone(`The password of ${u.username} was changed.`);
                              }}
                            />
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setDone(null);
                                setEditing(u.id);
                              }}
                            >
                              Change password…
                            </Button>
                          ))}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Panel>

          <Panel title="Role permissions" icon={ShieldCheck} tone="primary" flush>
            <Table>
              <thead>
                <tr>
                  <Th>Capability</Th>
                  {ROLES.map((r) => (
                    <Th key={r} className="text-center">
                      {ROLE_LABEL[r]}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(Object.keys(PERMISSIONS) as Permission[]).map((p) => (
                  <tr key={p}>
                    <Td className="text-sm">{PERMISSION_LABELS[p]}</Td>
                    {ROLES.map((r) => (
                      <Td key={r} className="text-center">
                        {can(r, p) ? <Check className="mx-auto size-4 text-success" aria-label="yes" /> : <Minus className="mx-auto size-4 text-muted-foreground/50" aria-label="no" />}
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="border-t px-4 py-3 text-xs text-muted-foreground">From SPEC §8.6. The api enforces these rules on every request; admin access only works from the office network.</p>
          </Panel>
        </div>
      </PageBody>
    </div>
  );
}

function ResetForm({ user, onClose, onDone }: { user: UserRow; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const reset = useMutation({
    mutationFn: () => api.post(`/users/${user.id}/password`, { newPassword: pw }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['users'] });
      onDone();
    },
    onError: (e) => setError(e instanceof ApiError ? (e.status === 400 ? 'The password needs at least 12 characters.' : e.message) : 'Failed.'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (pw.length < 12) return setError('The password needs at least 12 characters.');
    if (pw !== pw2) return setError('The two passwords do not match.');
    reset.mutate();
  };
  return (
    <form role="dialog" aria-label={`Change the password of ${user.username}`} onSubmit={submit} className="ml-auto flex w-64 flex-col gap-2 text-left">
      <Input name="newPassword" type="password" placeholder="New password (min. 12)" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
      <Input name="newPassword2" type="password" placeholder="Repeat the new password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
      {error && (
        <p role="alert" className="text-sm text-critical">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={reset.isPending}>
          Save
        </Button>
        <Button variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
