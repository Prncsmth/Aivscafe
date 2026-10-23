'use client';

import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Icon } from './icons';
import { parsePeso, toPesoInput } from '@/lib/money';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

// ───────────────────────── Button ─────────────────────────

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
const variants: Record<Variant, string> = {
  primary:
    'bg-brand text-white shadow-sm hover:bg-brand-strong',
  secondary: 'border border-line bg-surface text-ink hover:border-brand/50 hover:bg-subtle',
  ghost: 'text-muted hover:bg-subtle hover:text-ink',
  danger: 'border border-bad/40 bg-bad/10 text-bad hover:bg-bad/20',
  success: 'border border-ok/40 bg-ok/10 text-ok hover:bg-ok/20',
};
const sizes = { sm: 'h-9 px-3 text-sm rounded-lg', md: 'h-11 px-4 rounded-xl', lg: 'h-13 px-6 text-base rounded-xl' };

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: keyof typeof sizes; loading?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex select-none items-center justify-center gap-2 font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {loading && <Spinner className="h-4 w-4" />}
      {children}
    </button>
  );
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

// ───────────────────────── Layout bits ─────────────────────────

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx('card', className)}>
      {children}
    </div>
  );
}

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex animate-rise flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <p className="eyebrow mb-1">{eyebrow}</p>
        )}
        <h1 className="text-2xl font-bold md:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

type Tone = 'pink' | 'ok' | 'warn' | 'bad' | 'muted' | 'lilac';
const tones: Record<Tone, string> = {
  pink: 'bg-brand-soft text-brand border-brand/25',
  ok: 'bg-ok/10 text-ok border-ok/25',
  warn: 'bg-warn/10 text-warn border-warn/25',
  bad: 'bg-bad/10 text-bad border-bad/25',
  muted: 'bg-subtle text-muted border-line',
  lilac: 'bg-info/10 text-info border-info/25',
};
export function Badge({ tone = 'muted', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap', tones[tone], className)}>
      {children}
    </span>
  );
}

export function Stat({ label, value, hint, tone, delay = 0 }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; delay?: number }) {
  return (
    <Card className="animate-rise p-4" style={{ animationDelay: `${delay}ms` }}>
      <p className="label">{label}</p>
      <p className={cx('tabular font-heading text-2xl font-bold', tone === 'bad' && 'text-bad', tone === 'ok' && 'text-ok', tone === 'warn' && 'text-warn')}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex animate-rise flex-col items-center justify-center gap-3 py-12 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-subtle text-faint">
        <Icon name="inbox" className="h-6 w-6" />
      </span>
      <p className="font-heading font-semibold">{title}</p>
      {children && <div className="max-w-sm text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} />;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div role="alert" className="animate-pop rounded-xl border border-bad/30 bg-bad/5 px-4 py-3 text-sm text-bad">
      {children}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[]; className?: string }) {
  return (
    <div role="tablist" className={cx('scrollbar-thin flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'shrink-0 rounded-lg px-3.5 py-2 text-sm font-semibold transition',
            value === o.value ? 'bg-brand text-white shadow-sm' : 'text-muted hover:bg-subtle hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ───────────────────────── Form fields ─────────────────────────

export function Field({ label, hint, error, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <input id={id} {...rest} className="field" aria-invalid={!!error} />
      {hint && !error && <p className="mt-1 text-xs text-faint">{hint}</p>}
      {error && <p className="mt-1 text-xs text-bad">{error}</p>}
    </div>
  );
}

/** Password input with a show/hide (eye) toggle. */
export function PasswordField({ label, hint, className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string; hint?: string }) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="relative">
        <input id={id} {...rest} type={visible ? 'text' : 'password'} className="field pr-11" />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-lg p-2 text-muted hover:bg-subtle hover:text-ink"
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          title={visible ? 'Hide password' : 'Show password'}
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} className="h-[18px] w-[18px]" />
        </button>
      </div>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}

export function SelectField({ label, children, className, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <select id={id} {...rest} className="field">
        {children}
      </select>
    </div>
  );
}

export function TextArea({ label, className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <textarea id={id} rows={2} {...rest} className="field resize-y" />
    </div>
  );
}

/** Peso input that reports integer centavos (or null while invalid/empty). */
export function MoneyField({
  label,
  value,
  onChange,
  className,
  hint,
  autoFocus,
  placeholder = '0.00',
}: {
  label: string;
  value: number | null;
  onChange: (centavos: number | null) => void;
  className?: string;
  hint?: string;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const id = useId();
  const [text, setText] = useState(value != null ? toPesoInput(value) : '');
  const lastEmitted = useRef<number | null>(value);
  useEffect(() => {
    if (value !== lastEmitted.current) {
      setText(value != null ? toPesoInput(value) : '');
      lastEmitted.current = value;
    }
  }, [value]);
  const invalid = text !== '' && parsePeso(text) == null;
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted">₱</span>
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            const c = parsePeso(e.target.value);
            lastEmitted.current = c;
            onChange(c);
          }}
          className="field tabular pl-7"
          aria-invalid={invalid}
        />
      </div>
      {invalid ? <p className="mt-1 text-xs text-bad">Enter an amount like 49 or 49.50</p> : hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}

// ───────────────────────── Modal ─────────────────────────

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without re-running the effect: callers pass a new function on every
  // render, and re-running would move focus back to the first field after each keystroke.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not([data-close])');
    first?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4" role="dialog" aria-modal="true">
      <button data-close aria-label="Close" className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div
        ref={ref}
        className={cx(
          'card relative flex max-h-[92dvh] w-full animate-pop flex-col rounded-b-none sm:rounded-b-[1.25rem]',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="text-xl font-bold">{title}</h2>
          <button data-close onClick={onClose} className="rounded-xl p-2 text-muted hover:bg-subtle hover:text-ink" aria-label="Close dialog">
            <Icon name="close" />
          </button>
        </div>
        <div className="scrollbar-thin overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger,
  loading,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Back
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-muted">
        <div>{message}</div>
        {children}
      </div>
    </Modal>
  );
}

// ───────────────────────── Table ─────────────────────────

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cx('scrollbar-thin overflow-x-auto', className)}>
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs tracking-wider text-muted uppercase">
            {head.map((h, i) => (
              <th key={i} className="px-3 py-2.5 font-bold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/60">{children}</tbody>
      </table>
    </div>
  );
}
