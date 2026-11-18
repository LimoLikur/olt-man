import { Plus, Search, Server } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '../auth';
import { OltCard } from '../components/app/olt-card';
import { PageBody, PageHeader } from '../components/app/panel';
import { NAValue } from '../components/app/status';
import { buttonClass, Empty, Input, Loading, Segmented } from '../components/ui';
import { plural } from '../format';
import { can } from '../permissions';
import { useOlts } from '../queries';

type StatusFilter = 'all' | 'ok' | 'issues';

/** All OLTs as cards, filtered by name/IP and status. */
export function OltsPage() {
  const me = useMe();
  const olts = useOlts();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const list = useMemo(() => {
    const q = text.trim().toLowerCase();
    return (olts.data ?? []).filter(
      (o) => (status === 'all' || (status === 'ok' ? o.status === 'ok' : o.status !== 'ok')) && (!q || `${o.name} ${o.mgmtIp} ${o.oidProfile}`.toLowerCase().includes(q)),
    );
  }, [olts.data, text, status]);

  if (!olts.data) return <Loading />;
  return (
    <div>
      <PageHeader
        title="OLTs"
        subtitle={
          <>
            {plural(olts.data.length, 'terminal')} · sites <NAValue />
          </>
        }
        actions={
          can(me.role, 'manageOlts') && (
            <Link to="/olts/new" className={buttonClass('primary', 'md')}>
              <Plus /> New OLT
            </Link>
          )
        }
      />
      <PageBody className="space-y-5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input aria-label="Filter terminals" value={text} onChange={(e) => setText(e.target.value)} placeholder="Filter by name, IP or profile" className="pl-9" />
          </div>
          <Segmented
            label="Status"
            value={status}
            onChange={setStatus}
            items={[
              { value: 'all', label: 'All' },
              { value: 'ok', label: 'Operational' },
              { value: 'issues', label: 'With issues' },
            ]}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {list.map((o) => (
            <OltCard key={o.id} olt={o} />
          ))}
        </div>
        {list.length === 0 && (
          <div className="panel">
            <Empty icon={<Server />}>{olts.data.length === 0 ? 'No OLTs registered yet.' : 'No OLTs match these filters.'}</Empty>
          </div>
        )}
      </PageBody>
    </div>
  );
}
