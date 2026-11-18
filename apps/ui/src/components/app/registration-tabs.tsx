import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../../api';
import { useMe } from '../../auth';
import { can } from '../../permissions';
import { cx } from '../ui';

const tab = 'inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors';

function DisabledTab({ children }: { children: ReactNode }) {
  return (
    <span aria-disabled="true" title="N/A — not available" className={cx(tab, 'cursor-not-allowed text-muted-foreground/60')}>
      {children}
    </span>
  );
}

/** Registration sections from the design. History (no job list in the api) is N/A. */
export function RegistrationTabs({ current }: { current: 'new' | 'approvals' }) {
  const me = useMe();
  const canApprove = can(me.role, 'approveRegistration');
  const approvals = useQuery({ queryKey: ['approvals'], queryFn: () => api.get<unknown[]>('/approvals'), enabled: canApprove });
  const link = (active: boolean) => cx(tab, active ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground');
  return (
    <nav aria-label="Registration sections" className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-muted p-1">
      {can(me.role, 'composeRegistration') && (
        <Link to="/provision/new" aria-current={current === 'new' ? 'page' : undefined} className={link(current === 'new')}>
          New registration
        </Link>
      )}
      {canApprove ? (
        <Link to="/approvals" aria-current={current === 'approvals' ? 'page' : undefined} className={link(current === 'approvals')}>
          Approval queue
          {!!approvals.data?.length && <span className="numeric rounded bg-warning-soft px-1.5 text-[11px] text-orange">{approvals.data.length}</span>}
        </Link>
      ) : (
        <DisabledTab>My pending requests</DisabledTab>
      )}
      <DisabledTab>History</DisabledTab>
    </nav>
  );
}
