import { useId } from 'react';

/**
 * Illustrated product art, drawn in the shop's style. Used when a product has no photo (imageUrl).
 * The drawing is chosen from the category/product name and tinted by flavor keywords,
 * so a new product like "Matcha Milk Tea" gets a green drink automatically.
 */

type Kind = 'milktea' | 'coffee' | 'soda' | 'frappe' | 'cheesecake' | 'chocolate' | 'takoyaki' | 'rice' | 'pulutan' | 'beer' | 'generic';

function kindOf(category: string, product: string): Kind {
  const s = `${category} ${product}`.toLowerCase();
  if (/takoyaki/.test(s)) return 'takoyaki';
  if (/beer|red horse|san mig|stallion|pale pilsen/.test(s)) return 'beer';
  if (/with rice|rice meal|silog|meal/.test(s)) return 'rice';
  if (/pulutan|fries|stick|lumpia|gambas|chips|crackers|wings|calamares/.test(s)) return 'pulutan';
  if (/frapp/.test(s)) return 'frappe';
  if (/cheesecake/.test(s)) return 'cheesecake';
  if (/soda/.test(s)) return 'soda';
  if (/coffee|latte|macchiato|americano|espresso|mocha|cappuccino/.test(s)) return 'coffee';
  if (/chocolate|cocoa|nutella/.test(s)) return 'chocolate';
  if (/milk ?tea|tea/.test(s)) return 'milktea';
  return 'generic';
}

const FLAVORS: [RegExp, string][] = [
  [/matcha|green tea/, '#8dbf6b'],
  [/taro|ube/, '#a98bd0'],
  [/okinawa|brown sugar|hokkaido/, '#b27a4f'],
  [/wintermelon/, '#e2c48c'],
  [/red velvet/, '#c0414f'],
  [/blueberry|blue/, '#6f84d8'],
  [/strawberry|raspberry|berry/, '#f07799'],
  [/mango/, '#f4b246'],
  [/green apple|apple/, '#9fcd63'],
  [/lychee/, '#f4cfdc'],
  [/lemon|yuzu/, '#f0d652'],
  [/grape/, '#8f52b0'],
  [/kiwi/, '#86bd4a'],
  [/passion/, '#f2a33a'],
  [/cookies|oreo|cookie/, '#6b6264'],
  [/caramel|salted/, '#c88a4a'],
  [/nutella|hazelnut/, '#7b4a2e'],
  [/dark|mocha|chocolate|cocoa/, '#6e412b'],
  [/spanish|vanilla|classic|original|plain/, '#d8b38a'],
];

function tint(product: string, fallback: string) {
  const s = product.toLowerCase();
  return FLAVORS.find(([re]) => re.test(s))?.[1] ?? fallback;
}

const PINK = '#f472b6';
const PINK_SOFT = '#fde8f1';
const INK = '#3a2a35';

