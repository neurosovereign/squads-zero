import { useMemo, useRef, useState } from 'react';
import type { PortfolioPoint } from '@/hooks/usePortfolioHistory';
import { cn } from '@/lib/utils';

type Range = '7D' | '30D' | 'ALL';
const RANGES: Range[] = ['7D', '30D', 'ALL'];
const RANGE_DAYS: Record<Range, number | null> = { '7D': 7, '30D': 30, ALL: null };

const W = 720;
const H = 240;
const PAD = { t: 14, r: 10, b: 26, l: 56 };

const fmtUsd = (v: number): string =>
  v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const fmtUsdShort = (v: number): string =>
  v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`;

const fmtDay = (t: number, spanDays: number): string => {
  const d = new Date(t);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(spanDays > 370 ? { year: '2-digit' as const } : {}),
  });
};

/** Catmull-Rom → cubic bezier for a smooth line through sparse daily points. */
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y}`;
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export function PortfolioChart({
  series,
  approximated,
  onNeedAll,
}: {
  series: PortfolioPoint[];
  approximated: string[];
  /** Fired when the user selects ALL — the parent loads the full history. */
  onNeedAll?: () => void;
}) {
  const [range, setRange] = useState<Range>('7D');
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const points = useMemo(() => {
    const span = RANGE_DAYS[range];
    if (span == null) return series;
    const cutoff = Date.now() - span * 24 * 60 * 60 * 1000;
    const sliced = series.filter((p) => p.t >= cutoff);
    // keep one anchor point before the window so the line starts at the true level
    const before = series.filter((p) => p.t < cutoff);
    return before.length > 0 ? [before[before.length - 1], ...sliced] : sliced;
  }, [series, range]);

  const delta = useMemo(() => {
    if (points.length < 2) return null;
    const first = points[0].v;
    const last = points[points.length - 1].v;
    if (first <= 0) return null;
    return { abs: last - first, pct: ((last - first) / first) * 100 };
  }, [points]);

  const geom = useMemo(() => {
    if (points.length === 0) return null;
    const vs = points.map((p) => p.v);
    const vMin = Math.min(...vs);
    const vMax = Math.max(...vs);
    const span = vMax - vMin || vMax || 1;
    const lo = vMin - span * 0.12;
    const hi = vMax + span * 0.12;
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t || t0 + 1;
    const x = (t: number) =>
      PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    const pts = points.map((p) => ({ x: x(p.t), y: y(p.v) }));
    const line = smoothPath(pts);
    const area =
      pts.length > 1
        ? `${line} L ${pts[pts.length - 1].x} ${H - PAD.b} L ${pts[0].x} ${H - PAD.b} Z`
        : '';
    const ticks = [0, 1, 2, 3].map((i) => lo + ((hi - lo) * (i + 0.5)) / 3.5);
    const spanDays = Math.max(1, (t1 - t0) / (24 * 60 * 60 * 1000));
    return { pts, line, area, ticks, x, y, spanDays };
  }, [points]);

  const onMove = (e: React.MouseEvent) => {
    if (!geom || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const fx = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestDist = Infinity;
    geom.pts.forEach((p, i) => {
      const d = Math.abs(p.x - fx);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    });
    setHover(best);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-2">
        <div className="font-mono text-xs">
          {delta ? (
            <span className={delta.abs >= 0 ? 'text-success' : 'text-destructive'}>
              {delta.abs >= 0 ? '+' : ''}
              {fmtUsd(delta.abs)} ({delta.pct >= 0 ? '+' : ''}
              {delta.pct.toFixed(1)}%)
              <span className="ml-1 text-muted-foreground/60">{range}</span>
            </span>
          ) : (
            <span className="text-muted-foreground/60">—</span>
          )}
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setRange(r);
                if (r === 'ALL') onNeedAll?.();
              }}
              className={cn(
                'rounded-md px-2 py-1 font-display text-[11px] font-medium tracking-wide transition-colors',
                range === r
                  ? 'solana-gradient text-[hsl(200_60%_6%)]'
                  : 'text-muted-foreground hover:bg-primary/10 hover:text-primary'
              )}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="relative mt-2 min-h-0 flex-1">
        {points.length < 2 ? (
          <div className="flex h-full min-h-[160px] items-center justify-center text-sm text-muted-foreground">
            Not enough history yet — the chart fills in as the vaults move funds.
          </div>
        ) : geom ? (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="h-full w-full"
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
          >
            <defs>
              <linearGradient id="solLine" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#14F195" />
                <stop offset="50%" stopColor="#36cfe3" />
                <stop offset="100%" stopColor="#9945FF" />
              </linearGradient>
              <linearGradient id="solArea" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#14F195" stopOpacity="0.16" />
                <stop offset="100%" stopColor="#9945FF" stopOpacity="0.1" />
              </linearGradient>
            </defs>

            {geom.ticks.map((v, i) => (
              <g key={i}>
                <line
                  x1={PAD.l}
                  x2={W - PAD.r}
                  y1={geom.y(v)}
                  y2={geom.y(v)}
                  stroke="hsl(0 0% 100% / 0.05)"
                  strokeWidth="1"
                />
                <text
                  x={PAD.l - 8}
                  y={geom.y(v) + 3}
                  textAnchor="end"
                  className="fill-muted-foreground"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                  opacity="0.7"
                >
                  {fmtUsdShort(v)}
                </text>
              </g>
            ))}

            {geom.area && <path d={geom.area} fill="url(#solArea)" />}
            <path
              d={geom.line}
              fill="none"
              stroke="url(#solLine)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
            />

            {hover != null && geom.pts[hover] && (
              <g>
                <line
                  x1={geom.pts[hover].x}
                  x2={geom.pts[hover].x}
                  y1={PAD.t}
                  y2={H - PAD.b}
                  stroke="hsl(154 88% 52% / 0.3)"
                  strokeDasharray="3 3"
                />
                <circle
                  cx={geom.pts[hover].x}
                  cy={geom.pts[hover].y}
                  r="4"
                  fill="#14F195"
                  stroke="hsl(200 30% 4%)"
                  strokeWidth="2"
                />
              </g>
            )}

            {[0, 0.5, 1].map((f) => {
              const idx = Math.round(f * (geom.pts.length - 1));
              const p = geom.pts[idx];
              if (!p) return null;
              return (
                <text
                  key={f}
                  x={p.x}
                  y={H - 8}
                  textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}
                  className="fill-muted-foreground"
                  fontSize="10"
                  fontFamily="JetBrains Mono, monospace"
                  opacity="0.6"
                >
                  {fmtDay(points[idx].t, geom.spanDays)}
                </text>
              );
            })}
          </svg>
        ) : null}

        {hover != null && geom?.pts[hover] && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-primary/25 bg-black/80 px-2.5 py-1.5 text-center backdrop-blur-md"
            style={{
              left: `${(geom.pts[hover].x / W) * 100}%`,
              top: 0,
            }}
          >
            <p className="font-mono text-xs text-foreground">{fmtUsd(points[hover].v)}</p>
            <p className="font-mono text-[10px] text-muted-foreground">
              {fmtDay(points[hover].t, geom.spanDays)}
            </p>
          </div>
        )}
      </div>

      {approximated.length > 0 && (
        <p className="mt-1 text-[11px] text-muted-foreground/60">
          {approximated.join(', ')} valued at current price (no historical feed) · native stake
          movements not tracked
        </p>
      )}
    </div>
  );
}
