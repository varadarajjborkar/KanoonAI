'use client';

import { useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertCircle, Menu, Sparkles, X } from 'lucide-react';
import { useApp } from '@/lib/client/store';
import { MessageBubble } from './MessageBubble';
import { Composer } from './Composer';
import { EmptyState } from './EmptyState';

export function ChatView({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { messages, streaming, stage, busy, error, clearError, corpus, banner, setBanner } = useApp();
  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Follow the stream, but stop fighting the user if they scroll up to read.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (pinned.current) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streaming]);

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-[var(--color-line)] px-3 py-2.5 md:hidden">
        <button onClick={onOpenMenu} aria-label="Open menu" className="rounded-lg p-1.5 hover:bg-[var(--color-raised)]">
          <Menu size={18} />
        </button>
        <span className="text-[15px] font-semibold">KanoonAI</span>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl py-4">
          {messages.length === 0 && !streaming ? (
            <EmptyState />
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}

          {streaming && (
            <div className="animate-rise px-4 py-2.5">
              <div className="flex gap-3">
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand-deep)]/15">
                  <Sparkles size={14} className="text-[var(--color-brand)]" />
                </div>
                <div className="prose-answer min-w-0 flex-1 break-words">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{streaming}</ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          {busy && !streaming && <Thinking stage={stage} corpus={corpus} />}

          <div ref={endRef} />
        </div>
      </div>

      {banner && (
        <Notice tone="info" onClose={() => setBanner(null)}>
          {banner}
        </Notice>
      )}
      {error && (
        <Notice tone="error" onClose={clearError}>
          {error}
        </Notice>
      )}

      <Composer />
    </div>
  );
}

function Thinking({ stage, corpus }: { stage: string; corpus: { pct: number; label: string } | null }) {
  return (
    <div className="px-4 py-2.5">
      <div className="flex gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand-deep)]/15">
          <Sparkles size={14} className="animate-pulse-soft text-[var(--color-brand)]" />
        </div>
        <div className="min-w-0 flex-1 pt-1">
          <p className="animate-pulse-soft text-[14px] text-[var(--color-muted)]">
            {corpus?.label ?? stage ?? 'thinking…'}
          </p>
          {corpus && (
            <div className="mt-2 h-1 max-w-xs overflow-hidden rounded-full bg-[var(--color-line)]">
              <div className="h-full rounded-full bg-[var(--color-brand-deep)] transition-all" style={{ width: `${corpus.pct}%` }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Notice({
  tone, onClose, children,
}: {
  tone: 'error' | 'info'; onClose: () => void; children: React.ReactNode;
}) {
  const color = tone === 'error' ? 'var(--color-risk-high)' : 'var(--color-brand)';
  return (
    <div className="px-3 sm:px-4">
      <div
        className="mx-auto flex max-w-3xl items-start gap-2 rounded-xl border px-3 py-2.5 text-[13px] leading-relaxed"
        style={{ borderColor: `color-mix(in srgb, ${color} 35%, transparent)`, background: `color-mix(in srgb, ${color} 8%, transparent)` }}
      >
        <AlertCircle size={15} className="mt-0.5 shrink-0" style={{ color }} />
        <span className="min-w-0 flex-1">{children}</span>
        <button onClick={onClose} aria-label="Dismiss" className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100">
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
