'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { Spinner } from '@/components/ui';

export default function Home() {
  const { status, user } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (status === 'anonymous') router.replace('/login/');
    if (status === 'authenticated') router.replace(user?.role === 'OWNER' ? '/dashboard/' : '/pos/');
  }, [status, user, router]);
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Spinner className="h-6 w-6 text-brand" />
    </div>
  );
}
