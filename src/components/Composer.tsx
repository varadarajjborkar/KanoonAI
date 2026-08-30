'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Paperclip, Square } from 'lucide-react';
import { useApp } from '@/lib/client/store';
import { SUPPORTED } from '@/lib/client/extract';

export function Composer() {
  const { busy, send, stop, upload, uploading } = useApp();
  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Grow with the text, but never past a third of the screen.
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  function submit() {
    const value = text.trim();
    if (!value || busy) return;
    setText('');
    void send(value);
  }

  return (
    <div className="px-3 pb-3 pt-1 sm:px-4 sm:pb-4">
      <div className="mx-auto max-w-3xl">
        {uploading && (
          <div className="mb-2 rounded-xl border border-[var(--color-line)] bg-[var(--color-surface)] px-3 py-2.5">
            <div className="mb-1.5 flex justify-between text-[12.5px]">
              <span className="truncate pr-2">{uploading.name}</span>
              <span className="shrink-0 text-[var(--color-muted)]">{uploading.label}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-[var(--color-line)]">
              <div
                className="h-full rounded-full bg-[var(--color-brand-deep)] transition-all"
                style={{ width: `${uploading.pct}%` }}
              />
            </div>
          </div>
        )}

        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
          }}
          className={`flex items-end gap-1.5 rounded-2xl border bg-[var(--color-surface)] p-1.5 transition ${
            dragging ? 'border-[var(--color-brand)] bg-[var(--color-brand-deep)]/5' : 'border-[var(--color-line)]'
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept={SUPPORTED}
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) void upload(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={Boolean(uploading)}
            aria-label="Attach a document"
            title="Attach a PDF, photo, or Word file"
            className="shrink-0 rounded-xl p-2.5 text-[var(--color-muted)] transition hover:bg-[var(--color-raised)] hover:text-[var(--color-text)] disabled:opacity-40"
          >
            <Paperclip size={18} />
          </button>

          <textarea
            ref={areaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={dragging ? 'Drop your document here' : 'Ask about your document, or any Indian law…'}
            className="max-h-[200px] min-h-[42px] flex-1 resize-none bg-transparent px-1 py-2.5 text-[15px] leading-relaxed outline-none placeholder:text-[var(--color-faint)]"
          />

          {busy ? (
            <button
              onClick={stop}
              aria-label="Stop"
              className="shrink-0 rounded-xl bg-[var(--color-raised)] p-2.5 transition hover:bg-[var(--color-line)]"
            >
              <Square size={16} fill="currentColor" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!text.trim()}
              aria-label="Send"
              className="shrink-0 rounded-xl bg-[var(--color-brand-deep)] p-2.5 text-white transition hover:bg-[var(--color-brand)] disabled:cursor-not-allowed disabled:bg-[var(--color-raised)] disabled:text-[var(--color-faint)]"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>

        <p className="mt-2 text-center text-[11px] text-[var(--color-faint)]">
          KanoonAI explains documents. It is not a lawyer, and it can be wrong, so check anything important.
        </p>
      </div>
    </div>
  );
}