/** Clear plastic cup with optional dome lid and straw. Children draw the drink inside. */
function Cup({ uid, children, dome = false, straw = true }: { uid: string; children: React.ReactNode; dome?: boolean; straw?: boolean }) {
  return (
    <>
      {straw && <rect x="62" y="10" width="6" height="40" rx="3" fill={PINK} transform="rotate(12 65 30)" />}
      <defs>
        <clipPath id={`${uid}-cup`}>
          <path d="M36 40 L84 40 L78 104 Q77 108 73 108 L47 108 Q43 108 42 104 Z" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${uid}-cup)`}>{children}</g>
      <path d="M36 40 L84 40 L78 104 Q77 108 73 108 L47 108 Q43 108 42 104 Z" fill="none" stroke={INK} strokeOpacity="0.25" strokeWidth="2" />
      {dome ? (
        <path d="M33 40 Q60 14 87 40 Z" fill="#ffffff" fillOpacity="0.7" stroke={INK} strokeOpacity="0.25" strokeWidth="2" />
      ) : (
        <rect x="32" y="36" width="56" height="6" rx="3" fill="#ffffff" stroke={INK} strokeOpacity="0.25" strokeWidth="2" />
      )}
      <rect x="44" y="64" width="32" height="14" rx="7" fill="#ffffff" fillOpacity="0.85" />
      <text x="60" y="74" textAnchor="middle" fontSize="8" fontWeight="700" fill={PINK} fontFamily="system-ui, sans-serif">
        BREW
      </text>
    </>
  );
}

function Art({ uid, kind, color }: { uid: string; kind: Kind; color: string }) {
  switch (kind) {
    case 'milktea':
      return (
        <Cup uid={uid}>
          <rect x="30" y="46" width="60" height="70" fill={color} />
          {[[48, 100], [56, 103], [64, 100], [72, 102], [52, 95], [60, 96], [68, 95]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="4" fill="#3b2418" />
          ))}
        </Cup>
      );
    case 'coffee':
      return (
        <Cup uid={uid}>
          <rect x="30" y="46" width="60" height="70" fill="#f3e6d8" />
          <rect x="30" y="76" width="60" height="40" fill={color === '#d8b38a' ? '#8b5a3c' : color} />
          <path d="M30 76 Q45 70 60 76 T90 76 V82 H30 Z" fill={color === '#d8b38a' ? '#8b5a3c' : color} opacity="0.6" />
          {[[46, 54], [62, 58], [54, 66]].map(([x, y], i) => (
            <rect key={i} x={x} y={y} width="11" height="11" rx="2" fill="#ffffff" fillOpacity="0.75" transform={`rotate(${i * 15} ${x + 5} ${y + 5})`} />
          ))}
        </Cup>
      );
    case 'soda':
      return (
        <Cup uid={uid}>
          <rect x="30" y="46" width="60" height="70" fill={color} fillOpacity="0.85" />
          <rect x="30" y="46" width="60" height="70" fill={`url(#${uid}-shine)`} />
          <defs>
            <linearGradient id={`${uid}-shine`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.45" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[[44, 96, 3], [52, 84, 2], [66, 92, 3.5], [72, 70, 2], [58, 62, 2.5], [48, 70, 2]].map(([x, y, r], i) => (
            <circle key={i} cx={x} cy={y} r={r} fill="#ffffff" fillOpacity="0.8" />
          ))}
          <circle cx="74" cy="50" r="10" fill={color} stroke="#ffffff" strokeWidth="2" />
        </Cup>
      );
    case 'frappe':
      return (
        <>
          <Cup uid={uid} dome>
            <rect x="30" y="46" width="60" height="70" fill={color} />
            <path d="M34 60 Q42 54 50 60 T66 60 T82 60" stroke="#ffffff" strokeOpacity="0.6" strokeWidth="3" fill="none" />
          </Cup>
          <path d="M40 40 Q42 26 52 28 Q56 18 66 24 Q78 22 80 36 Q82 40 78 40 Z" fill="#ffffff" stroke={INK} strokeOpacity="0.15" strokeWidth="1.5" />
          <path d="M46 32 Q54 36 60 30 Q68 36 74 32" stroke="#6e412b" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </>
      );
    case 'cheesecake':
      return (
        <Cup uid={uid}>
          <rect x="30" y="46" width="60" height="70" fill={color} />
          <rect x="30" y="44" width="60" height="16" fill="#fff6e0" />
          <path d="M30 60 Q38 64 46 60 T62 60 T78 60 T94 60 V64 H30 Z" fill="#fff6e0" />
          {[[46, 100], [56, 102], [66, 100], [74, 103]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="4" fill="#3b2418" />
          ))}
        </Cup>
      );
    case 'chocolate':
      return (
        <Cup uid={uid}>
          <rect x="30" y="46" width="60" height="70" fill={color === '#d8b38a' ? '#6e412b' : color} />
          <path d="M30 50 L36 64 L40 52 L46 70 L52 52 L58 66 L64 50 L70 72 L76 52 L82 62 L90 48 V44 H30 Z" fill="#3e2316" />
        </Cup>
      );
    case 'takoyaki':
      return (
        <>
          <path d="M18 72 L102 72 L92 96 Q90 100 86 100 L34 100 Q30 100 28 96 Z" fill="#f3d9a4" stroke={INK} strokeOpacity="0.2" strokeWidth="2" />
          {[[38, 62], [60, 60], [82, 62], [49, 70], [71, 70]].map(([x, y], i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="13" fill="#d99a4e" />
              <circle cx={x - 4} cy={y - 5} r="4" fill="#f0c27a" opacity="0.7" />
            </g>
          ))}
          <path d="M28 60 Q36 52 44 60 T60 60 T76 60 T92 60" stroke="#4a2a1a" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M30 66 Q38 58 46 66 T62 66 T78 66 T94 66" stroke="#fff8e8" strokeWidth="2" fill="none" strokeLinecap="round" />
          {[[40, 52], [56, 48], [70, 50], [84, 54], [62, 56]].map(([x, y], i) => (
            <path key={i} d={`M${x} ${y} l5 -3 l1 5 z`} fill={color === '#d8b38a' ? '#e7a7c2' : color} />
          ))}
        </>
      );
    case 'rice':
      return (
        <>
          <ellipse cx="60" cy="86" rx="46" ry="14" fill="#ffffff" stroke={INK} strokeOpacity="0.2" strokeWidth="2" />
          <path d="M26 82 Q30 56 50 58 Q58 50 66 58 Q86 56 88 80 Z" fill="#fbf7ef" stroke={INK} strokeOpacity="0.12" strokeWidth="1.5" />
          <path d="M66 74 q6 -10 16 -6 q6 4 2 10 z" fill="#e2763f" />
          <path d="M70 80 q8 -8 16 -2" stroke="#9ccc65" strokeWidth="4" fill="none" strokeLinecap="round" />
        </>
      );
    case 'pulutan':
      return (
        <>
          <path d="M34 60 L86 60 L80 100 Q79 104 75 104 L45 104 Q41 104 40 100 Z" fill={PINK} />
          {[40, 48, 56, 64, 72, 80].map((x, i) => (
            <rect key={i} x={x - 3} y={34 + (i % 3) * 6} width="7" height="32" rx="2" fill="#f2c14e" transform={`rotate(${(i - 2.5) * 6} ${x} 60)`} />
          ))}
          <rect x="44" y="74" width="32" height="14" rx="7" fill="#ffffff" fillOpacity="0.9" />
        </>
      );
    case 'beer':
      return (
        <>
          <path d="M52 14 H68 V34 Q80 44 80 58 V104 Q80 108 76 108 H44 Q40 108 40 104 V58 Q40 44 52 34 Z" fill="#7a4a1d" />
          <rect x="52" y="10" width="16" height="8" rx="2" fill="#c9a227" />
          <rect x="42" y="64" width="36" height="26" rx="4" fill="#ffffff" />
          <rect x="46" y="70" width="28" height="4" rx="2" fill={/light|apple/i.test(color) ? '#3c8d5a' : '#c0392b'} />
          <rect x="50" y="78" width="20" height="3" rx="1.5" fill="#bdbdbd" />
        </>
      );
    default:
      return (
        <Cup uid={uid}>
          <rect x="30" y="46" width="60" height="70" fill={color} />
        </Cup>
      );
  }
}

