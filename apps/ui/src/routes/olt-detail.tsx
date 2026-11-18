import type { OltSummary, OnuView } from '@olt/shared/dto';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Activity, ArrowLeft, ClipboardCheck, Cpu, MapPin, Router, Server, Unplug, WifiOff, ZapOff } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api } from '../api';
import { useMe } from '../auth';
import { CliPanel } from '../components/cli-panel';
import { DeleteOltPanel } from '../components/delete-olt-panel';
import { IdentityPanel } from '../components/identity-panel';
import { ProvisionListsPanel } from '../components/provision-lists-panel';
import { UnsavedPanel } from '../components/unsaved-panel';
import { OnuTable, Paginator } from '../components/app/onu-table';
import { KeyValue, PageBody, PageHeader, Panel, StatCard } from '../components/app/panel';
import { PonLegend, PonTiles } from '../components/app/pon-tiles';
import { IdentityBadge, MockBadge, NAValue, OltStatusBadge, Pill, SegmentBar } from '../components/app/status';
import { Button, buttonClass, Empty, Loading } from '../components/ui';
import { age, dateTime, dbm, oidProfileLabel, plural } from '../format';
import { can } from '../permissions';
import { type PhaseCount, phaseTotal, portStats } from '../pon';
import { useOltOnus } from '../queries';

const PAGE = 15;

