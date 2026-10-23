'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { usePos } from '@/lib/offline/pos-context';
import { peso } from '@/lib/money';
import { qty } from '@/lib/format';
import type { BaseUnit, Ingredient } from '@/lib/types';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Modal, MoneyField, PageHeader, SelectField, Skeleton, Tabs, TextArea, cx } from '@/components/ui';
import { NeedsOnline, OwnerOnly } from '@/components/app-shell';
import { useToast } from '@/components/toast';
import { ProductArt } from '@/components/product-art';

interface RecipeItem {
  ingredientId: string;
  quantity: string;
  ingredient: { id: string; name: string; baseUnit: BaseUnit; avgUnitCost: string };
}
interface AdminVariant {
  id: string;
  name: string;
  priceCentavos: number;
  isAvailable: boolean;
  isActive: boolean;
  recipeItems: RecipeItem[];
}
interface AdminProduct {
  id: string;
  categoryId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  isAvailable: boolean;
  isActive: boolean;
  variants: AdminVariant[];
  modifiers: { modifierId: string }[];
}
interface AdminCategory {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  products: AdminProduct[];
}
interface AdminModifier {
  id: string;
  name: string;
  priceCentavos: number;
  isActive: boolean;
  recipeItems: RecipeItem[];
}
interface AdminCatalog {
  version: number;
  categories: AdminCategory[];
  modifiers: AdminModifier[];
}

/** Recipe cost per unit sold (centavos), from weighted-average ingredient costs. */
function recipeCost(items: RecipeItem[]) {
  return Math.round(items.reduce((s, r) => s + Number(r.quantity) * Number(r.ingredient.avgUnitCost), 0));
}

export default function MenuPage() {
  return (
    <OwnerOnly>
      <NeedsOnline>
        <MenuManager />
      </NeedsOnline>
    </OwnerOnly>
  );
}

