'use client';

import { useState } from 'react';
import { BookOpen, ChevronDown, FileText } from 'lucide-react';
import type { Citation } from '@/lib/types';

/**
 * Where the answer came from.
 *
 * Shown collapsed but always present: a person who cannot read the statute has
 * no way to catch a wrong answer, so being able to see the exact clause the
 * model used is the main check they actually have.
 */
export function Citations({ citations }: { citations: Citation[] }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!citations.length) return null;

  const fromDoc = citations.filter((c) => c.source === 'user').length;
  const fromLaw = citations.length - fromDoc;

  return (
    <div className="mt-3.5">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[12.5px] text-[var(--color-muted)] transition hover:text-[var(--color-text)]"
      >
        <ChevronDown size={13} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
        Sources
        {fromDoc > 0 && <Pill tone="doc">{fromDoc} from your document</Pill>}
        {fromLaw > 0 && <Pill tone="law">{fromLaw} from Indian law</Pill>}
      </button>

      {open && (
        <ol className="mt-2 space-y-1.5">
          {citations.map((c) => {
            const isOpen = expanded === c.chunkId;
            return (
              <li key={c.chunkId}>
                <button
                  onClick={() => setExpanded(isOpen ? null : c.chunkId)}
                  className="w-full rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-2.5 text-left transition hover:border-[var(--color-line)]"
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 rounded bg-[var(--color-raised)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-muted)]">
                      {c.n}
                    </span>
                    {c.source === 'user' ? (
                      <FileText size={13} className="mt-0.5 shrink-0 text-[var(--color-doc)]" />
                    ) : (
                      <BookOpen size={13} className="mt-0.5 shrink-0 text-[var(--color-law)]" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">
                        {c.title}
                        {c.ref && <span className="text-[var(--color-muted)]"> · {c.ref}</span>}
                      </span>
                      <span className={`block text-[12px] leading-relaxed text-[var(--color-muted)] ${isOpen ? '' : 'line-clamp-2'}`}>
                        {c.snippet}
                        {!isOpen && c.snippet.length >= 320 && '…'}
                      </span>
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function Pill({ tone, children }: { tone: 'doc' | 'law'; children: React.ReactNode }) {
  const color = tone === 'doc' ? 'var(--color-doc)' : 'var(--color-law)';
  return (
    <span
      className="rounded-full px-1.5 py-0.5 text-[11px]"
      style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}
    >
      {children}
    </span>
  );
}
