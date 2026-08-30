'use client';

import { useState } from 'react';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useApp } from '@/lib/client/store';

/**
 * Username-only sign-in.
 *
 * There is deliberately no password: the username is a namespace for chat
 * history, not a security boundary, and every document stays on the device. The
 * screen says so plainly rather than implying an account exists.
 */
export function LoginGate() {
  const signIn = useApp((s) => s.signIn);
  const error = useApp((s) => s.error);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    await signIn(name);
    setBusy(false);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-md animate-rise">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-brand-deep)]/15 text-2xl">
            ⚖️
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">KanoonAI</h1>
          <p className="mt-2 text-[15px] leading-relaxed text-[var(--color-muted)]">
            Upload a legal document and ask what it actually means, in plain words, in your
            own language.
          </p>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5">
          <label htmlFor="username" className="mb-2 block text-sm font-medium">
            Pick a username
          </label>
          <div className="flex gap-2">
            <input
              id="username"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. varad"
              autoComplete="username"
              autoFocus
              className="min-w-0 flex-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-ink)] px-4 py-3 text-[15px] outline-none placeholder:text-[var(--color-faint)] focus:border-[var(--color-brand)]"
            />
            <button
              type="submit"
              disabled={busy || name.trim().length < 2}
              className="flex items-center gap-1.5 rounded-xl bg-[var(--color-brand-deep)] px-4 py-3 text-[15px] font-medium text-white transition hover:bg-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Opening...' : 'Start'}
              <ArrowRight size={16} />
            </button>
          </div>

          <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-muted)]">
            No password, no email. The name just labels your chat history.
          </p>

          {error && <p className="mt-3 text-[13px] text-[var(--color-risk-high)]">{error}</p>}
        </form>

        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)]/60 px-4 py-3 text-[13px] leading-relaxed text-[var(--color-muted)]">
          <ShieldCheck size={16} className="mt-0.5 shrink-0 text-[var(--color-law)]" />
          <span>
            Documents you upload are read, indexed and searched inside this browser. They are never
            uploaded to a server or stored in the cloud.
          </span>
        </div>
      </div>
    </main>
  );
}
