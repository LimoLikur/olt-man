import { useMutation, useQuery } from '@tanstack/react-query';
import { Check, ClipboardCheck, Copy, Send, SquareTerminal } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, ApiError } from '../api';
import { useMe } from '../auth';
import { PageBody, PageHeader, Panel } from '../components/app/panel';
import { RegistrationTabs } from '../components/app/registration-tabs';
import { MockBadge } from '../components/app/status';
import { UncfgPanel } from '../components/uncfg-panel';
import { Button, Callout, Empty, Field, Input, Select, Textarea } from '../components/ui';
import { NA, PROVISION_MODE_LABEL } from '../format';
import { useOlts } from '../queries';

interface Options {
  oltId: number;
  /** Polled fine and CLI on: the api accepts a registration for this OLT. */
  ready: boolean;
  ports: { slot: number; port: number }[];
  onuTypes: string[];
  /** The OLT's T-CONT profile list (read from the OLT or added by NOC/admin); the only ones allowed. */
  tcontProfiles: string[];
  /** The OLT's VLAN list (read from the OLT or added by NOC/admin); the only VLANs a registration may use. */
  vlans: number[];
}
interface Preview {
  id: number;
  params: { slot: number; port: number; onuId: number };
  preview: string;
  previewSha256: string;
}

const EMPTY = {
  mode: 'default',
  port: '',
  sn: '',
  name: '',
  onuType: '',
  tcontProfile: '',
  vlan: '',
  description: '',
  lanPorts: '4',
  pppoeUsername: '',
  pppoePassword: '',
  bridgeTcontProfile: '',
  bridgeVlan: '',
};
const NA_FIELD = 'Not available in OLT-MAN: the registration template has no such field';

/**
 * What each template sets up on the ONU (SPEC §8.5). A hint is part of its field's accessible
 * name, so it avoids the other fields' labels (the e2e tests find fields by label, e.g. "VLAN").
 */
const MODE_HINT: Record<string, string> = {
  default: 'Internet service (HSI) on eth_0/1, as in the C320 manual.',
  bridge: 'Bridging service on the VEIP, with SN binding and remote-id on vport 1.',
  pppoe_map: 'PPPoE WAN on the ONU with service AUD, SN binding and the PPPoE intermediate agent; ping, traceroute and web management answered.',
  pppoe_jgl: 'As PPPoE MAP, but the WAN uses vlan-profile briding.',
  bridge_static: 'Two services with SN binding and remote-id on vport 1 and 2: static on gemport AUD (vport 1), bridging on the VEIP (vport 2).',
};
/** Templates with an optional `description` line. */
const WITH_DESCRIPTION = ['bridge', 'pppoe_map', 'bridge_static', 'pppoe_jgl'];

/**
 * Fase 2: compose an ONU registration, see the exact commands (ending in `write`), then confirm
 * them (the hash of what was shown is sent along). A teknisi submits it for NOC/admin approval
 * instead. Any OLT with CLI on (CLAUDE.md rule 3 since 2026-11-13).
 */
