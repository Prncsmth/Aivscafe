'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/format';
import type { Role } from '@/lib/types';
import { Badge, Button, Card, ErrorNote, Field, Modal, PageHeader, PasswordField, SelectField, Skeleton } from '@/components/ui';
import { NeedsOnline, OwnerOnly } from '@/components/app-shell';
import { useToast } from '@/components/toast';

interface UserRow {
  id: string;
  name: string;
  username: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<UserRow[] | null>(null);
  const [editing, setEditing] = useState<UserRow | 'new' | null>(null);
  const [pwOpen, setPwOpen] = useState(false);

  const load = useCallback(() => {
    api.get<UserRow[]>('/users').then(setRows, (e) => toast(errorMessage(e), 'bad'));
  }, [toast]);
  useEffect(load, [load]);

  return (
    <OwnerOnly>
      <NeedsOnline>
        <PageHeader
          eyebrow="Admin"
          title="Users"
          subtitle="Cashiers can sell, manage orders and shifts, and record waste. Only owners can change prices, see profit and manage users."
          actions={
            <>
              <Button variant="secondary" onClick={() => setPwOpen(true)}>
                Change my password
              </Button>
              <Button onClick={() => setEditing('new')}>+ New user</Button>
            </>
          }
        />
        {!rows ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((u, i) => (
              <Card key={u.id} className={`hover-lift animate-rise p-4 ${u.isActive ? '' : 'opacity-50'}`} style={{ animationDelay: `${i * 40}ms` }}>
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-soft font-semibold text-brand">{u.name.charAt(0).toUpperCase()}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-heading text-lg font-semibold">{u.name}</p>
                    <p className="text-sm text-muted">@{u.username}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={u.role === 'OWNER' ? 'pink' : 'lilac'}>{u.role === 'OWNER' ? 'Owner' : 'Cashier'}</Badge>
                    {!u.isActive && <Badge tone="bad">Disabled</Badge>}
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-faint">
                  <span>Since {fmtDate(u.createdAt)}</span>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                    Edit
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
        <UserModal user={editing} isSelf={editing !== 'new' && editing?.id === me?.id} onClose={() => setEditing(null)} onSaved={load} />
        <PasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
      </NeedsOnline>
    </OwnerOnly>
  );
}

function UserModal({ user, isSelf, onClose, onSaved }: { user: UserRow | 'new' | null; isSelf: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const u = user && user !== 'new' ? user : null;
  const [form, setForm] = useState({ name: '', username: '', password: '', role: 'CASHIER' as Role, isActive: true });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setError('');
    setForm({ name: u?.name ?? '', username: u?.username ?? '', password: '', role: u?.role ?? 'CASHIER', isActive: u?.isActive ?? true });
  }, [user, u]);
  async function save() {
    setBusy(true);
    setError('');
    try {
      if (u) {
        await api.patch(`/users/${u.id}`, { name: form.name, role: form.role, isActive: form.isActive, password: form.password || undefined });
      } else {
        await api.post('/users', { name: form.name, username: form.username, password: form.password, role: form.role });
      }
      toast('User saved', 'ok');
      onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={!!user} onClose={onClose} title={u ? `Edit ${u.name}` : 'New user'} footer={<Button loading={busy} onClick={save}>Save</Button>}>
      <div className="space-y-3">
        <Field label="Full name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} autoFocus />
        {!u && <Field label="Username" value={form.username} autoComplete="off" onChange={(e) => setForm((f) => ({ ...f, username: e.target.value.toLowerCase() }))} hint="Letters, numbers, dot, dash or underscore" />}
        <PasswordField label={u ? 'New password (leave blank to keep)' : 'Password'} autoComplete="new-password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} hint="At least 8 characters" />
        <SelectField label="Role" value={form.role} disabled={isSelf} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}>
          <option value="CASHIER">Cashier</option>
          <option value="OWNER">Owner</option>
        </SelectField>
        {u && !isSelf && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-pink-500" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
            Account active (unchecking signs them out everywhere)
          </label>
        )}
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}

function PasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  async function save() {
    setError('');
    try {
      await api.post('/auth/change-password', { currentPassword: cur, newPassword: next });
      toast('Password changed. Other devices were signed out.', 'ok');
      setCur('');
      setNext('');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return (
    <Modal open={open} onClose={onClose} title="Change my password" footer={<Button onClick={save}>Change password</Button>}>
      <div className="space-y-3">
        <PasswordField label="Current password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
        <PasswordField label="New password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} hint="At least 8 characters" />
        <ErrorNote>{error}</ErrorNote>
      </div>
    </Modal>
  );
}