function MenuManager() {
  const toast = useToast();
  const { refreshCatalog } = usePos();
  const [data, setData] = useState<AdminCatalog | null>(null);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [tab, setTab] = useState<'products' | 'addons'>('products');
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<AdminProduct | 'new' | null>(null);
  const [recipeFor, setRecipeFor] = useState<{ kind: 'variant' | 'modifier'; id: string; title: string; items: RecipeItem[] } | null>(null);
  const [catModal, setCatModal] = useState<AdminCategory | 'new' | null>(null);
  const [modModal, setModModal] = useState<AdminModifier | 'new' | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, ings] = await Promise.all([api.get<AdminCatalog>(`/catalog/admin?includeArchived=${archived}`), api.get<Ingredient[]>('/ingredients')]);
      setData(c);
      setIngredients(ings);
    } catch (e) {
      toast(errorMessage(e), 'bad');
    }
  }, [archived, toast]);
  useEffect(() => void load(), [load]);

  const changed = async () => {
    await load();
    void refreshCatalog().catch(() => {});
  };

  async function toggle(path: string, body: Record<string, unknown>, msg: string) {
    try {
      await api.patch(path, body);
      toast(msg, 'ok');
      await changed();
    } catch (e) {
      toast(errorMessage(e), 'bad');
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Business"
        title="Menu & Recipes"
        subtitle="Prices and recipes here drive the POS, stock deduction and profit reports. Every price change is logged."
        actions={
          <>
            <Tabs value={tab} onChange={setTab} options={[{ value: 'products', label: 'Products' }, { value: 'addons', label: 'Add-ons' }]} />
          </>
        }
      />
      {!data ? (
        <Skeleton className="h-96" />
      ) : tab === 'products' ? (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setEditing('new')} disabled={!data.categories.length}>
              + New product
            </Button>
            <Button variant="secondary" onClick={() => setCatModal('new')}>
              + Category
            </Button>
            <label className="ml-auto flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" className="h-4 w-4 accent-pink-500" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
              Show archived
            </label>
          </div>
          {data.categories.length === 0 && <EmptyState title="Start with a category">e.g. Milk Tea, Iced Coffee, Takoyaki.</EmptyState>}
          {data.categories.map((cat, ci) => (
            <Card key={cat.id} className={cx('animate-rise p-4', !cat.isActive && 'opacity-60')} style={{ animationDelay: `${ci * 40}ms` }}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-xl font-bold">
                  {cat.name} {!cat.isActive && <Badge>Hidden</Badge>}
                </h2>
                <Button size="sm" variant="ghost" onClick={() => setCatModal(cat)}>
                  Category
                </Button>
              </div>
              {cat.products.length === 0 ? (
                <p className="text-sm text-muted">No products in this category.</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                  {cat.products.map((p) => (
                    <div key={p.id} className={cx('rounded-2xl border border-line bg-canvas/50 p-3', !p.isActive && 'opacity-50')}>
                      <div className="flex items-start justify-between gap-2">
                        {p.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.imageUrl} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                        ) : (
                          <ProductArt category={cat.name} product={p.name} className="h-12 w-12 shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="font-heading font-semibold">{p.name}</p>
                          {p.description && <p className="text-xs text-faint">{p.description}</p>}
                        </div>
                        <div className="flex shrink-0 gap-1">
                          {!p.isActive ? <Badge>Archived</Badge> : p.isAvailable ? <Badge tone="ok">On menu</Badge> : <Badge tone="bad">Sold out</Badge>}
                        </div>
                      </div>
                      <ul className="mt-2 space-y-1.5">
                        {p.variants.map((v) => {
                          const cost = recipeCost(v.recipeItems);
                          const margin = v.priceCentavos ? Math.round(((v.priceCentavos - cost) / v.priceCentavos) * 100) : 0;
                          return (
                            <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-subtle/50 px-2.5 py-1.5 text-sm">
                              <span>
                                {v.name} <span className="tabular text-brand">{peso(v.priceCentavos)}</span>
                                {!v.isAvailable && <span className="ml-1 text-xs text-bad">off</span>}
                              </span>
                              <span className="flex items-center gap-2">
                                {v.recipeItems.length ? (
                                  <span className="text-xs text-muted" title="Ingredient cost from recipe">
                                    cost {peso(cost)} · {margin}%
                                  </span>
                                ) : (
                                  <Badge tone="warn">No recipe</Badge>
                                )}
                                <Button size="sm" variant="ghost" onClick={() => setRecipeFor({ kind: 'variant', id: v.id, title: `${p.name} — ${v.name}`, items: v.recipeItems })}>
                                  Recipe
                                </Button>
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
                          Edit
                        </Button>
                        {p.isActive && (
                          <Button size="sm" variant="ghost" onClick={() => toggle(`/products/${p.id}`, { isAvailable: !p.isAvailable }, p.isAvailable ? 'Marked sold out' : 'Back on the menu')}>
                            {p.isAvailable ? 'Mark sold out' : 'Make available'}
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => toggle(`/products/${p.id}`, { isActive: !p.isActive }, p.isActive ? 'Archived' : 'Restored')}>
                          {p.isActive ? 'Archive' : 'Restore'}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <Button onClick={() => setModModal('new')}>+ New add-on</Button>
          {data.modifiers.length === 0 ? (
            <EmptyState title="No add-ons yet">e.g. Extra pearls, Cream cheese foam, Extra cheese.</EmptyState>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.modifiers.map((m) => (
                <Card key={m.id} className={cx('hover-lift p-4', !m.isActive && 'opacity-50')}>
                  <div className="flex items-center justify-between">
                    <p className="font-heading font-semibold">{m.name}</p>
                    <span className="tabular text-brand">{peso(m.priceCentavos)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{m.recipeItems.length ? `Uses ${m.recipeItems.map((r) => `${qty(r.quantity, r.ingredient.baseUnit)} ${r.ingredient.name}`).join(', ')}` : 'No ingredients linked'}</p>
                  <div className="mt-3 flex gap-1.5">
                    <Button size="sm" variant="secondary" onClick={() => setModModal(m)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRecipeFor({ kind: 'modifier', id: m.id, title: m.name, items: m.recipeItems })}>
                      Ingredients
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {data && (
        <>
          <ProductModal product={editing} categories={data.categories} modifiers={data.modifiers} onClose={() => setEditing(null)} onSaved={changed} />
          <RecipeModal target={recipeFor} ingredients={ingredients} onClose={() => setRecipeFor(null)} onSaved={changed} />
          <CategoryModal category={catModal} onClose={() => setCatModal(null)} onSaved={changed} />
          <ModifierModal modifier={modModal} onClose={() => setModModal(null)} onSaved={changed} />
        </>
      )}
    </>
  );
}

function ProductModal({
  product,
  categories,
  modifiers,
  onClose,
  onSaved,
}: {
  product: AdminProduct | 'new' | null;
  categories: AdminCategory[];
  modifiers: AdminModifier[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const isNew = product === 'new';
  const p = product && product !== 'new' ? product : null;
  const [form, setForm] = useState({ name: '', categoryId: '', description: '', imageUrl: '' });
  const [variants, setVariants] = useState<{ id?: string; name: string; priceCentavos: number | null; isAvailable: boolean; isActive: boolean }[]>([]);
  const [mods, setMods] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!product) return;
    setError('');
    setForm({ name: p?.name ?? '', categoryId: p?.categoryId ?? categories[0]?.id ?? '', description: p?.description ?? '', imageUrl: p?.imageUrl ?? '' });
    setVariants(
      p
        ? p.variants.map((v) => ({ id: v.id, name: v.name, priceCentavos: v.priceCentavos, isAvailable: v.isAvailable, isActive: v.isActive }))
        : [
            { name: 'Small', priceCentavos: null, isAvailable: true, isActive: true },
            { name: 'Medium', priceCentavos: null, isAvailable: true, isActive: true },
            { name: 'Large', priceCentavos: null, isAvailable: true, isActive: true },
          ],
    );
    setMods(p?.modifiers.map((m) => m.modifierId) ?? []);
  }, [product, p, categories]);

  async function save() {
    const active = variants.filter((v) => v.isActive);
    if (!form.name.trim()) return setError('Name is required');
    if (!active.length || active.some((v) => !v.name.trim() || v.priceCentavos == null)) return setError('Every size needs a name and a price');
    setBusy(true);
    setError('');
    try {
      const base = { name: form.name.trim(), categoryId: form.categoryId, description: form.description || null, imageUrl: form.imageUrl || null, modifierIds: mods };
      if (isNew) {
        await api.post('/products', { ...base, variants: active.map((v, i) => ({ name: v.name.trim(), priceCentavos: v.priceCentavos, sortOrder: i, isAvailable: v.isAvailable })) });
      } else if (p) {
        await api.patch(`/products/${p.id}`, base);
        for (const [i, v] of variants.entries()) {
          if (v.id) {
            const orig = p.variants.find((x) => x.id === v.id)!;
            if (orig.name !== v.name || orig.priceCentavos !== v.priceCentavos || orig.isAvailable !== v.isAvailable || orig.isActive !== v.isActive) {
              await api.patch(`/variants/${v.id}`, { name: v.name.trim(), priceCentavos: v.priceCentavos, isAvailable: v.isAvailable, isActive: v.isActive, sortOrder: i });
            }
          } else if (v.isActive) {
            await api.post(`/products/${p.id}/variants`, { name: v.name.trim(), priceCentavos: v.priceCentavos, sortOrder: i });
          }
        }
      }
      toast(isNew ? 'Product created' : 'Product saved', 'ok');
      await onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={!!product} onClose={onClose} wide title={isNew ? 'New product' : `Edit ${p?.name}`} footer={<Button loading={busy} onClick={save}>Save</Button>}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
          <SelectField label="Category" value={form.categoryId} onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </SelectField>
        </div>
        <TextArea label="Description (optional)" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        <Field label="Image URL (optional)" value={form.imageUrl} onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))} placeholder="https://…" />
        <div>
          <p className="label">Sizes & prices</p>
          <div className="space-y-2">
            {variants.map((v, i) => (
              <div key={v.id ?? `new-${i}`} className={cx('grid grid-cols-[1fr_140px_auto] items-end gap-2', !v.isActive && 'opacity-50')}>
                <Field label="Size" value={v.name} onChange={(e) => setVariants((vs) => vs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
                <MoneyField label="Price" value={v.priceCentavos} onChange={(c) => setVariants((vs) => vs.map((x, j) => (j === i ? { ...x, priceCentavos: c } : x)))} />
                <Button
                  variant="ghost"
                  size="sm"
                  className="mb-1"
                  onClick={() => setVariants((vs) => (v.id ? vs.map((x, j) => (j === i ? { ...x, isActive: !x.isActive } : x)) : vs.filter((_, j) => j !== i)))}
                >
                  {v.id ? (v.isActive ? 'Archive' : 'Restore') : 'Remove'}
                </Button>
              </div>
            ))}
          </div>
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => setVariants((vs) => [...vs, { name: '', priceCentavos: null, isAvailable: true, isActive: true }])}>
            + Size
          </Button>
          <p className="mt-1 text-xs text-faint">Sizes are archived instead of deleted so old receipts and reports stay correct.</p>
        </div>
        {modifiers.length > 0 && (
          <div>
            <p className="label">Allowed add-ons</p>
            <div className="flex flex-wrap gap-2">
              {modifiers.map((m) => {
                const on = mods.includes(m.id);
                return (
                  <button
                    key={m.id}
                    onClick={() => setMods((x) => (on ? x.filter((y) => y !== m.id) : [...x, m.id]))}
                    className={cx('rounded-full border px-3 py-1.5 text-sm font-semibold', on ? 'border-brand bg-brand text-white' : 'border-line text-muted')}
                  >
                    {on ? '✓ ' : '+ '}
                    {m.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}

function RecipeModal({
  target,
  ingredients,
  onClose,
  onSaved,
}: {
  target: { kind: 'variant' | 'modifier'; id: string; title: string; items: RecipeItem[] } | null;
  ingredients: Ingredient[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const toast = useToast();
  const [rows, setRows] = useState<{ ingredientId: string; quantity: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (target) {
      setRows(target.items.map((r) => ({ ingredientId: r.ingredientId, quantity: String(Number(r.quantity)) })));
      setError('');
    }
  }, [target]);

  async function save() {
    if (!target) return;
    if (rows.some((r) => !r.ingredientId || !(Number(r.quantity) > 0))) return setError('Each line needs an ingredient and a quantity above zero');
    setBusy(true);
    try {
      await api.put(`/${target.kind === 'variant' ? 'variants' : 'modifiers'}/${target.id}/recipe`, { items: rows });
      toast('Recipe saved', 'ok');
      await onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const byId = new Map(ingredients.map((i) => [i.id, i]));
  const cost = Math.round(rows.reduce((s, r) => s + Number(r.quantity || 0) * Number(byId.get(r.ingredientId)?.avgUnitCost ?? 0), 0));
  return (
    <Modal open={!!target} onClose={onClose} title={`Recipe · ${target?.title}`} footer={<Button loading={busy} onClick={save}>Save recipe</Button>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">What 1 unit sold uses. Quantities are in each ingredient&apos;s stock unit. These are deducted from stock on every sale.</p>
        {ingredients.length === 0 && <p className="text-sm text-warn">Add ingredients on the Inventory page first.</p>}
        {rows.map((r, i) => {
          const ing = byId.get(r.ingredientId);
          return (
            <div key={i} className="grid grid-cols-[1fr_120px_auto] items-end gap-2">
              <SelectField label="Ingredient" value={r.ingredientId} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, ingredientId: e.target.value } : x)))}>
                <option value="">Choose…</option>
                {ingredients.map((g) => (
                  <option key={g.id} value={g.id} disabled={rows.some((x, j) => j !== i && x.ingredientId === g.id)}>
                    {g.name}
                  </option>
                ))}
              </SelectField>
              <Field label={`Qty${ing ? ` (${ing.baseUnit.toLowerCase()})` : ''}`} inputMode="decimal" value={r.quantity} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, quantity: e.target.value } : x)))} />
              <Button variant="ghost" size="sm" className="mb-1" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                ✕
              </Button>
            </div>
          );
        })}
        <Button variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, { ingredientId: '', quantity: '' }])}>
          + Ingredient
        </Button>
        <p className="text-sm">
          Estimated ingredient cost: <strong className="tabular text-brand">{peso(cost)}</strong>
        </p>
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}

function CategoryModal({ category, onClose, onSaved }: { category: AdminCategory | 'new' | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const c = category && category !== 'new' ? category : null;
  const [name, setName] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [active, setActive] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    setName(c?.name ?? '');
    setSortOrder(String(c?.sortOrder ?? 0));
    setActive(c?.isActive ?? true);
    setError('');
  }, [category, c]);
  async function save() {
    try {
      const body = { name, sortOrder: Number(sortOrder) || 0, isActive: active };
      if (c) await api.patch(`/categories/${c.id}`, body);
      else await api.post('/categories', body);
      toast('Category saved', 'ok');
      await onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <Modal open={!!category} onClose={onClose} title={c ? 'Edit category' : 'New category'} footer={<Button onClick={save}>Save</Button>}>
      <div className="space-y-3">
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <Field label="Order (lower shows first)" inputMode="numeric" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        {c && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-pink-500" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Show on POS
          </label>
        )}
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}

function ModifierModal({ modifier, onClose, onSaved }: { modifier: AdminModifier | 'new' | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const toast = useToast();
  const m = modifier && modifier !== 'new' ? modifier : null;
  const [name, setName] = useState('');
  const [price, setPrice] = useState<number | null>(null);
  const [active, setActive] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    setName(m?.name ?? '');
    setPrice(m?.priceCentavos ?? null);
    setActive(m?.isActive ?? true);
    setError('');
  }, [modifier, m]);
  async function save() {
    if (price == null) return setError('Enter a price (0 is allowed)');
    try {
      const body = { name, priceCentavos: price, isActive: active };
      if (m) await api.patch(`/modifiers/${m.id}`, body);
      else await api.post('/modifiers', body);
      toast('Add-on saved', 'ok');
      await onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <Modal open={!!modifier} onClose={onClose} title={m ? 'Edit add-on' : 'New add-on'} footer={<Button onClick={save}>Save</Button>}>
      <div className="space-y-3">
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        <MoneyField label="Price" value={price} onChange={setPrice} />
        {m && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-pink-500" checked={active} onChange={(e) => setActive(e.target.checked)} />
            Active
          </label>
        )}
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}
