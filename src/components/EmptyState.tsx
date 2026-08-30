'use client';

import { useEffect, useState } from 'react';
import { BookOpen, FileUp, MessageCircleQuestion } from 'lucide-react';
import { useApp } from '@/lib/client/store';
import { loadManifest, type CorpusManifest } from '@/lib/client/corpus';

/**
 * The first screen.
 *
 * Someone arriving here is usually holding a document they do not understand
 * and does not know what to type. So the starters are real situations in real
 * words, not feature descriptions.
 */
const STARTERS = [
  { icon: FileUp, text: 'My landlord is not returning my security deposit. What can I do?' },
  { icon: MessageCircleQuestion, text: 'Explain this agreement to me like I know nothing about law' },
  { icon: BookOpen, text: 'Someone gave me a cheque and it bounced. What are my options?' },
  { icon: MessageCircleQuestion, text: 'Company fired me without notice. Kya kar sakta hoon?' },
];

export function EmptyState() {
  const docs = useApp((s) => s.docs);
  const send = useApp.getState().send;
  const [manifest, setManifest] = useState<CorpusManifest | null>(null);

  useEffect(() => {
    void loadManifest().then(setManifest);
  }, []);

  return (
    <div className="animate-rise px-5 pb-6 pt-10 sm:pt-16">
      <div className="mx-auto max-w-2xl text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-brand-deep)]/15 text-2xl">
          ⚖️
        </div>
        <h1 className="text-[22px] font-semibold tracking-tight sm:text-[26px]">
          What does your document actually say?
        </h1>
        <p className="mx-auto mt-2.5 max-w-lg text-[15px] leading-relaxed text-[var(--color-muted)]">
          Attach a rent agreement, offer letter, loan paper or notice, or just ask a question.
          I will explain it in plain words, and show you exactly which line I got it from.
        </p>

        <div className="mt-7 grid gap-2 sm:grid-cols-2">
          {STARTERS.map((s) => (
            <button
              key={s.text}
              onClick={() => void send(s.text)}
              className="flex items-start gap-2.5 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-3 text-left text-[13.5px] leading-relaxed transition hover:border-[var(--color-brand-deep)]/50 hover:bg-[var(--color-raised)]"
            >
              <s.icon size={15} className="mt-0.5 shrink-0 text-[var(--color-muted)]" />
              <span>{s.text}</span>
            </button>
          ))}
        </div>

        {docs.length === 0 && (
          <p className="mt-5 text-[13px] text-[var(--color-faint)]">
            Tip: use the 📎 button below to add a PDF, a Word file, or even a photo of a printed page.
          </p>
        )}

        {manifest && (
          <p className="mt-6 text-[12px] leading-relaxed text-[var(--color-faint)]">
            Searching {manifest.totals.acts} Indian Acts ({manifest.totals.chunks.toLocaleString('en-IN')} sections)
            including {manifest.acts.slice(0, 4).map((a) => a.name.replace(/ \d{4}$/, '')).join(', ')} and more.
          </p>
        )}
      </div>
    </div>
  );
}
