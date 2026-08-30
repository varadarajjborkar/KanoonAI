'use client';

import { useState } from 'react';
import { AlertTriangle, ChevronDown } from 'lucide-react';
import type { RiskFinding } from '@/lib/types';

const TONE = {
  high: { color: 'var(--color-risk-high)', label: 'Serious' },
  medium: { color: 'var(--color-risk-med)', label: 'Worth checking' },
  low: { color: 'var(--color-risk-low)', label: 'Minor' },
} as const;

/**
 * Clauses the local scanner flagged.
 *
 * Deliberately separate from the model's answer: this list is produced by
 * deterministic pattern matching, so it is here even when the model is
 * unavailable, and it cannot hallucinate a clause that is not in the document.
 */
export function RiskList({ risks }: { risks: RiskFinding[] }) {
  const [open, setOpen] = useState(false);
  if (!risks.length) return null;

  const high = risks.filter((r) => r.severity === 'high').length;

  return (
    <div className="mt-3.5 overflow-hidden rounded-xl border border-[var(--color-line)]">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 bg-[var(--color-raised)] px-3 py-2.5 text-left"
      >
        <AlertTriangle size={14} style={{ color: high ? TONE.high.color : TONE.medium.color }} />
        <span className="flex-1 text-[13px] font-medium">
          {risks.length} clause{risks.length > 1 ? 's' : ''} to look at closely
        </span>
        <ChevronDown size={14} className={`text-[var(--color-muted)] transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>

      {open && (
        <ul className="divide-y divide-[var(--color-line-soft)]">
          {risks.map((r, i) => (
            <li key={i} className="px-3 py-2.5">
              <div className="mb-1 flex items-center gap-2">
                <span
                  className="rounded px-1.5 py-0.5 text-[10.5px] font-medium"
                  style={{
                    color: TONE[r.severity].color,
                    background: `color-mix(in srgb, ${TONE[r.severity].color} 14%, transparent)`,
                  }}
                >
                  {TONE[r.severity].label}
                </span>
                <span className="text-[11.5px] text-[var(--color-faint)]">{r.reasons.join(' · ')}</span>
              </div>
              <p className="mb-1.5 text-[13.5px] leading-relaxed">{r.plain}</p>
              <p className="rounded-lg bg-[var(--color-ink)] px-2.5 py-2 text-[12px] italic leading-relaxed text-[var(--color-muted)]">
                “{r.clause}”
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
