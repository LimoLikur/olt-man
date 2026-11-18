import type { OnuView } from '@olt/shared/dto';
import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ago, dateTime, dbm, onuStatusText, plural } from '../../format';
import { useOlts } from '../../queries';
import { Button, Table, Td, Th } from '../ui';
import { MockBadge, NAValue, PhaseBadge, RxValue } from './status';

/** "Last seen": now while online, else when it last changed (or the last known state while the OLT is down). */
function lastSeen(o: OnuView): { text: string; title: string } {
  if (o.oltStatus !== 'ok') return { text: ago(o.updatedAt), title: dateTime(o.updatedAt) };
  if (o.phase === 'working') return { text: 'Now', title: `Online since ${dateTime(o.lastChangeAt)}` };
  return { text: ago(o.lastChangeAt), title: dateTime(o.lastChangeAt) };
}

/** ONU rows; a click anywhere opens the ONU. Customer ID and distance are not collected per ONU: N/A. */
export function OnuTable({ onus, showOlt = true }: { onus: OnuView[]; showOlt?: boolean }) {
  const navigate = useNavigate();
  const olts = useOlts();
  const mock = new Set((olts.data ?? []).filter((o) => o.isMock).map((o) => o.id));
  const open = (e: MouseEvent, id: number) => {
    if ((e.target as HTMLElement).closest('a')) return;
    navigate(`/onus/${id}`);
  };
  return (
    <Table>
      <thead>
        <tr>
          <Th>Serial number</Th>
          <Th>Customer</Th>
          {showOlt && <Th>OLT</Th>}
          <Th>PON / ID</Th>
          <Th>Status</Th>
          <Th className="text-right">Rx ONU</Th>
          <Th className="text-right">Rx OLT</Th>
          <Th className="text-right">Distance</Th>
          <Th className="text-right">Last seen</Th>
        </tr>
      </thead>
      <tbody>
        {onus.map((o) => {
          const seen = lastSeen(o);
          return (
            <tr key={o.id} data-testid="onu-row" className="cursor-pointer" onClick={(e) => open(e, o.id)}>
              <Td className="font-mono text-[13px]">
                <Link to={`/onus/${o.id}`} className="hover:text-primary">
                  {o.sn}
                </Link>
              </Td>
              <Td>
                <div className="font-medium">{o.name ?? '—'}</div>
                <div className="text-xs text-muted-foreground">
                  ID <NAValue title="Customer ID: not available in OLT-MAN" />
                </div>
              </Td>
              {showOlt && (
                <Td className="whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    {o.oltName}
                    {mock.has(o.oltId) && <MockBadge />}
                  </span>
                </Td>
              )}
              <Td className="whitespace-nowrap font-mono text-[13px] text-muted-foreground">
                1/{o.slot}/{o.port}:{o.onuIndex}
              </Td>
              <Td>
                <PhaseBadge phase={o.phase} oltStatus={o.oltStatus} text={onuStatusText(o.phase, o.oltStatus, o.updatedAt)} />
              </Td>
              <Td className="text-right">
                <RxValue value={o.rxDbm} />
              </Td>
              <Td className="numeric whitespace-nowrap text-right font-mono text-[13px] text-muted-foreground">{dbm(o.oltRxDbm)}</Td>
              <Td className="text-right">
                <NAValue title="Distance is read per ONU with “Refresh from OLT” on its page" />
              </Td>
              <Td className="whitespace-nowrap text-right text-muted-foreground">
                <span title={seen.title}>{seen.text}</span>
              </Td>
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

export function Paginator({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
      <span className="numeric">{plural(total, 'result')}</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <span className="numeric px-1">
          {page} / {Math.max(1, pages)}
        </span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
