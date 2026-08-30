'use client';

import { useEffect, useState } from 'react';
import { useApp, bootstrapUser } from '@/lib/client/store';
import { idbAvailable } from '@/lib/client/idb';
import { LoginGate } from '@/components/LoginGate';
import { Sidebar } from '@/components/Sidebar';
import { ChatView } from '@/components/ChatView';

export default function Home() {
  const user = useApp((s) => s.user);
  const { signIn, setBanner } = useApp.getState();
  const [ready, setReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Restore the session, and warn early if this browser cannot store anything -
  // the whole product depends on IndexedDB being available.
  useEffect(() => {
    const saved = bootstrapUser();
    if (!idbAvailable()) {
      setBanner(
        'This browser is blocking local storage (private mode?). You can still ask questions, but uploaded documents will not be saved.',
      );
    }
    if (saved) void signIn(saved).finally(() => setReady(true));
    else setReady(true);
  }, [signIn, setBanner]);

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <span className="animate-pulse-soft text-[15px] text-[var(--color-muted)]">Loading…</span>
      </div>
    );
  }

  if (!user) return <LoginGate />;

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <ChatView onOpenMenu={() => setMenuOpen(true)} />
    </div>
  );
}
