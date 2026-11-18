import type { OnuView } from '@olt/shared/dto';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Router, Search, X } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { api } from '../api';
import { OnuTable, Paginator } from '../components/app/onu-table';
import { PageBody, PageHeader } from '../components/app/panel';
import { Pill } from '../components/app/status';
import { Empty, Input, Select, Tabs } from '../components/ui';
import { plural } from '../format';
import { useOlts, useOnuCount } from '../queries';

const FILTERS = ['oltId', 'slot', 'port', 'phase', 'rx', 'q', 'page'] as const;
const LIMIT = 50;
type PhaseTab = '' | 'working' | 'offline' | 'los' | 'dying_gasp';

export function OnusPage() {
  const [params, setParams] = useSearchParams();
  const qs = new URLSearchParams();
  for (const k of FILTERS) {
    const v = params.get(k);
    if (v) qs.set(k, v);
  }
  qs.set('limit', String(LIMIT));
  const olts = useOlts();
  const list = useQuery({ queryKey: ['onus', qs.toString()], queryFn: () => api.get<{ total: number; page: number; items: OnuView[] }>(`/onus?${qs}`), placeholderData: keepPreviousData });

  // Tab counts use the same filters as the list, without phase and page.
  const scope: Record<string, string> = {};
  for (const k of ['oltId', 'slot', 'port', 'rx', 'q'] as const) {
    const v = params.get(k);
    if (v) scope[k] = v;
  }
  const counts = {
    '': useOnuCount(scope).data,
    working: useOnuCount({ ...scope, phase: 'working' }).data,
    offline: useOnuCount({ ...scope, phase: 'offline' }).data,
    los: useOnuCount({ ...scope, phase: 'los' }).data,
    dying_gasp: useOnuCount({ ...scope, phase: 'dying_gasp' }).data,
  };

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next);
  };
  const clearPort = () => {
    const next = new URLSearchParams(params);
    next.delete('slot');
    next.delete('port');
    next.delete('page');
    setParams(next);
  };
  const page = Number(params.get('page') ?? 1);
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / LIMIT)) : 1;
  const phase = (params.get('phase') ?? '') as PhaseTab;
  const slot = params.get('slot');
  const port = params.get('port');

  return (
    <div>
      <PageHeader title="ONUs" subtitle={`${plural(counts[''] ?? 0, 'optical network unit')} across ${plural(olts.data?.length ?? 0, 'OLT')}`} />
      <PageBody className="space-y-4">
        <form className="flex flex-wrap items-center gap-3" onSubmit={(e) => e.preventDefault()}>
          <div className="relative w-full max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Search ONUs" placeholder="Serial number, customer name or ONU ID" defaultValue={params.get('q') ?? ''} onChange={(e) => set('q', e.target.value.trim())} className="pl-9" />
          </div>
          <Select aria-label="OLT" value={params.get('oltId') ?? ''} onChange={(e) => set('oltId', e.target.value)} className="w-48">
            <option value="">All OLTs</option>
            {olts.data?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Rx" value={params.get('rx') ?? ''} onChange={(e) => set('rx', e.target.value)} className="w-52">
            <option value="">All Rx levels</option>
            <option value="ok">Rx normal (≥ −25)</option>
            <option value="warn">Rx warning (−27…−25)</option>
            <option value="crit">Rx critical (&lt; −27)</option>
          </Select>
          {slot && port && (
            <Pill tone="primary" className="h-7">
              PON 1/{slot}/{port}
              <button type="button" onClick={clearPort} aria-label="Clear PON filter" className="-mr-1 rounded p-0.5 hover:bg-primary/10">
                <X className="size-3" />
              </button>
            </Pill>
          )}
        </form>

        <div className="panel overflow-hidden">
          <Tabs<PhaseTab>
            label="ONU status"
            className="border-b"
            value={phase}
            onChange={(v) => set('phase', v)}
            items={[
              { value: '', label: 'All', count: counts[''] },
              { value: 'working', label: 'Online', count: counts.working },
              { value: 'offline', label: 'Offline', count: counts.offline },
              { value: 'los', label: 'LOS', count: counts.los },
              { value: 'dying_gasp', label: 'Dying gasp', count: counts.dying_gasp },
            ]}
          />
          <OnuTable onus={list.data?.items ?? []} />
          {list.data && list.data.items.length === 0 && <Empty icon={<Router />}>No ONUs match these filters.</Empty>}
          <Paginator page={page} pages={pages} total={list.data?.total ?? 0} onPage={(p) => set('page', String(p))} />
        </div>
      </PageBody>
    </div>
  );
}
