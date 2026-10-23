'use client';

import { useState } from 'react';
import { cx } from './ui';

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  /** tooltip lines */
  detail?: string;
}

/**
 * Single-series column chart: one hue (shop pink), no legend (the title names the series),
 * 4px rounded data-ends on the baseline, 2px gaps, recessive grid, hover tooltip per bar,
 * and a table view for screen readers / exact numbers.
 */
export function BarChart({
  data,
  format,
  height = 220,
  labelEvery = 1,
  highlightKey,
  ariaLabel,
}: {
  data: BarDatum[];
  format: (v: number) => string;
  height?: number;
  labelEvery?: number;
  highlightKey?: string;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(1, ...data.map((d) => d.value));
  const nice = niceMax(max);
  const W = 640;
  const H = height;
  const padL = 8;
  const padB = 24;
  const plotH = H - padB - 8;
  const step = (W - padL) / Math.max(1, data.length);
  const barW = Math.max(4, step - 2);
  const y = (v: number) => 8 + plotH - (v / nice) * plotH;

  if (asTable) {
    return (
      <div>
        <button className="mb-2 text-xs font-semibold text-brand" onClick={() => setAsTable(false)}>
          Show chart
        </button>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line/60">
            {data.map((d) => (
              <tr key={d.key}>
                <td className="py-1.5 text-muted">{d.label}</td>
                <td className="tabular py-1.5 text-right">{format(d.value)}</td>
                {d.detail && <td className="py-1.5 pl-3 text-right text-xs text-faint">{d.detail}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="mb-1 flex items-center justify-between text-xs text-faint">
        <span className="tabular">max {format(nice)}</span>
        <button className="font-semibold text-brand" onClick={() => setAsTable(true)}>
          View as table
        </button>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} x1={padL} x2={W} y1={y(nice * t)} y2={y(nice * t)} stroke="currentColor" className="text-line" strokeDasharray="2 4" strokeWidth={1} />
        ))}
        <line x1={padL} x2={W} y1={y(0)} y2={y(0)} stroke="currentColor" className="text-line" strokeWidth={1} />
        {data.map((d, i) => {
          const x = padL + i * step + (step - barW) / 2;
          const top = y(d.value);
          const h = y(0) - top;
          const r = Math.min(4, barW / 2, h);
          const active = hover === i;
          const highlighted = highlightKey === d.key;
          return (
            <g key={d.key}>
              {d.value > 0 && (
                <path
                  d={`M${x},${y(0)} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${y(0)} Z`}
                  className={cx('transition-opacity duration-150', hover != null && !active && 'opacity-50')}
                  fill={highlighted ? '#7a0f3a' : '#c2185b'}
                  style={{ transformOrigin: `0 ${y(0)}px`, animation: `rise 0.6s ${i * 25}ms both` }}
                />
              )}
              {/* hit target: the whole column, bigger than the mark */}
              <rect x={padL + i * step} y={0} width={step} height={H - padB} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${d.label}: ${format(d.value)}`} />
              {i % labelEvery === 0 && (
                <text x={x + barW / 2} y={H - 6} textAnchor="middle" className="fill-muted" fontSize={11}>
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover != null && data[hover] && (
        <div
          className="pointer-events-none absolute top-6 z-10 -translate-x-1/2 animate-pop rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg"
          style={{ left: `${((padL + hover * step + step / 2) / W) * 100}%` }}
        >
          <p className="font-semibold text-ink">{data[hover].label}</p>
          <p className="tabular font-semibold text-brand">{format(data[hover].value)}</p>
          {data[hover].detail && <p className="text-muted">{data[hover].detail}</p>}
        </div>
      )}
    </div>
  );
}

function niceMax(v: number): number {
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return n * exp;
}

/** Horizontal ranked bars (best sellers). Values are direct-labelled; bars are one hue. */
export function RankBars({ rows, format }: { rows: { name: string; value: number; sub?: string }[]; format: (v: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={r.name} className="animate-rise" style={{ animationDelay: `${i * 50}ms` }}>
          <div className="mb-1 flex justify-between gap-2 text-sm">
            <span className="truncate">{r.name}</span>
            <span className="tabular shrink-0 text-muted">
              {format(r.value)}
              {r.sub && <span className="ml-2 text-faint">{r.sub}</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-subtle">
            <div className="h-2 rounded-full bg-brand-strong transition-[width] duration-700" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
