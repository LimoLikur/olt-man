import { type PortStats, portTitle } from '../../pon';
import { cx } from '../ui';

/** Any LOS: red; any Rx below −25 dBm: amber; else violet, darker for ports with more ONUs. */
function tileClass(p: PortStats, busiest: number) {
  if (p.los > 0) return 'border-critical/40 bg-critical-soft text-critical';
  if (p.lowRx > 0) return 'border-warning/50 bg-warning-soft text-orange';
  const share = busiest ? p.total / busiest : 0;
  if (share > 0.66) return 'border-primary/40 bg-primary text-primary-foreground';
  if (share > 0.33) return 'border-primary/30 bg-primary/70 text-primary-foreground';
  return 'border-primary/25 bg-primary/25 text-foreground';
}

/**
 * One tile per PON port that has ONUs: "1/slot/port" and its number of registered ONUs. With
 * `onSelect` the tiles are toggle buttons (OLT page); without it they are plain boxes, because the
 * OLT card around them is a link. `compact` sizes the grid to its container (OLT card). `stale`
 * fades the tiles: the ONU phases are the last known ones while the OLT is not operational.
 */
export function PonTiles({
  ports,
  selected = null,
  onSelect,
  compact = false,
  stale = false,
}: {
  ports: readonly PortStats[];
  selected?: string | null;
  onSelect?: (key: string) => void;
  compact?: boolean;
  stale?: boolean;
}) {
  const busiest = Math.max(0, ...ports.map((p) => p.total));
  return (
    <div className="@container">
      <div className={cx('grid', compact ? 'grid-cols-4 gap-1.5 @xs:grid-cols-6 @md:grid-cols-8' : 'grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-8', stale && 'opacity-60')}>
        {ports.map((p) => {
          const title = stale ? `Last known · ${portTitle(p)}` : portTitle(p);
          const className = cx('flex flex-col justify-between border text-left', compact ? 'h-11 rounded-md px-1.5 py-1' : 'aspect-[5/4] rounded-lg p-2', tileClass(p, busiest));
          const body = (
            <>
              <span className={cx('font-mono opacity-90', compact ? 'text-[10px] leading-none' : 'text-[11px]')}>1/{p.key}</span>
              <span className={cx('numeric font-semibold', compact ? 'text-xs leading-none' : 'text-sm')}>{p.total}</span>
            </>
          );
          if (!onSelect)
            return (
              <div key={p.key} title={title} className={className}>
                {body}
              </div>
            );
          return (
            <button
              key={p.key}
              type="button"
              data-testid="pon-tile"
              aria-pressed={selected === p.key}
              onClick={() => onSelect(p.key)}
              title={title}
              className={cx(className, 'transition-transform hover:-translate-y-0.5', selected === p.key && 'ring-2 ring-ring ring-offset-2 ring-offset-card')}
            >
              {body}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const LEGEND = [
  ['bg-primary', 'Healthy', 'Healthy (darker = more ONUs)'],
  ['border border-warning/50 bg-warning-soft', 'Low Rx', 'Low Rx'],
  ['border border-critical/40 bg-critical-soft', 'Has LOS', 'Has LOS'],
] as const;

/** Colour key of the port tiles. */
export function PonLegend({ compact = false }: { compact?: boolean }) {
  return (
    <span className={cx('flex flex-wrap items-center text-muted-foreground', compact ? 'gap-x-3 gap-y-1 text-xs' : 'gap-x-5 gap-y-2 text-sm')}>
      {LEGEND.map(([swatch, short, long]) => (
        <span key={short} className={cx('flex items-center', compact ? 'gap-1.5' : 'gap-2')}>
          <span className={cx(compact ? 'size-2.5 rounded-sm' : 'size-3.5 rounded', swatch)} />
          {compact ? short : long}
        </span>
      ))}
    </span>
  );
}
