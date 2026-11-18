import type { OltSummary } from '@olt/shared/dto';
import type { SshAlgorithms } from '@olt/shared/ssh-algorithms';
import { useMutation } from '@tanstack/react-query';
import { Lock, Radio, Server, SquareTerminal } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router';
import { api, ApiError } from '../api';
import { PageBody, PageHeader, Panel } from '../components/app/panel';
import { SshAlgorithmsField } from '../components/ssh-algorithms-field';
import { Button, Callout, Field, Input, Select } from '../components/ui';

const checkbox = 'size-4 rounded border-input accent-primary';

/** Admin or NOC: register an OLT (also used for the real OLT in K5). Starts in pending_pin. */
export function OltNewPage() {
  const navigate = useNavigate();
  const [f, setF] = useState({
    name: '',
    mgmtIp: '',
    isMock: true,
    oidProfile: 'zte-c320-v2.1',
    version: 'v3' as 'v3' | 'v2c',
    user: '',
    authKey: '',
    privProtocol: 'aes' as 'aes' | 'des',
    privKey: '',
    community: '',
    cli: true,
    cliUser: '',
    cliPassword: '',
  });
  const [sshAlgorithms, setSshAlgorithms] = useState<SshAlgorithms>({});
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string; checked?: boolean; type?: string } }) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const create = useMutation({
    mutationFn: () =>
      api.post<OltSummary>('/olts', {
        name: f.name,
        mgmtIp: f.mgmtIp,
        isMock: f.isMock,
        oidProfile: f.oidProfile,
        snmp: f.version === 'v3' ? { version: 'v3', user: f.user, authProtocol: 'sha', authKey: f.authKey, privProtocol: f.privProtocol, privKey: f.privKey } : { version: 'v2c', community: f.community },
        ...(f.cli ? { cli: { username: f.cliUser, password: f.cliPassword }, sshAlgorithms } : {}),
      }),
    onSuccess: (olt) => navigate(`/olts/${olt.id}`),
    onError: (e) => setError(e instanceof ApiError ? (e.status === 400 ? 'Invalid input. Check the name, IP and credentials.' : e.message) : 'Failed.'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate();
  };
  const field = (label: string, k: keyof typeof f, type = 'text') => (
    <Field label={label}>
      <Input name={k} type={type} value={String(f[k])} onChange={set(k)} required autoComplete="off" />
    </Field>
  );

  return (
    <div>
      <PageHeader title="Add OLT" subtitle="A new OLT starts as Pending pin: nothing polls it before its identity is pinned." />
      <PageBody>
        <form onSubmit={submit} className="grid max-w-5xl items-start gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            <Panel title="OLT" icon={Server} tone="primary">
              <div className="flex flex-col gap-4">
                {field('OLT name (lowercase letters, digits and hyphens)', 'name')}
                {field('Management IP', 'mgmtIp')}
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="isMock" checked={f.isMock} onChange={set('isMock')} className={checkbox} /> Mock OLT (cannot be changed later)
                </label>
                <Field label="OID profile">
                  <Select name="oidProfile" value={f.oidProfile} onChange={set('oidProfile')} className="w-full">
                    <option value="zte-c320-v2.1">ZTE C320 V2.1 (1012)</option>
                    <option value="zte-c320-v2.2">ZTE C320 V2.2+ (1082)</option>
                  </Select>
                </Field>
              </div>
            </Panel>
            <Panel title="SNMP" icon={Radio} tone="info">
              <div className="flex flex-col gap-4">
                <Field label="SNMP version">
                  <Select name="version" value={f.version} onChange={set('version')} className="w-full">
                    <option value="v3">v3 authPriv (SHA)</option>
                    <option value="v2c">v2c (weak identity, temporary)</option>
                  </Select>
                </Field>
                {f.version === 'v3' ? (
                  <>
                    {field('SNMPv3 user', 'user')}
                    {field('Auth key', 'authKey', 'password')}
                    <Field label="Privacy">
                      <Select name="privProtocol" value={f.privProtocol} onChange={set('privProtocol')} className="w-full">
                        <option value="aes">AES-128</option>
                        <option value="des">DES (des56, weak encryption)</option>
                      </Select>
                    </Field>
                    {f.privProtocol === 'des' && <p className="text-xs text-orange">DES is easy to break. Use it only when the OLT firmware does not support AES.</p>}
                    {field('Priv key', 'privKey', 'password')}
                  </>
                ) : (
                  field('Community', 'community', 'password')
                )}
              </div>
            </Panel>
          </div>
          <div className="space-y-6">
            <Panel title="CLI (SSH)" icon={SquareTerminal} tone="neutral">
              <div className="flex flex-col gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="cli" checked={f.cli} onChange={set('cli')} className={checkbox} /> CLI over SSH enabled
                </label>
                {f.cli && (
                  <>
                    {field('CLI username', 'cliUser')}
                    {field('CLI password', 'cliPassword', 'password')}
                    <SshAlgorithmsField value={sshAlgorithms} onChange={setSshAlgorithms} />
                  </>
                )}
              </div>
            </Panel>
            <Callout tone="neutral" icon={<Lock />}>
              Credentials are encrypted on the server with the worker's public key and never shown again. A new OLT is polled only after its identity is pinned.
            </Callout>
            {error && (
              <p role="alert" className="text-sm text-critical">
                {error}
              </p>
            )}
            <Button type="submit" disabled={create.isPending}>
              Register OLT
            </Button>
          </div>
        </form>
      </PageBody>
    </div>
  );
}
