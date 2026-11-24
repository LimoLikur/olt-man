import type { OltSummary } from '@olt/shared/dto';
import { KeyRound, MapPin, Pin, Server } from 'lucide-react';
import { type MouseEvent, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '../../api';
import { useMe } from '../../auth';
import { AGE_TARGET_S, age, ageLate, oidProfileLabel } from '../../format';
import { type Identity, IDENTITY_KIND_LABEL, type IdentityRow, probeState, probeText } from '../../identity';
import { can } from '../../permissions';
import { portStats } from '../../pon';
import { useIdentity, useOltOnus, usePinIdentity } from '../../queries';
import { Button, cx } from '../ui';
import { IconTile } from './panel';
import { PonLegend, PonTiles } from './pon-tiles';
import { IdentityBadge, MockBadge, NAValue, OltStatusBadge } from './status';

/**
 * OLT summary card: status, one tile per PON port, and the identity keys at the bottom. A click
 * anywhere opens the OLT (the name is the link for keyboards), except on buttons and key values:
 * one click selects a value, to compare it with the OLT console. Location is not collected: N/A.
 */
export function OltCard({ olt }: { olt: OltSummary }) {
  const me = useMe();
  const navigate = useNavigate();
  const onus = useOltOnus(olt.id, 30_000);
  const ports = useMemo(() => portStats(onus.data ?? []), [onus.data]);
  // Identity keys are for admin and NOC (GET is 403 for teknisi); both may pin (SPEC §8.4 step 2).
  const canPin = can(me.role, 'manageOlts');
  const identity = useIdentity(olt.id, { enabled: canPin });
  const pin = usePinIdentity(olt.id);
  const [confirming, setConfirming] = useState(false);

  const candidates = identity.data?.candidates ?? [];
  const quarantined = olt.status === 'quarantined';
  // "pin" adds identity kinds that were never pinned; a changed key goes through quarantine instead.
  const showPin = canPin && !quarantined && (olt.identityLevel === 'unpinned' || candidates.length > 0);
  const pinnable = showPin && candidates.length > 0;
  const open = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, button, code, [data-no-open]') || window.getSelection()?.toString()) return;
    navigate(`/olts/${olt.id}`);
  };

  return (
    <div
      data-testid="olt-card"
      onClick={open}
      className="panel panel-interactive flex cursor-pointer flex-col p-4 has-[a:focus-visible]:ring-[3px] has-[a:focus-visible]:ring-ring"
    >
      <div className="flex items-start gap-3">
        <IconTile icon={Server} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`/olts/${olt.id}`} className="truncate text-[15px] font-medium outline-none hover:text-primary">
              {olt.name}
            </Link>
            <span className="tag-mono">{oidProfileLabel(olt.oidProfile)}</span>
            {olt.isMock && <MockBadge />}
          </div>
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 truncate text-sm text-muted-foreground">
              <MapPin className="size-3.5 shrink-0" />
              <NAValue title="Location: not available in OLT-MAN" />
            </span>
            <OltStatusBadge status={olt.status} />
          </div>
        </div>
      </div>
      <div className="divider-dashed my-4" />
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 text-sm">
        <div>
          <div className="text-muted-foreground">ONUs online</div>
          <div className="numeric mt-0.5 font-medium">
            {olt.onus.online}/{olt.onus.total}
          </div>
        </div>
        {ports.length > 0 && <PonLegend compact />}
      </div>
      <div className="mt-3">
        {ports.length > 0 ? (
          <PonTiles ports={ports} compact stale={olt.status !== 'ok'} />
        ) : (
          <div className="flex h-11 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">
            {onus.isPending && olt.onus.total > 0 ? 'Loading ports…' : onus.isError ? 'Port data unavailable' : 'No ONU data yet'}
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <IdentityBadge level={olt.identityLevel} />
          {showPin && !confirming && (
            <span data-no-open title={pinnable ? 'Pin the identity key shown below' : 'No key from the probe yet'} className="inline-flex cursor-auto">
              <Button
                className="h-6 gap-1 px-2"
                size="sm"
                disabled={!pinnable}
                onClick={() => {
                  pin.reset();
                  setConfirming(true);
                }}
              >
                <Pin /> Pin…
              </Button>
            </span>
          )}
        </span>
        <span>
          Not online{' '}
          <span className="numeric font-medium text-foreground" data-testid="olt-offline">
            {olt.onus.offline}
          </span>
        </span>
        <span>
          Alarms <span className="numeric font-medium text-foreground">{olt.activeAlarms}</span>
        </span>
        <span className="ml-auto" title="Time since the last successful poll. Targets: status 2 min, optical (Rx) 10 min.">
          Data age <DataAge seconds={olt.dataAgeS} targetS={AGE_TARGET_S.status} /> · Rx <DataAge seconds={olt.opticalAgeS} targetS={AGE_TARGET_S.optical} testId="olt-optical-age" />
        </span>
      </div>

      {/* Grows to the card bottom, so cards of different heights in a grid row still end with the keys. */}
      <div className="-mx-4 -mb-4 mt-4 flex-1 rounded-b-xl border-t bg-muted/40 px-4 py-3">
        <div className="flex items-center gap-1.5">
          <KeyRound className="size-3.5 text-muted-foreground" />
          <span className="section-label">Identity key</span>
        </div>
        {!canPin ? (
          <p className="mt-1.5 text-xs">
            <NAValue title="Only NOC and admins see OLT identity keys" />
          </p>
        ) : !identity.data ? (
          <p className="mt-1.5 text-xs text-muted-foreground">{identity.isError ? 'Identity unavailable.' : 'Loading…'}</p>
        ) : (
          <IdentityKeys identity={identity.data} quarantined={quarantined} />
        )}
        {pinnable && confirming && (
          <div data-no-open className="mt-3 flex cursor-auto flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary-soft/60 p-2.5">
            <span className="text-xs">
              Pin {candidates.length === 1 ? 'this key' : 'these keys'} for <b>{olt.name}</b>?{olt.status === 'pending_pin' && ' Polling starts after the pin.'}
            </span>
            <span className="ml-auto flex gap-2">
              <Button className="h-7" size="sm" disabled={pin.isPending} onClick={() => pin.mutate(undefined, { onSuccess: () => setConfirming(false) })}>
                {candidates.length === 1 ? 'Pin key' : 'Pin keys'}
              </Button>
              <Button className="h-7" size="sm" variant="outline" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </span>
          </div>
        )}
        {pin.isError && (
          <p role="alert" className="mt-2 text-xs text-critical">
            {pin.error instanceof ApiError ? pin.error.message : 'Failed.'}
          </p>
        )}
      </div>
    </div>
  );
}

/** One data age, orange once it is past its SPEC §8.1 target. */
function DataAge({ seconds, targetS, testId }: { seconds: number | null; targetS: number; testId?: string }) {
  return (
    <span data-testid={testId} className={cx('numeric font-medium', ageLate(seconds, targetS) ? 'text-orange' : 'text-foreground')}>
      {age(seconds)}
    </span>
  );
}

type KeyState = 'pinned' | 'new' | 'observed';
const KEY_STATE: Record<KeyState, [label: string, className: string]> = {
  pinned: ['Pinned', 'text-success'],
  new: ['From probe', 'text-orange'],
  observed: ['Observed now', 'text-critical'],
};

/** Pinned keys and the probe's candidates; while quarantined the candidates are the differing keys. */
function IdentityKeys({ identity, quarantined }: { identity: Identity; quarantined: boolean }) {
  const rows: [IdentityRow, KeyState][] = [...identity.pinned.map((r): [IdentityRow, KeyState] => [r, 'pinned']), ...identity.candidates.map((r): [IdentityRow, KeyState] => [r, quarantined ? 'observed' : 'new'])];
  if (rows.length === 0) {
    const probe = probeState(identity.lastProbe);
    return (
      <p className={cx('mt-1.5 text-xs', probe === 'failed' || probe === 'stalled' ? 'text-critical' : 'text-muted-foreground')}>
        No key yet. {probe === 'running' ? 'The probe is still running.' : probeText(identity.lastProbe)}
      </p>
    );
  }
  const hint = quarantined
    ? 'The OLT now answers with a different key. An admin decides on the OLT page.'
    : identity.candidates.length > 0
      ? 'Compare with the OLT console before pinning.'
      : 'Checked on every poll and CLI session; a different key stops polling.';
  return (
    <>
      <ul className="mt-2 space-y-2">
        {rows.map(([r, state]) => (
          <li key={r.id} className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="font-medium">{IDENTITY_KIND_LABEL[r.kind]}</span>
              {r.algo && <span className="tag-mono">{r.algo}</span>}
              <span className={cx('ml-auto', KEY_STATE[state][1])}>{KEY_STATE[state][0]}</span>
            </div>
            <code className="mt-0.5 block cursor-text select-all break-all font-mono text-[11px] leading-relaxed text-muted-foreground">{r.value}</code>
          </li>
        ))}
      </ul>
      <p className={cx('mt-2 text-xs', quarantined ? 'text-critical' : 'text-muted-foreground')}>{hint}</p>
    </>
  );
}