const DEFAULTS: Record<Kind, string> = {
  milktea: '#d8b38a',
  coffee: '#d8b38a',
  soda: '#f07799',
  frappe: '#c88a4a',
  cheesecake: '#d8b38a',
  chocolate: '#6e412b',
  takoyaki: '#d8b38a',
  rice: '#d8b38a',
  pulutan: '#d8b38a',
  beer: '#d8b38a',
  generic: '#f6a6c9',
};

const TAKOYAKI_TOPPING: [RegExp, string][] = [
  [/cheese/, '#f4c542'],
  [/crab/, '#f08a4b'],
  [/shrimp/, '#f4a0a0'],
  [/octopus/, '#b06aa0'],
  [/bacon/, '#c0414f'],
  [/ham/, '#f2a6b3'],
  [/lasagna/, '#d9534f'],
];

export function ProductArt({ category, product, className = '' }: { category: string; product: string; className?: string }) {
  const uid = useId().replace(/:/g, '');
  const kind = kindOf(category, product);
  const color =
    kind === 'takoyaki'
      ? (TAKOYAKI_TOPPING.find(([re]) => re.test(product.toLowerCase()))?.[1] ?? '#e7a7c2')
      : kind === 'beer'
        ? product
        : tint(product, DEFAULTS[kind]);
  return (
    <svg viewBox="0 0 120 120" className={className} role="img" aria-label={product}>
      <circle cx="60" cy="62" r="54" fill={PINK_SOFT} />
      <Art uid={uid} kind={kind} color={color} />
    </svg>
  );
}