export function OltDetailPage() {
  const { id } = useParams();
  const me = useMe();
  const [port, setPort] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const olt = useQuery({ queryKey: ['olt', id], queryFn: () => api.get<OltSummary>(`/olts/${id}`) });
  const onus = useOltOnus(Number(id));
  const tableQuery = new URLSearchParams({ oltId: id ?? '', page: String(page), limit: String(PAGE) });
  if (port) {
    const [slot, p] = port.split('/');
    tableQuery.set('slot', slot!);
    tableQuery.set('port', p!);
  }
  const table = useQuery({
    queryKey: ['onus', 'olt-table', tableQuery.toString()],
    queryFn: () => api.get<{ total: number; items: OnuView[] }>(`/onus?${tableQuery}`),
    placeholderData: keepPreviousData,
  });
  const ports = useMemo(() => portStats(onus.data ?? []), [onus.data]);

  if (!olt.data) return <Loading>{olt.isError ? 'OLT not found.' : 'Loading…'}</Loading>;
  const o = olt.data;
  const list = onus.data;
  // While the OLT is not operational the phases are the last known ones (SPEC §8.2).
  const stale = o.status !== 'ok';
  const phaseCard = (phase: PhaseCount) => {
    if (!list) return { value: '—', chip: undefined };
    const t = phaseTotal(ports, phase);
    return { value: t.onus, chip: stale ? 'last known' : t.ports > 0 ? `on ${plural(t.ports, 'port')}` : undefined };
  };
  const selected = ports.find((p) => p.key === port);
  const pages = table.data ? Math.max(1, Math.ceil(table.data.total / PAGE)) : 1;
  const pick = (key: string | null) => {
    setPort(key);
    setPage(1);
  };

  return (
    <div>
      <PageHeader
        leading={
          <Link to="/olts" aria-label="Back to the list" className={buttonClass('outline', 'icon')}>
            <ArrowLeft />
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {o.name} <span className="tag-mono">ZTE {oidProfileLabel(o.oidProfile)}</span>
            {o.isMock && <MockBadge />}
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <MapPin className="size-3.5" /> <NAValue title="Location: not available in OLT-MAN" /> · <span className="font-mono">{o.mgmtIp}</span>
          </span>
        }
        actions={
          <>
            <OltStatusBadge status={o.status} />
            <IdentityBadge level={o.identityLevel} />
            {/* Fase 2 on any OLT with CLI on (CLAUDE.md rule 3 since 2026-11-13); NOC approves instead. */}
            {o.cliEnabled && can(me.role, 'composeRegistration') && (
              <Link to={`/provision/new?oltId=${o.id}`} className={buttonClass('primary', 'md')}>
                <ClipboardCheck /> Register ONU
              </Link>
            )}
          </>
        }
      />

      <PageBody>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            title="Online"
            icon={Router}
            tone="success"
            value={list ? phaseTotal(ports, 'working').onus : o.onus.online}
            chip={stale ? 'last known' : `of ${list ? list.length : o.onus.total} registered`}
          />
          <StatCard title="LOS" icon={Unplug} tone="critical" {...phaseCard('los')} />
          <StatCard title="Dying gasp" icon={ZapOff} tone="warning" {...phaseCard('dyingGasp')} />
          <StatCard title="Offline" icon={WifiOff} tone="neutral" {...phaseCard('offline')} />
        </div>

        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Panel
            title="PON ports"
            icon={Server}
            action={
              port && (
                <Button variant="ghost" size="sm" className="h-7" onClick={() => pick(null)}>
                  Show all ports
                </Button>
              )
            }
          >
            {ports.length === 0 ? (
              <Empty>{onus.isPending ? 'Loading…' : 'No ONU data yet.'}</Empty>
            ) : (
              <>
                <PonTiles ports={ports} selected={port} onSelect={(key) => pick(port === key ? null : key)} stale={stale} />
                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
                  <PonLegend />
                  <span className="ml-auto text-xs">
                    Tile = registered ONUs · port state and capacity <NAValue />
                  </span>
                </div>
                {selected && (
                  <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-sm">
                    <span className="font-mono font-medium">PON 1/{selected.key}</span>
                    <span>
                      {plural(selected.total, 'ONU')} · {selected.working} online · {selected.los} LOS · {selected.dyingGasp} dying gasp · {selected.offline} offline
                    </span>
                    <span>lowest Rx {dbm(selected.minRx)}</span>
                    <Link className="ml-auto text-primary hover:underline" to={`/onus?oltId=${o.id}&slot=${selected.slot}&port=${selected.port}`}>
                      Open in the ONU list
                    </Link>
                  </div>
                )}
              </>
            )}
          </Panel>

          <Panel title="System" icon={Activity} tone="neutral">
            <dl className="divide-y divide-dashed">
              <KeyValue label="Vendor / model">ZTE {oidProfileLabel(o.oidProfile)}</KeyValue>
              <KeyValue label="Firmware">
                <span className="line-clamp-2" title={o.firmware ?? undefined}>
                  {o.firmware ?? '—'}
                </span>
              </KeyValue>
              <KeyValue label="Management IP" mono>
                {o.mgmtIp}
              </KeyValue>
              <KeyValue label="OID profile" mono>
                {o.oidProfile}
              </KeyValue>
              <KeyValue label="SNMP">{o.snmpVersion === 'v3' ? 'v3 authPriv' : 'v2c'}</KeyValue>
              <KeyValue label="CLI (SSH)">{o.cliEnabled ? 'Enabled' : 'Disabled'}</KeyValue>
              <KeyValue label="Uptime">
                <NAValue />
              </KeyValue>
              <KeyValue label="PON ports">
                {ports.length} detected · up <NAValue />
              </KeyValue>
              <KeyValue label="Last poll">{o.lastPollOkAt ? `${dateTime(o.lastPollOkAt)} (${age(o.dataAgeS)} ago)` : 'never'}</KeyValue>
            </dl>
            <div className="mt-3">
              <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                <span>Uplink load</span>
                <NAValue />
              </div>
              <SegmentBar value={null} segments={32} />
            </div>
          </Panel>
        </div>

        <IdentityPanel oltId={o.id} />
        {can(me.role, 'adminOlts') && <CliPanel olt={o} />}

        <Panel title="CPU & temperature · last 24h" icon={Cpu} tone="primary">
          <Empty icon={<Activity />}>
            <NAValue /> — OLT metrics (CPU, memory, temperature) are not collected yet.
          </Empty>
        </Panel>

        <Panel
          title={port ? `ONUs on PON 1/${port}` : 'ONUs on this OLT'}
          icon={Router}
          tone="info"
          flush
          action={port && <Pill tone="primary">Filtered</Pill>}
        >
          <OnuTable onus={table.data?.items ?? []} showOlt={false} />
          {table.data && table.data.items.length === 0 && <Empty>No ONUs yet.</Empty>}
          <Paginator page={page} pages={pages} total={table.data?.total ?? 0} onPage={setPage} />
        </Panel>

        {can(me.role, 'runJobs') && <UnsavedPanel oltId={o.id} />}
        {can(me.role, 'manageOlts') && <ProvisionListsPanel oltId={o.id} />}
        {can(me.role, 'manageOlts') && <DeleteOltPanel olt={o} />}
      </PageBody>
    </div>
  );
}
