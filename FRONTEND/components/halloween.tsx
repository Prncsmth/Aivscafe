/* Halloween decorations in Aiv's Cafe pink — used on the login page only. All decorative (aria-hidden). */

export function Cobweb({ className = '', flip = false }: { className?: string; flip?: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 120 120"
      className={`pointer-events-none ${className}`}
      style={flip ? { transform: 'scaleX(-1)' } : undefined}
      fill="none"
      stroke="currentColor"
      strokeWidth="0.9"
      strokeLinecap="round"
    >
      <path d="M0 0 L120 60 M0 0 L95 95 M0 0 L60 120 M0 0 L120 22 M0 0 L22 120" />
      <path d="M24 12 Q30 22 20 26 Q24 20 12 24" />
      <path d="M48 24 Q52 44 34 40 Q40 52 24 48" />
      <path d="M72 36 Q74 64 52 58 Q60 76 36 72" />
      <path d="M96 48 Q96 86 70 78 Q80 102 48 96" />
      <path d="M110 55 Q108 104 85 92 Q92 118 55 110" />
    </svg>
  );
}

export function Spider({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden className={`halloween-motion pointer-events-none origin-top animate-[hw-swing_4s_ease-in-out_infinite] ${className}`}>
      <div className="mx-auto h-14 w-px bg-[#f6a6c9]/40" />
      <svg viewBox="0 0 40 30" className="mx-auto -mt-1 h-6 w-8 text-[#f6a6c9]" fill="currentColor">
        <ellipse cx="20" cy="16" rx="7" ry="8" />
        <circle cx="20" cy="7" r="4.5" />
        <g stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round">
          <path d="M14 13 Q6 8 2 12 M14 17 Q5 16 1 21 M15 21 Q8 24 5 29 M26 13 Q34 8 38 12 M26 17 Q35 16 39 21 M25 21 Q32 24 35 29" />
        </g>
        <circle cx="18.3" cy="6.5" r="1" fill="#150a17" />
        <circle cx="21.7" cy="6.5" r="1" fill="#150a17" />
      </svg>
    </div>
  );
}

export function Bat({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 64 32" className={className} fill="currentColor">
      <path d="M32 10 C28 4 20 2 12 4 C16 8 14 12 8 13 C4 13 1 16 0 20 C6 17 10 20 13 24 C16 19 22 19 26 22 C27 18 29 16 32 16 C35 16 37 18 38 22 C42 19 48 19 51 24 C54 20 58 17 64 20 C63 16 60 13 56 13 C50 12 48 8 52 4 C44 2 36 4 32 10 Z" />
      <circle cx="29.5" cy="12" r="1.2" fill="#150a17" />
      <circle cx="34.5" cy="12" r="1.2" fill="#150a17" />
    </svg>
  );
}

export function Ghost({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 60 70" className={className}>
      <path d="M30 2 C14 2 6 14 6 30 L6 64 L13 58 L20 66 L27 58 L33 66 L40 58 L47 66 L54 58 L54 30 C54 14 46 2 30 2 Z" fill="#fff7fb" />
      <ellipse cx="22" cy="28" rx="3.6" ry="5" fill="#2a172e" />
      <ellipse cx="38" cy="28" rx="3.6" ry="5" fill="#2a172e" />
      <path d="M25 40 Q30 45 35 40" stroke="#2a172e" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <ellipse cx="16" cy="37" rx="4" ry="2.4" fill="#f6a6c9" opacity="0.8" />
      <ellipse cx="44" cy="37" rx="4" ry="2.4" fill="#f6a6c9" opacity="0.8" />
    </svg>
  );
}

/** A pink pumpkin — the shop's pink, Halloween's shape. */
export function PinkPumpkin({ className = '', face = true }: { className?: string; face?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 80 72" className={className}>
      <defs>
        <radialGradient id="hw-pump" cx="0.4" cy="0.35" r="0.75">
          <stop offset="0" stopColor="#fbcfe8" />
          <stop offset="0.6" stopColor="#f472b6" />
          <stop offset="1" stopColor="#be185d" />
        </radialGradient>
      </defs>
      <path d="M38 14 C37 8 40 3 46 2 C44 6 43 10 44 14 Z" fill="#7ee2b8" />
      <ellipse cx="24" cy="42" rx="18" ry="26" fill="url(#hw-pump)" />
      <ellipse cx="56" cy="42" rx="18" ry="26" fill="url(#hw-pump)" />
      <ellipse cx="40" cy="42" rx="20" ry="28" fill="url(#hw-pump)" />
      <path d="M40 15 Q34 42 40 70 M40 15 Q46 42 40 70" stroke="#be185d" strokeOpacity="0.45" strokeWidth="1.5" fill="none" />
      {face && (
        <g fill="#2a172e">
          <path d="M26 34 L33 30 L33 38 Z" />
          <path d="M54 34 L47 30 L47 38 Z" />
          <path d="M24 48 Q40 62 56 48 L50 50 L46 46 L42 51 L38 46 L34 51 L30 46 Z" />
        </g>
      )}
    </svg>
  );
}

export function Sparkle({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} style={style} fill="currentColor">
      <path d="M12 0 C13 7 17 11 24 12 C17 13 13 17 12 24 C11 17 7 13 0 12 C7 11 11 7 12 0 Z" />
    </svg>
  );
}

/** Slow bats crossing the top of the screen. */
export function FlyingBats({ count = 3 }: { count?: number }) {
  return (
    <div aria-hidden className="halloween-motion pointer-events-none absolute inset-x-0 top-0 h-40 overflow-hidden">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="absolute left-0 text-[#f6a6c9]/60"
          style={{ top: `${18 + i * 34}px`, animation: `hw-fly ${20 + i * 5}s linear ${i * -6.5}s infinite` }}
        >
          <Bat className="h-5 w-10" />
        </div>
      ))}
    </div>
  );
}

export function SparkleField() {
  const spots = [
    [8, 18, 0], [22, 70, 0.6], [40, 12, 1.2], [63, 82, 0.3], [78, 26, 0.9], [90, 64, 1.5], [52, 48, 2],
  ];
  return (
    <div aria-hidden className="halloween-motion pointer-events-none absolute inset-0">
      {spots.map(([x, y, d], i) => (
        <Sparkle
          key={i}
          className="absolute h-3 w-3 text-[#fde4ef]"
          style={{ left: `${x}%`, top: `${y}%`, animation: `hw-twinkle 2.4s ease-in-out ${d}s infinite` }}
        />
      ))}
    </div>
  );
}

/** Infinite ticker strip (like a night-market banner). */
export function Marquee({ items }: { items: string[] }) {
  const row = [...items, ...items];
  return (
    <div className="relative overflow-hidden border-y border-[#43284a] bg-[#1f1122]/80 py-2.5">
      <div className="flex w-max gap-8 whitespace-nowrap" style={{ animation: 'hw-marquee 28s linear infinite' }}>
        {row.map((t, i) => (
          <span key={i} className="flex items-center gap-8 text-sm font-semibold tracking-[0.2em] text-[#fde4ef] uppercase">
            {t}
            <Sparkle className="h-3 w-3 text-[#f472b6]" />
          </span>
        ))}
      </div>
    </div>
  );
}