export function ProvisionNewPage() {
  const [params, setParams] = useSearchParams();
  const oltId = params.get('oltId') ?? '';
  const olts = useOlts();
  const candidates = (olts.data ?? []).filter((o) => o.cliEnabled);
  const options = useQuery({ queryKey: ['provision-options', oltId], queryFn: () => api.get<Options>(`/olts/${oltId}/provision-options`), enabled: oltId !== '', refetchInterval: false });
  const [f, setF] = useState(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();
  const me = useMe();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const create = useMutation({
    mutationFn: () => {
      const [slot, port] = f.port.split('/').map(Number);
      const description = f.description.trim();
      const withDescription = WITH_DESCRIPTION.includes(f.mode) && description ? { description } : {};
      // Mode-specific fields go only with their template; the api refuses them otherwise.
      const extra =
        f.mode === 'bridge'
          ? { lanPorts: Number(f.lanPorts) }
          : f.mode === 'bridge_static'
            ? { lanPorts: Number(f.lanPorts), bridgeTcontProfile: f.bridgeTcontProfile, bridgeVlan: Number(f.bridgeVlan) }
            : f.mode === 'pppoe_map' || f.mode === 'pppoe_jgl'
              ? // The password is sent as typed: a space or other character the api refuses shows the error below.
                { pppoeUsername: f.pppoeUsername.trim(), pppoePassword: f.pppoePassword }
              : {};
      return api.post<Preview>('/jobs', {
        oltId: Number(oltId),
        mode: f.mode,
        slot,
        port,
        sn: f.sn.trim(),
        name: f.name.trim(),
        onuType: f.onuType,
        tcontProfile: f.tcontProfile,
        vlan: Number(f.vlan),
        ...withDescription,
        ...extra,
      });
    },
    onMutate: () => {
      setError(null);
      setCopied(false);
    },
    onError: (e) =>
      setError(
        e instanceof ApiError
          ? e.status === 400
            ? 'Invalid input: the SN is 4 letters + 8 hex digits; customer name, description, ONU type and T-CONT profile allow only letters, digits, dot, hyphen and underscore (max. 32, no spaces); the PPPoE username and password also allow @ (max. 64 and 32).'
            : e.message
          : 'Failed.',
      ),
  });
  const confirm = useMutation({
    mutationFn: () => api.post(`/jobs/${create.data!.id}/confirm`, { previewSha256: create.data!.previewSha256 }),
    onSuccess: () => navigate(`/jobs/${create.data!.id}`),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Failed.'),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // The api refuses it too; said here so the generic 400 message is not the only hint.
    if (f.mode === 'bridge_static' && f.bridgeVlan !== '' && f.bridgeVlan === f.vlan) {
      setError('The bridge VLAN must differ from the static VLAN.');
      return;
    }
    create.mutate();
  };
  const reset = () => {
    setF(EMPTY);
    setError(null);
    create.reset();
  };
  const copy = async () => {
    if (!create.data) return;
    await navigator.clipboard.writeText(create.data.preview).catch(() => undefined);
    setCopied(true);
  };
  const o = options.data;
  const selectedOlt = candidates.find((m) => String(m.id) === oltId);
  // Bridge Static has a second T-CONT profile and VLAN (bridging); the first pair is the static service's.
  const staticPrefix = f.mode === 'bridge_static' ? 'Static ' : '';

  return (
    <div>
      <PageHeader
        title="ONU registration"
        subtitle="Commands reach the OLT only after the preview is confirmed; technicians' requests wait for NOC approval. A verified registration is saved at once (write)."
      />
      <PageBody>
        <RegistrationTabs current="new" />
        <div className="grid items-start gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
          <UncfgPanel
            olts={candidates}
            selectedSn={f.sn}
            onPick={(id, slot, port, sn) => {
              setParams({ oltId: String(id) });
              setF((prev) => ({ ...prev, port: `${slot}/${port}`, sn }));
            }}
          />

          <div className="min-w-0 space-y-6">
            <Panel title="Registration request" icon={ClipboardCheck} tone="neutral">
              <form onSubmit={submit} className="space-y-6">
                <div>
                  <div className="section-label mb-3">Device & placement</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="OLT">
                      <Select name="oltId" value={oltId} onChange={(e) => setParams(e.target.value ? { oltId: e.target.value } : {})} required className="w-full">
                        <option value="">Choose…</option>
                        {candidates.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <div className="flex items-end pb-1.5">{selectedOlt?.isMock && <MockBadge />}</div>
                    {o && !o.ready && (
                      <Callout role="alert" tone="warning" className="md:col-span-2">
                        This OLT is not ready for registration: its status must be Operational and CLI (SSH) enabled.
                      </Callout>
                    )}
                    {o && (
                      <>
                        <Field label="PON port">
                          <Select name="port" value={f.port} onChange={set('port')} required className="w-full">
                            <option value="">Pick a port</option>
                            {o.ports.map((p) => (
                              <option key={`${p.slot}/${p.port}`} value={`${p.slot}/${p.port}`}>
                                1/{p.slot}/{p.port}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Serial number">
                          <Input name="sn" value={f.sn} onChange={set('sn')} placeholder="ZTEG00000002" required autoComplete="off" className="font-mono" />
                        </Field>
                        <Field label="ONU type">
                          <Input name="onuType" list="onu-types" value={f.onuType} onChange={set('onuType')} placeholder="e.g. ZTE-F660" required autoComplete="off" />
                          <datalist id="onu-types">
                            {o.onuTypes.map((v) => (
                              <option key={v} value={v} />
                            ))}
                          </datalist>
                        </Field>
                        <div className="grid grid-cols-[1fr_120px] gap-3">
                          <Field label={`${staticPrefix}T-CONT profile`}>
                            <Select name="tcontProfile" value={f.tcontProfile} onChange={set('tcontProfile')} required className="w-full">
                              <option value="">Pick</option>
                              {o.tcontProfiles.map((v) => (
                                <option key={v}>{v}</option>
                              ))}
                            </Select>
                          </Field>
                          <Field label={`${staticPrefix}VLAN`}>
                            <Select name="vlan" value={f.vlan} onChange={set('vlan')} required className="w-full font-mono">
                              <option value="">Pick</option>
                              {o.vlans.map((v) => (
                                <option key={v}>{v}</option>
                              ))}
                            </Select>
                          </Field>
                        </div>
                        {o.tcontProfiles.length === 0 && <p className="text-sm text-orange md:col-span-2">No T-CONT profiles for this OLT yet. NOC or an admin can add them on the OLT page.</p>}
                        {o.vlans.length === 0 && <p className="text-sm text-orange md:col-span-2">No VLANs for this OLT yet. NOC or an admin can read them from the OLT or add them on the OLT page.</p>}
                      </>
                    )}
                  </div>
                </div>

                <div className="divider-dashed" />

                <div>
                  <div className="section-label mb-3">Service</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Mode" hint={MODE_HINT[f.mode]}>
                      <Select name="mode" value={f.mode} onChange={set('mode')} className="w-full" disabled={!o}>
                        {Object.entries(PROVISION_MODE_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {(f.mode === 'bridge' || f.mode === 'bridge_static') && (
                      <Field label="LAN ports" hint="Tagged from eth_0/1 up to this one. A port the ONU does not have stops the job at that line, before write.">
                        <Select name="lanPorts" value={f.lanPorts} onChange={set('lanPorts')} className="w-full" disabled={!o}>
                          {['1', '2', '3', '4'].map((n) => (
                            <option key={n} value={n}>
                              {n === '1' ? 'eth_0/1' : `eth_0/1 – eth_0/${n}`}
                            </option>
                          ))}
                        </Select>
                      </Field>
                    )}
                    {f.mode === 'bridge_static' && o && (
                      <div className="grid grid-cols-[1fr_120px] gap-3">
                        <Field label="Bridge T-CONT profile">
                          <Select name="bridgeTcontProfile" value={f.bridgeTcontProfile} onChange={set('bridgeTcontProfile')} required className="w-full">
                            <option value="">Pick</option>
                            {o.tcontProfiles.map((v) => (
                              <option key={v}>{v}</option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Bridge VLAN">
                          <Select name="bridgeVlan" value={f.bridgeVlan} onChange={set('bridgeVlan')} required className="w-full font-mono">
                            <option value="">Pick</option>
                            {o.vlans.map((v) => (
                              <option key={v}>{v}</option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                    )}
                    {(f.mode === 'pppoe_map' || f.mode === 'pppoe_jgl') && (
                      <>
                        <Field label="PPPoE username" hint="Letters, digits and . _ - @ (max. 64).">
                          <Input name="pppoeUsername" value={f.pppoeUsername} onChange={set('pppoeUsername')} placeholder="AUD-03-00000-001" required autoComplete="off" className="font-mono" disabled={!o} />
                        </Field>
                        <Field label="PPPoE password" hint="Letters, digits and . _ - @ (max. 32). Shown as typed in the preview and on the job.">
                          <Input name="pppoePassword" value={f.pppoePassword} onChange={set('pppoePassword')} required autoComplete="off" spellCheck={false} className="font-mono" disabled={!o} />
                        </Field>
                      </>
                    )}
                  </div>
                </div>

                <div className="divider-dashed" />

                <div>
                  <div className="section-label mb-3">Customer</div>
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field label="Customer name">
                      <Input name="name" value={f.name} onChange={set('name')} placeholder="Customer-01" required autoComplete="off" disabled={!o} />
                    </Field>
                    {WITH_DESCRIPTION.includes(f.mode) && (
                      <Field label="Description" hint="Optional. Without it the description line is left out.">
                        <Input name="description" value={f.description} onChange={set('description')} placeholder="e.g. Carku-2" autoComplete="off" disabled={!o} />
                      </Field>
                    )}
                    <Field label="Customer ID">
                      <Input value={NA} disabled readOnly title={NA_FIELD} className="font-mono" />
                    </Field>
                    <Field label="Installation address" className="md:col-span-2">
                      <Input value={NA} disabled readOnly title={NA_FIELD} />
                    </Field>
                    <Field label="Notes for reviewer" className="md:col-span-2">
                      <Textarea value={NA} disabled readOnly title={NA_FIELD} rows={2} />
                    </Field>
                  </div>
                </div>

                {error && (
                  <p role="alert" className="rounded-md border border-critical/20 bg-critical-soft px-3 py-2 text-sm text-critical">
                    {error}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed bg-muted/40 px-4 py-3">
                  <p className="max-w-md text-xs text-muted-foreground">
                    Commands run only after a confirmed preview. Technicians' requests need approval from NOC or an admin, and nobody approves their own request.
                  </p>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="ghost" onClick={reset}>
                      Reset
                    </Button>
                    <Button type="submit" disabled={create.isPending || !o}>
                      Create preview
                    </Button>
                  </div>
                </div>
              </form>
            </Panel>

            <Panel title="Command preview" icon={SquareTerminal} tone="primary">
              {create.data ? (
                <>
                  <p className="mb-2 text-sm">
                    Next free ONU ID:{' '}
                    <b data-testid="onu-id" className="numeric">
                      {create.data.params.onuId}
                    </b>{' '}
                    <span className="text-muted-foreground">(job #{create.data.id})</span>
                  </p>
                  <pre data-testid="preview" className="mb-2 overflow-x-auto rounded-lg bg-code p-3 font-mono text-xs text-code-foreground">
                    {create.data.preview}
                  </pre>
                  <p className="mb-4 break-all text-xs text-muted-foreground">
                    sha256: <code data-testid="preview-hash">{create.data.previewSha256}</code>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => confirm.mutate()} disabled={confirm.isPending}>
                      <Send /> {me.role === 'teknisi' ? 'Submit to NOC' : 'Confirm and run'}
                    </Button>
                    <Button variant="outline" onClick={() => void copy()}>
                      {copied ? <Check /> : <Copy />} {copied ? 'Copied' : 'Copy commands'}
                    </Button>
                  </div>
                </>
              ) : (
                <Empty icon={<SquareTerminal />}>Fill in the form, then create the preview.</Empty>
              )}
            </Panel>
          </div>
        </div>
      </PageBody>
    </div>
  );
}
