'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, Info, ShieldAlert, Sparkles } from 'lucide-react';
import type { Message } from '@/lib/types';
import { Citations } from './Citations';
import { RiskList } from './RiskList';

const DISCLAIMER =
  'This is general information to help you understand the document, not legal advice.';

export function MessageBubble({ message, warnings }: { message: Message; warnings?: string[] }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="animate-rise flex justify-end px-4 py-2.5">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-[var(--color-raised)] px-4 py-2.5 text-[15px] leading-relaxed sm:max-w-[75%]">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-rise px-4 py-2.5">
      <div className="flex gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand-deep)]/15">
          {message.blocked ? (
            <ShieldAlert size={15} className="text-[var(--color-risk-med)]" />
          ) : (
            <Sparkles size={14} className="text-[var(--color-brand)]" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="prose-answer break-words">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
          </div>

          {message.risks && message.risks.length > 0 && <RiskList risks={message.risks} />}
          {message.citations && <Citations citations={message.citations} />}

          {!message.blocked && message.citations && message.citations.length > 0 && (
            <p className="mt-3 flex items-start gap-1.5 text-[11.5px] leading-relaxed text-[var(--color-faint)]">
              <Info size={12} className="mt-0.5 shrink-0" />
              {DISCLAIMER}
            </p>
          )}

          <MessageFooter message={message} warnings={warnings} />
        </div>
      </div>
    </div>
  );
}

/** Copy button plus the pipeline trace, for anyone who wants to see the plumbing. */
function MessageFooter({ message, warnings }: { message: Message; warnings?: string[] }) {
  const [copied, setCopied] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const hasTrace = Boolean(message.trace?.length);

  return (
    <>
      <div className="mt-2 flex items-center gap-1">
        <button
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(message.content);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            } catch {
              /* clipboard blocked (http origin, or permission denied) */
            }
          }}
          className="rounded-lg p-1.5 text-[var(--color-faint)] transition hover:bg-[var(--color-raised)] hover:text-[var(--color-text)]"
          aria-label="Copy answer"
        >
          {copied ? <Check size={13} className="text-[var(--color-law)]" /> : <Copy size={13} />}
        </button>

        {hasTrace && (
          <button
            onClick={() => setShowTrace(!showTrace)}
            className="rounded-lg px-2 py-1 text-[11.5px] text-[var(--color-faint)] transition hover:bg-[var(--color-raised)] hover:text-[var(--color-text)]"
          >
            {showTrace ? 'hide' : 'how I got this'}
          </button>
        )}
      </div>

      {showTrace && message.trace && (
        <ul className="mt-1.5 space-y-1 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-surface)] p-2.5 font-mono text-[11.5px] text-[var(--color-muted)]">
          {message.trace.map((t, i) => (
            <li key={i} className="flex gap-2">
              <span className="w-11 shrink-0 text-right text-[var(--color-faint)]">{t.ms}ms</span>
              <span className="w-40 shrink-0 truncate text-[var(--color-text)]">{t.agent}</span>
              <span className="min-w-0 flex-1 truncate">{t.detail}</span>
            </li>
          ))}
          {warnings?.map((w, i) => (
            <li key={`w${i}`} className="flex gap-2 text-[var(--color-risk-med)]">
              <span className="w-11 shrink-0 text-right">!</span>
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
