'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ApiError, NetworkError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { usePos } from '@/lib/offline/pos-context';
import { peso, percentOf } from '@/lib/money';
import { TYPE_LABEL, fmtDateTime } from '@/lib/format';
import {
  addToCart,
  cartTotals,
  checkPayments,
  modifiersTotal,
  setQuantity,
  toOnlineRequest,
  type CartLine,
  type CheckoutDraft,
  type PaymentDraft,
} from '@/lib/pos/cart';
import type { Catalog, CatalogProduct, CatalogVariant, Order, OrderType } from '@/lib/types';
import { Badge, Button, ErrorNote, Field, Modal, MoneyField, SelectField, TextArea, cx } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';
import { ProductArt } from '@/components/product-art';
import { ReceiptModal, offlineToReceipt, orderToReceipt, type ReceiptData } from '@/components/receipt';
import { useToast } from '@/components/toast';

type PayMode = 'CASH' | 'GCASH' | 'SPLIT' | 'LATER';

const emptyDelivery = { customerName: '', contactNumber: '', address: '', areaId: '', instructions: '' };

export default function PosPage() {
  const { user } = useAuth();
  const { catalog, catalogSavedAt, online, settings, shift, refreshCatalog, saveOffline } = usePos();
  // Walk-in only (default): buy and pay at the counter, the sale is completed at once.
  const walkInOnly = settings?.walkInOnly ?? true;
  const toast = useToast();

  const [category, setCategory] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [picking, setPicking] = useState<CatalogProduct | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);

  // checkout state
  const [type, setType] = useState<OrderType>('WALK_IN');
  const [customerName, setCustomerName] = useState('');
  const [notes, setNotes] = useState('');
  const [delivery, setDelivery] = useState(emptyDelivery);
  const [discount, setDiscount] = useState<number | null>(null);
  const [discountReason, setDiscountReason] = useState('');
  const [payMode, setPayMode] = useState<PayMode>('CASH');
  const [tendered, setTendered] = useState<number | null>(null);
  const [gcashAmount, setGcashAmount] = useState<number | null>(null);
  const [gcashRef, setGcashRef] = useState('');
  const [gcashChecked, setGcashChecked] = useState(false);
  // Quick sale: the customer is at the counter, so a paid order is recorded as completed at once.
  const [servedNow, setServedNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shortages, setShortages] = useState<{ name: string; required: string; available: string; baseUnit: string }[] | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [clientId, setClientId] = useState(() => crypto.randomUUID());

  const areas = catalog?.deliveryAreas ?? [];
  const isDeliveryLike = type === 'DELIVERY' || (type === 'MESSENGER' && !!delivery.areaId);
  const area = areas.find((a) => a.id === delivery.areaId);
  const deliveryFee = isDeliveryLike && area ? area.feeCentavos : 0;
  const totals = cartTotals(lines, discount ?? 0, deliveryFee);
  const itemCount = lines.reduce((s, l) => s + l.quantity, 0);
  const hasShift = !!shift && shift.userId === user?.id;

  const payments: PaymentDraft[] = useMemo(() => {
    const due = totals.totalCentavos;
    if (due <= 0 || payMode === 'LATER') return [];
    if (payMode === 'CASH') return [{ method: 'CASH', amountCentavos: due, tenderedCentavos: tendered ?? due }];
    if (payMode === 'GCASH') return [{ method: 'GCASH', amountCentavos: due, reference: gcashRef, verified: gcashChecked && online }];
    const g = Math.min(gcashAmount ?? 0, due);
    const cash = due - g;
    return [
      ...(g > 0 ? [{ method: 'GCASH' as const, amountCentavos: g, reference: gcashRef, verified: gcashChecked && online }] : []),
      ...(cash > 0 ? [{ method: 'CASH' as const, amountCentavos: cash, tenderedCentavos: tendered ?? cash }] : []),
    ];
  }, [payMode, totals.totalCentavos, tendered, gcashAmount, gcashRef, gcashChecked, online]);
  const payCheck = checkPayments(payments, totals.totalCentavos);
  /** Completed immediately only when the customer is here (not delivery) and has fully paid. */
  const quickSale = (walkInOnly || servedNow) && !isDeliveryLike && !payCheck.error && payCheck.paidCentavos >= totals.totalCentavos && totals.totalCentavos > 0;

  const visibleProducts = useMemo(() => {
    if (!catalog) return [];
    const q = search.trim().toLowerCase();
    return catalog.categories
      .filter((c) => category === 'ALL' || c.id === category)
      .flatMap((c) => c.products.map((p) => ({ ...p, categoryName: c.name })))
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.categoryName.toLowerCase().includes(q));
  }, [catalog, category, search]);

  function quickAdd(p: CatalogProduct) {
    const sellable = p.variants.filter((v) => v.isAvailable && p.isAvailable);
    if (sellable.length === 1 && p.modifiers.length === 0) {
      add(p, sellable[0], [], 1, '');
    } else {
      setPicking(p);
    }
  }

  function add(p: CatalogProduct, v: CatalogVariant, modifierIds: string[], quantity: number, lineNotes: string) {
    const mods = p.modifiers.filter((m) => modifierIds.includes(m.id)).map((m) => ({ modifierId: m.id, name: m.name, priceCentavos: m.priceCentavos }));
    setLines((ls) => addToCart(ls, { variantId: v.id, productName: p.name, variantName: v.name, unitPriceCentavos: v.priceCentavos, modifiers: mods, quantity, notes: lineNotes || undefined }));
  }

  function resetOrder() {
    setLines([]);
    setType('WALK_IN');
    setCustomerName('');
    setNotes('');
    setDelivery(emptyDelivery);
    setDiscount(null);
    setDiscountReason('');
    setPayMode('CASH');
    setTendered(null);
    setGcashAmount(null);
    setGcashRef('');
    setGcashChecked(false);
    setServedNow(settings?.autoCompleteWalkIn ?? true);
    setError('');
    setShortages(null);
    setClientId(crypto.randomUUID());
    setCartOpen(false);
  }

  /** After a price change, update cart lines to the server's latest catalog prices. */
  function repriceFrom(c: Catalog) {
    const variants = new Map(c.categories.flatMap((cat) => cat.products.flatMap((p) => p.variants.map((v) => [v.id, { v, p }] as const))));
    setLines((ls) =>
      ls.map((l) => {
        const hit = variants.get(l.variantId);
        if (!hit) return l;
        return {
          ...l,
          unitPriceCentavos: hit.v.priceCentavos,
          modifiers: l.modifiers.map((m) => ({ ...m, priceCentavos: hit.p.modifiers.find((x) => x.id === m.modifierId)?.priceCentavos ?? m.priceCentavos })),
        };
      }),
    );
  }

  function validate(): string | null {
    if (!lines.length) return 'Add at least one item.';
    if (walkInOnly && (payCheck.error || payCheck.paidCentavos < totals.totalCentavos)) return payCheck.error ?? 'Collect the full payment to complete the sale.';
    if (type === 'DELIVERY' && !delivery.areaId) return 'Choose the delivery area.';
    if (isDeliveryLike && (!delivery.customerName.trim() || !delivery.contactNumber.trim() || !delivery.address.trim())) {
      return 'Fill in the customer name, contact number and address for delivery.';
    }
    if ((discount ?? 0) > 0 && !discountReason.trim()) return 'Give a reason for the discount.';
    if (user?.role === 'CASHIER' && settings && totals.discountCentavos > percentOf(totals.subtotalCentavos, settings.maxCashierDiscountPercent)) {
      return `Cashiers can discount up to ${settings.maxCashierDiscountPercent}% only.`;
    }
    if (payCheck.error) return payCheck.error;
    return null;
  }

  function draft(): CheckoutDraft {
    return {
      clientId,
      type,
      customerName: customerName.trim() || undefined,
      notes: notes.trim() || undefined,
      lines,
      discountCentavos: discount ?? 0,
      discountReason: discountReason.trim() || undefined,
      deliveryFeeCentavos: deliveryFee,
      delivery: isDeliveryLike && area ? { ...delivery, areaName: area.name } : null,
      payments,
    };
  }

  async function saveLocally(d: CheckoutDraft) {
    const rec = await saveOffline(d, quickSale ? 'COMPLETED' : 'PENDING');
    setReceipt(offlineToReceipt(rec.payload, user?.name));
    toast('Saved offline — will sync automatically', 'warn');
    resetOrder();
  }

  async function checkout(allowNegativeStock = false) {
    const problem = validate();
    if (problem) return setError(problem);
    setError('');
    setShortages(null);
    setBusy(true);
    const d = draft();
    try {
      if (!online) {
        await saveLocally(d);
        return;
      }
      const res = await api.post<{ order: Order; duplicate: boolean }>('/orders', toOnlineRequest(d, { allowNegativeStock, completeNow: quickSale }));
      setReceipt(orderToReceipt(res.order));
      toast(`Order ${res.order.reference} placed`, 'ok');
      resetOrder();
      void refreshCatalog().catch(() => {});
    } catch (e) {
      if (e instanceof NetworkError) {
        // No answer from the server. Save locally with the SAME clientId: if the server did get it, sync returns the existing order.
        await saveLocally(d);
      } else if (e instanceof ApiError && e.code === 'PRICE_CHANGED') {
        const c = await refreshCatalog().catch(() => null);
        if (c) repriceFrom(c);
        setError('Prices changed on the menu. The cart now shows the new prices — please check the total and confirm again.');
      } else if (e instanceof ApiError && e.code === 'INSUFFICIENT_STOCK') {
        setShortages((e.details as { shortages: typeof shortages })?.shortages ?? []);
        setError('Not enough stock recorded for this order.');
      } else if (e instanceof ApiError && e.code === 'NO_OPEN_SHIFT') {
        setError('Open the cash drawer first (Cash Drawer page).');
      } else {
        setError(errorMessage(e));
      }
    } finally {
      setBusy(false);
    }
  }

  if (!catalog) {
    return (
      <div className="flex flex-col items-center gap-4 px-4 py-24 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-subtle text-muted">
          <Icon name="pos" className="h-6 w-6" />
        </span>
        <p className="font-heading text-lg font-semibold">{online ? 'Loading the menu…' : 'No menu saved on this device yet'}</p>
        {!online && <p className="max-w-sm text-muted">Connect to the internet once so the POS can download the menu. After that it works offline.</p>}
      </div>
    );
  }

  const cart = (
    <CartPanel
      {...{
        lines,
        setLines,
        totals,
        type,
        setType,
        customerName,
        setCustomerName,
        notes,
        setNotes,
        delivery,
        setDelivery,
        areas,
        discount,
        setDiscount,
        discountReason,
        setDiscountReason,
        payMode,
        setPayMode,
        tendered,
        setTendered,
        gcashAmount,
        setGcashAmount,
        gcashRef,
        setGcashRef,
        gcashChecked,
        setGcashChecked,
        servedNow,
        setServedNow,
        online,
        payCheck,
        busy,
        error,
        shortages,
        canOverride: user?.role === 'OWNER',
        onCheckout: checkout,
        onClear: resetOrder,
        isDeliveryLike,
        maxDiscountPercent: user?.role === 'CASHIER' ? settings?.maxCashierDiscountPercent : undefined,
        walkInOnly,
      }}
    />
  );

  return (
    <div className="flex min-h-[calc(100dvh-60px)]">
      {/* Menu */}
      <section className="min-w-0 flex-1 px-4 py-4 md:px-6">
        {!online && (
          <div className="mb-3 flex animate-pop flex-wrap items-center gap-2 rounded-2xl border border-warn/40 bg-warn/10 px-4 py-2.5 text-sm text-warn">
            <strong>Offline mode.</strong> Orders are saved on this device. Prices from {catalogSavedAt ? fmtDateTime(catalogSavedAt) : 'the last sync'}.
          </div>
        )}
        {!hasShift && (
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-bad/40 bg-bad/10 px-4 py-2.5 text-sm text-bad">
            <span>The cash drawer is closed. Open it so sales are counted in your drawer.</span>
            <Link href="/shift/" className="font-bold underline">
              Open drawer
            </Link>
          </div>
        )}

        <div className="sticky top-[60px] z-20 -mx-4 mb-4 space-y-3 bg-canvas/85 px-4 py-2 backdrop-blur md:-mx-6 md:px-6">
          <input
            className="field h-12 text-base"
            placeholder="Search products…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search products"
          />
          <div className="scrollbar-thin flex gap-2 overflow-x-auto pb-1">
            {[{ id: 'ALL', name: 'All' }, ...catalog.categories].map((c) => (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                className={cx(
                  'shrink-0 rounded-full border px-4 py-2 font-heading text-sm font-semibold transition',
                  category === c.id ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-muted hover:border-brand/50 hover:text-ink',
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        {visibleProducts.length === 0 ? (
          <div className="py-16 text-center text-muted">No products match “{search}”.</div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {visibleProducts.map((p, i) => (
              <ProductCard key={p.id} p={p} index={i} onClick={() => quickAdd(p)} />
            ))}
          </div>
        )}
      </section>

      {/* Cart (desktop) */}
      <aside className="no-print sticky top-[60px] hidden h-[calc(100dvh-60px)] w-[400px] shrink-0 border-l border-line bg-surface/60 lg:block">{cart}</aside>

      {/* Cart button + sheet (mobile/tablet) */}
      {lines.length > 0 && (
        <button
          onClick={() => setCartOpen(true)}
          className="fixed inset-x-4 bottom-28 z-30 flex animate-pop items-center justify-between rounded-2xl bg-brand px-5 py-4 font-semibold text-white shadow-lg lg:hidden"
        >
          <span>{itemCount} item{itemCount === 1 ? '' : 's'}</span>
          <span className="tabular">{peso(totals.totalCentavos)} →</span>
        </button>
      )}
      {cartOpen && (
        <div className="fixed inset-0 z-40 bg-canvas lg:hidden" role="dialog" aria-modal="true" aria-label="Cart">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-heading text-lg font-bold">Current order</p>
            <Button variant="ghost" size="sm" onClick={() => setCartOpen(false)}>
              ✕ Close
            </Button>
          </div>
          <div className="h-[calc(100dvh-57px)]">{cart}</div>
        </div>
      )}

      <AddItemModal product={picking} onClose={() => setPicking(null)} onAdd={(v, mods, q, n) => picking && add(picking, v, mods, q, n)} />
      <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} shopName={settings?.shopName} />
    </div>
  );
}

// ───────────────────────── Product card ─────────────────────────

function priceRange(p: CatalogProduct) {
  const prices = p.variants.map((v) => v.priceCentavos);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? peso(min) : `${peso(min)} – ${peso(max)}`;
}

function productStock(p: CatalogProduct): 'OK' | 'LOW' | 'OUT' {
  const levels = p.variants.map((v) => v.stock?.level ?? 'OK');
  if (levels.length && levels.every((l) => l === 'OUT')) return 'OUT';
  if (levels.some((l) => l === 'LOW' || l === 'OUT')) return 'LOW';
  return 'OK';
}

function ProductCard({ p, index, onClick }: { p: CatalogProduct & { categoryName: string }; index: number; onClick: () => void }) {
  const unavailable = !p.isAvailable || p.variants.every((v) => !v.isAvailable);
  const stock = productStock(p);
  return (
    <button
      onClick={onClick}
      disabled={unavailable}
      style={{ animationDelay: `${Math.min(index, 20) * 25}ms` }}
      className={cx(
        'card hover-lift relative flex animate-rise flex-col items-start overflow-hidden p-3.5 text-left disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      {p.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.imageUrl} alt="" className="mb-3 aspect-square w-full rounded-xl object-cover" />
      ) : (
        <ProductArt category={p.categoryName} product={p.name} className="mb-2 aspect-square w-full max-w-[120px] self-center" />
      )}
      <span className="font-heading leading-tight font-semibold">{p.name}</span>
      <span className="tabular mt-1 text-sm text-brand">{priceRange(p)}</span>
      <span className="mt-2 flex flex-wrap gap-1">
        {unavailable && <Badge tone="bad">Unavailable</Badge>}
        {!unavailable && stock === 'OUT' && <Badge tone="bad">Out of stock</Badge>}
        {!unavailable && stock === 'LOW' && <Badge tone="warn">Low stock</Badge>}
        {p.variants.length > 1 && <Badge>{p.variants.length} sizes</Badge>}
      </span>
    </button>
  );
}

// ───────────────────────── Add item modal ─────────────────────────

function AddItemModal({
  product,
  onClose,
  onAdd,
}: {
  product: CatalogProduct | null;
  onClose: () => void;
  onAdd: (v: CatalogVariant, modifierIds: string[], qty: number, notes: string) => void;
}) {
  const [variantId, setVariantId] = useState<string | null>(null);
  const [mods, setMods] = useState<string[]>([]);
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const [lastProduct, setLastProduct] = useState<string | null>(null);

  // Reset when a different product opens (render-time state sync, no effect needed).
  if (product && product.id !== lastProduct) {
    setLastProduct(product.id);
    setVariantId(product.variants.find((v) => v.isAvailable)?.id ?? null);
    setMods([]);
    setQty(1);
    setNotes('');
  }
  if (!product) return null;
  const variant = product.variants.find((v) => v.id === variantId) ?? null;
  const unit = (variant?.priceCentavos ?? 0) + product.modifiers.filter((m) => mods.includes(m.id)).reduce((s, m) => s + m.priceCentavos, 0);

  return (
    <Modal
      open={!!product}
      onClose={() => {
        setLastProduct(null);
        onClose();
      }}
      title={product.name}
      footer={
        <Button
          size="lg"
          className="w-full sm:w-auto"
          disabled={!variant}
          onClick={() => {
            if (!variant) return;
            onAdd(variant, mods, qty, notes);
            setLastProduct(null);
            onClose();
          }}
        >
          Add {qty} · <span className="tabular">{peso(unit * qty)}</span>
        </Button>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="label">Size</p>
          <div className="grid grid-cols-3 gap-2">
            {product.variants.map((v) => (
              <button
                key={v.id}
                disabled={!v.isAvailable}
                onClick={() => setVariantId(v.id)}
                className={cx(
                  'rounded-2xl border p-3 text-center transition disabled:opacity-40',
                  variantId === v.id ? 'border-brand bg-brand-soft' : 'border-line bg-canvas hover:border-brand/50',
                )}
              >
                <span className="block font-heading font-semibold">{v.name}</span>
                <span className="tabular block text-sm text-brand">{peso(v.priceCentavos)}</span>
                {v.stock?.level === 'OUT' && <span className="mt-1 block text-[11px] text-bad">Out: {v.stock.limitedBy}</span>}
                {v.stock?.level === 'LOW' && <span className="mt-1 block text-[11px] text-warn">Low: {v.stock.limitedBy}</span>}
              </button>
            ))}
          </div>
        </div>
        {product.modifiers.length > 0 && (
          <div>
            <p className="label">Add-ons</p>
            <div className="flex flex-wrap gap-2">
              {product.modifiers.map((m) => {
                const on = mods.includes(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => setMods((x) => (on ? x.filter((i) => i !== m.id) : [...x, m.id]))}
                    aria-pressed={on}
                    className={cx('rounded-full border px-3.5 py-2 text-sm font-semibold transition', on ? 'border-brand bg-brand text-white' : 'border-line bg-canvas text-muted hover:border-brand/50')}
                  >
                    {on ? '✓ ' : '+ '}
                    {m.name} <span className="tabular">{peso(m.priceCentavos)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <div className="flex items-end gap-4">
          <div>
            <p className="label">Quantity</p>
            <QtyStepper value={qty} onChange={setQty} />
          </div>
          <Field label="Notes (optional)" className="flex-1" placeholder="Less ice, 50% sugar…" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} />
        </div>
      </div>
    </Modal>
  );
}

function QtyStepper({ value, onChange, min = 1 }: { value: number; onChange: (n: number) => void; min?: number }) {
  return (
    <div className="flex items-center rounded-2xl border border-line bg-canvas">
      <button className="h-11 w-11 text-xl text-brand" onClick={() => onChange(Math.max(min, value - 1))} aria-label="Decrease">
        −
      </button>
      <span className="tabular w-10 text-center font-heading text-lg font-bold">{value}</span>
      <button className="h-11 w-11 text-xl text-brand" onClick={() => onChange(Math.min(999, value + 1))} aria-label="Increase">
        +
      </button>
    </div>
  );
}

// ───────────────────────── Cart panel ─────────────────────────

interface CartProps {
  lines: CartLine[];
  setLines: React.Dispatch<React.SetStateAction<CartLine[]>>;
  totals: ReturnType<typeof cartTotals>;
  type: OrderType;
  setType: (t: OrderType) => void;
  customerName: string;
  setCustomerName: (s: string) => void;
  notes: string;
  setNotes: (s: string) => void;
  delivery: typeof emptyDelivery;
  setDelivery: React.Dispatch<React.SetStateAction<typeof emptyDelivery>>;
  areas: { id: string; name: string; feeCentavos: number }[];
  discount: number | null;
  setDiscount: (n: number | null) => void;
  discountReason: string;
  setDiscountReason: (s: string) => void;
  payMode: PayMode;
  setPayMode: (m: PayMode) => void;
  tendered: number | null;
  setTendered: (n: number | null) => void;
  gcashAmount: number | null;
  setGcashAmount: (n: number | null) => void;
  gcashRef: string;
  setGcashRef: (s: string) => void;
  gcashChecked: boolean;
  setGcashChecked: (b: boolean) => void;
  servedNow: boolean;
  setServedNow: (b: boolean) => void;
  online: boolean;
  payCheck: ReturnType<typeof checkPayments>;
  busy: boolean;
  error: string;
  shortages: { name: string; required: string; available: string; baseUnit: string }[] | null;
  canOverride: boolean;
  onCheckout: (override?: boolean) => void;
  onClear: () => void;
  isDeliveryLike: boolean;
  maxDiscountPercent?: number;
  walkInOnly: boolean;
}

function CartPanel(p: CartProps) {
  const [showExtras, setShowExtras] = useState(false);
  const due = p.totals.totalCentavos;
  const quick = [due, ...[10000, 20000, 50000, 100000].filter((v) => v > due)].slice(0, 4);

  if (!p.lines.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-subtle text-faint">
          <Icon name="pos" className="h-6 w-6" />
        </span>
        <p className="font-heading font-semibold">No items yet</p>
        <p className="text-sm text-muted">Tap a drink or takoyaki to start an order.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pt-4">
        <p className="font-heading text-lg font-bold">Current order</p>
        <button className="text-sm text-muted hover:text-bad" onClick={p.onClear}>
          Clear
        </button>
      </div>

      <div className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {/* Lines */}
        <ul className="space-y-2">
          {p.lines.map((l) => (
            <li key={l.key} className="animate-pop rounded-2xl border border-line bg-canvas/60 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{l.productName}</p>
                  <p className="text-xs text-muted">
                    {l.variantName}
                    {l.modifiers.length > 0 && ` · ${l.modifiers.map((m) => m.name).join(', ')}`}
                  </p>
                  {l.notes && <p className="text-xs text-info italic">“{l.notes}”</p>}
                </div>
                <p className="tabular font-heading font-semibold">{peso((l.unitPriceCentavos + modifiersTotal(l)) * l.quantity)}</p>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <QtyStepper value={l.quantity} min={0} onChange={(n) => p.setLines((ls) => setQuantity(ls, l.key, n))} />
                <button className="text-xs text-faint hover:text-bad" onClick={() => p.setLines((ls) => setQuantity(ls, l.key, 0))}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>

        {/* Order type (hidden in walk-in-only shops) */}
        {!p.walkInOnly && (
        <div>
          <p className="label">Order type</p>
          <div className="grid grid-cols-3 gap-2">
            {(['WALK_IN', 'DELIVERY', 'MESSENGER'] as OrderType[]).map((t) => (
              <button
                key={t}
                onClick={() => p.setType(t)}
                className={cx('rounded-2xl border px-2 py-2.5 text-sm font-semibold transition', p.type === t ? 'border-brand bg-brand/15 text-brand' : 'border-line text-muted hover:border-brand/40')}
              >
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
        )}

        {p.type === 'WALK_IN' && !p.walkInOnly && <Field label="Customer name (optional)" value={p.customerName} onChange={(e) => p.setCustomerName(e.target.value)} placeholder="For calling out the order" />}

        {(p.type === 'DELIVERY' || p.type === 'MESSENGER') && (
          <div className="animate-rise space-y-3 rounded-2xl border border-line bg-canvas/40 p-3">
            {p.type === 'MESSENGER' && <p className="text-xs text-muted">Messenger order typed in by staff. Choose an area to deliver it, or leave it empty for pick-up.</p>}
            <SelectField label={p.type === 'MESSENGER' ? 'Delivery area (optional)' : 'Delivery area'} value={p.delivery.areaId} onChange={(e) => p.setDelivery((d) => ({ ...d, areaId: e.target.value }))}>
              <option value="">{p.type === 'MESSENGER' ? 'Pick-up' : 'Choose…'}</option>
              {p.areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {peso(a.feeCentavos)}
                </option>
              ))}
            </SelectField>
            {(p.isDeliveryLike || p.type === 'MESSENGER') && (
              <Field
                label="Customer name"
                value={p.isDeliveryLike ? p.delivery.customerName : p.customerName}
                onChange={(e) => (p.isDeliveryLike ? p.setDelivery((d) => ({ ...d, customerName: e.target.value })) : p.setCustomerName(e.target.value))}
              />
            )}
            {p.isDeliveryLike && (
              <>
                <Field label="Contact number" inputMode="tel" value={p.delivery.contactNumber} onChange={(e) => p.setDelivery((d) => ({ ...d, contactNumber: e.target.value }))} placeholder="09XX XXX XXXX" />
                <TextArea label="Address" value={p.delivery.address} onChange={(e) => p.setDelivery((d) => ({ ...d, address: e.target.value }))} />
                <Field label="Delivery instructions" value={p.delivery.instructions} onChange={(e) => p.setDelivery((d) => ({ ...d, instructions: e.target.value }))} placeholder="Landmark, gate color…" />
              </>
            )}
          </div>
        )}

        <button className="text-sm font-semibold text-brand" onClick={() => setShowExtras((s) => !s)}>
          {showExtras ? '− Hide' : '+ Add'} discount / order note
        </button>
        {showExtras && (
          <div className="animate-rise space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <MoneyField label="Discount" value={p.discount} onChange={p.setDiscount} hint={p.maxDiscountPercent != null ? `Max ${p.maxDiscountPercent}%` : undefined} />
              <Field label="Reason" value={p.discountReason} onChange={(e) => p.setDiscountReason(e.target.value)} placeholder="Senior / PWD / promo" />
            </div>
            <Field label="Order note" value={p.notes} onChange={(e) => p.setNotes(e.target.value)} />
          </div>
        )}

        {/* Payment */}
        <div>
          <p className="label">Payment</p>
          <div className={cx('grid gap-1.5', p.walkInOnly ? 'grid-cols-3' : 'grid-cols-4')}>
            {(
              [
                ['CASH', 'Cash', 'cash'],
                ['GCASH', 'GCash', 'phone'],
                ['SPLIT', 'Split', 'split'],
                ['LATER', 'Pay later', 'clock'],
              ] as [PayMode, string, IconName][]
            )
              .filter(([m]) => !(p.walkInOnly && m === 'LATER'))
              .map(([m, label, icon]) => (
              <button
                key={m}
                onClick={() => p.setPayMode(m)}
                className={cx('flex flex-col items-center gap-1 rounded-lg border px-1 py-2 text-xs font-semibold transition', p.payMode === m ? 'border-brand bg-brand-soft text-brand' : 'border-line text-muted hover:border-brand/40')}
              >
                <Icon name={icon} className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {(p.payMode === 'GCASH' || p.payMode === 'SPLIT') && (
          <div className="animate-rise space-y-2">
            {p.payMode === 'SPLIT' && <MoneyField label="GCash amount" value={p.gcashAmount} onChange={p.setGcashAmount} />}
            <Field label="GCash reference no." value={p.gcashRef} onChange={(e) => p.setGcashRef(e.target.value)} inputMode="numeric" />
            <label className={cx('flex items-center gap-2 text-sm', !p.online && 'opacity-50')}>
              <input type="checkbox" className="h-4 w-4 accent-pink-500" disabled={!p.online} checked={p.gcashChecked && p.online} onChange={(e) => p.setGcashChecked(e.target.checked)} />
              I saw this payment in the GCash app
            </label>
            {!p.online && <p className="text-xs text-warn">Offline: GCash will be saved as unverified until someone checks it.</p>}
          </div>
        )}

        {(p.payMode === 'CASH' || p.payMode === 'SPLIT') && due > 0 && (
          <div className="animate-rise space-y-2">
            <MoneyField label="Cash received" value={p.tendered} onChange={p.setTendered} placeholder={(due / 100).toFixed(2)} />
            {p.payMode === 'CASH' && (
              <div className="flex flex-wrap gap-1.5">
                {quick.map((v, i) => (
                  <button key={v} onClick={() => p.setTendered(v)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:border-brand hover:text-brand">
                    {i === 0 ? 'Exact' : peso(v)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {p.payMode === 'LATER' && <p className="text-sm text-muted">The order is saved as unpaid. Record the payment later from the Orders page (e.g. cash on delivery).</p>}

        {!p.isDeliveryLike && !p.walkInOnly && (
          <div className="rounded-xl border border-line bg-subtle/60 p-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-pink-500" checked={p.servedNow} onChange={(e) => p.setServedNow(e.target.checked)} />
              <span>
                <span className="font-semibold">Complete sale now</span>
                <span className="block text-xs text-muted">Customer is at the counter. The sale is recorded right away without the order queue.</span>
              </span>
            </label>
            {p.servedNow && p.payCheck.paidCentavos < due && <p className="mt-1.5 text-xs text-warn">Not fully paid yet, so this order will go to the order queue.</p>}
          </div>
        )}
      </div>

      {/* Totals + checkout */}
      <div className="space-y-2 border-t border-line bg-surface/90 px-4 py-3">
        <TotalRow label="Subtotal" value={p.totals.subtotalCentavos} />
        {p.totals.discountCentavos > 0 && <TotalRow label="Discount" value={-p.totals.discountCentavos} />}
        {p.totals.deliveryFeeCentavos > 0 && <TotalRow label="Delivery fee" value={p.totals.deliveryFeeCentavos} />}
        <div className="flex items-baseline justify-between">
          <span className="font-heading text-lg font-bold">Total</span>
          <span className="tabular font-heading text-3xl font-bold text-brand">{peso(due)}</span>
        </div>
        {p.payCheck.changeCentavos > 0 && (
          <div className="flex animate-pop items-baseline justify-between rounded-xl bg-ok/10 px-3 py-1.5 text-ok">
            <span className="font-bold">Change</span>
            <span className="tabular font-heading text-2xl font-bold">{peso(p.payCheck.changeCentavos)}</span>
          </div>
        )}
        <ErrorNote>{p.error}</ErrorNote>
        {p.shortages && p.shortages.length > 0 && (
          <div className="rounded-xl border border-warn/40 bg-warn/10 p-2 text-xs text-warn">
            {p.shortages.map((s) => (
              <p key={s.name}>
                {s.name}: needs {Number(s.required)} {s.baseUnit.toLowerCase()}, recorded {Number(s.available)}
              </p>
            ))}
            {p.canOverride ? (
              <Button variant="danger" size="sm" className="mt-2 w-full" onClick={() => p.onCheckout(true)}>
                Sell anyway (owner override, logged)
              </Button>
            ) : (
              <p className="mt-1">Ask the owner to restock or override.</p>
            )}
          </div>
        )}
        <Button size="lg" className="w-full" loading={p.busy} onClick={() => p.onCheckout(false)}>
          {p.walkInOnly ? (p.online ? 'Complete sale' : 'Complete sale (offline)') : p.online ? 'Place order' : 'Save order offline'} · <span className="tabular">{peso(due)}</span>
        </Button>
      </div>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-sm text-muted">
      <span>{label}</span>
      <span className="tabular">{peso(value)}</span>
    </div>
  );
}
