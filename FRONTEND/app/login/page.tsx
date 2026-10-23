'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { errorMessage } from '@/lib/api';
import { Button, ErrorNote, Field, PasswordField } from '@/components/ui';
import { Logo } from '@/components/logo';
import { Bat, Cobweb, FlyingBats, Ghost, Marquee, PinkPumpkin, Sparkle, SparkleField, Spider } from '@/components/halloween';

/** Seasonal Halloween login (shop pink on a midnight background). The rest of the app stays plain and professional. */
export default function LoginPage() {
  const { login, status } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') router.replace('/dashboard/');
  }, [status, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const u = await login(username.trim(), password);
      router.replace(u.role === 'OWNER' ? '/dashboard/' : '/pos/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="relative flex min-h-dvh flex-col overflow-hidden text-[#fff7fb]"
      style={{
        backgroundColor: '#150a17',
        backgroundImage:
          'radial-gradient(1200px 600px at 85% -10%, rgb(244 114 182 / 0.18), transparent 60%), radial-gradient(900px 500px at -10% 110%, rgb(196 181 253 / 0.10), transparent 60%)',
      }}
    >
      <Cobweb className="absolute top-0 left-0 h-40 w-40 text-[#f6a6c9]/30 md:h-56 md:w-56" />
      <Cobweb className="absolute top-0 right-0 h-40 w-40 text-[#f6a6c9]/30 md:h-56 md:w-56" flip />
      <Spider className="absolute top-0 left-[22%] hidden md:block" />
      <FlyingBats />
      <SparkleField />

      <div className="relative z-10 mx-auto grid w-full max-w-6xl flex-1 items-center gap-10 px-4 py-10 md:grid-cols-[1.15fr_1fr] md:px-8">
        {/* Hero */}
        <section className="animate-rise text-center md:text-left">
          <Logo size={110} className="mx-auto mb-6 hidden ring-2 md:block ring-[#f6a6c9]/60 md:mx-0" />
          <p className="mb-3 inline-flex items-center gap-2 text-xs font-semibold tracking-[0.22em] text-[#f6a6c9] uppercase">
            <Sparkle className="h-3 w-3" /> Hamugaway Lifestyle Hub · Cordova
          </p>
          <h1 className="text-4xl leading-[1.05] font-extrabold text-[#f6a6c9] drop-shadow-[0_4px_30px_rgb(244_114_182/0.45)] md:text-7xl">Aiv&apos;s Cafe</h1>
          <p className="mt-3 text-xl font-semibold text-[#fde4ef] md:text-2xl">Happy Halloween from Yummy Brew Blend &amp; Takoyaki Delight</p>
          <div className="relative mx-auto mt-10 hidden h-40 w-72 md:mx-0 md:block">
            <PinkPumpkin className="halloween-motion absolute bottom-0 left-6 h-28 w-32 animate-[hw-float_7s_ease-in-out_infinite]" />
            <PinkPumpkin className="halloween-motion absolute right-6 bottom-2 h-16 w-20 animate-[hw-float_7s_ease-in-out_-2s_infinite]" face={false} />
            <Ghost className="halloween-motion absolute top-0 left-1/2 h-24 w-20 -translate-x-1/2 animate-[hw-bob_3.2s_ease-in-out_infinite]" />
            <Bat className="halloween-motion absolute top-4 left-0 h-6 w-12 animate-[hw-float_7s_ease-in-out_-1s_infinite] text-[#f6a6c9]/70" />
            <Bat className="halloween-motion absolute top-10 right-0 h-5 w-10 animate-[hw-float_7s_ease-in-out_-3s_infinite] text-[#c4b5fd]/70" />
          </div>
        </section>

        {/* Login card — plain and readable */}
        <form onSubmit={submit} className="card relative w-full animate-pop space-y-5 p-6 text-ink md:p-8" aria-labelledby="login-title">
          <div className="absolute -top-8 right-8">
            <Ghost className="halloween-motion h-14 w-12 animate-[hw-bob_3.2s_ease-in-out_infinite]" />
          </div>
          <div>
            <p className="eyebrow">Staff sign in</p>
            <h2 id="login-title" className="mt-1 text-2xl font-bold">
              Welcome back
            </h2>
            <p className="mt-1 text-sm text-muted">Use the account the owner created for you.</p>
          </div>
          <Field label="Username" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
          <PasswordField label="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <ErrorNote>{error}</ErrorNote>
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Sign in
          </Button>
          <p className="text-center text-xs text-faint">Sign in once while online. After that, the POS keeps working on this device even without internet.</p>
        </form>
      </div>

      <div className="relative z-10">
        <Marquee items={['Milk Tea', 'Iced Coffee', 'Fruit Soda', 'Frappé', 'Takoyaki', 'Walk-ins welcome', 'We deliver Cordova & Lapu-Lapu', 'Happy Halloween']} />
      </div>
    </div>
  );
}
