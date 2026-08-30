'use client';

import { useEffect, useState } from 'react';
import {
  FileText, HardDrive, LogOut, MessageSquarePlus, PanelLeftClose,
  Scale, Settings2, Trash2, X,
} from 'lucide-react';
import { useApp } from '@/lib/client/store';
import { relativeTime } from '@/lib/client/format';

/** Recent chats, the documents held in this browser, and the storage footprint. */
export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    user, chats, activeId, docs, scopedDocIds, storage,
    newChat, openChat, removeChat, removeDoc, toggleScope, signOut, refreshStorage,
  } = useApp();
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    void refreshStorage();
  }, [refreshStorage, docs.length]);

  return (
    <>
      {open && (
        <button
          aria-label="Close menu"
          onClick={onClose}
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[278px] flex-col border-r border-[var(--color-line)] bg-[var(--color-surface)] transition-transform md:static md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between px-3 py-3">
          <div className="flex items-center gap-2 px-1">
            <Scale size={17} className="text-[var(--color-brand)]" />
            <span className="text-[15px] font-semibold tracking-tight">KanoonAI</span>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-raised)] md:hidden">
            <PanelLeftClose size={17} />
          </button>
        </div>

        <div className="px-3 pb-2">
          <button
            onClick={() => { newChat(); onClose(); }}
            className="flex w-full items-center gap-2 rounded-xl border border-[var(--color-line)] px-3 py-2.5 text-[14px] font-medium transition hover:bg-[var(--color-raised)]"
          >
            <MessageSquarePlus size={16} />
            New chat
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {/* ------------------------------------------------ documents */}
          <SectionLabel>
            Your documents
            {docs.length > 0 && <span className="text-[var(--color-faint)]"> · {docs.length}</span>}
          </SectionLabel>

          {docs.length === 0 ? (
            <p className="px-2 pb-3 text-[12.5px] leading-relaxed text-[var(--color-faint)]">
              Nothing uploaded yet. Attach a PDF, photo or Word file to ask about it.
            </p>
          ) : (
            <ul className="mb-3 space-y-0.5">
              {docs.map((d) => {
                const active = scopedDocIds.includes(d.id);
                return (
                  <li key={d.id} className="group flex items-center gap-1.5">
                    <button
                      onClick={() => toggleScope(d.id)}
                      title={active ? 'Included in search' : 'Click to include in search'}
                      className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-left text-[13px] transition ${
                        active ? 'bg-[var(--color-raised)] text-[var(--color-text)]' : 'text-[var(--color-muted)] hover:bg-[var(--color-raised)]/60'
                      }`}
                    >
                      <FileText size={14} className={active ? 'shrink-0 text-[var(--color-doc)]' : 'shrink-0 opacity-50'} />
                      <span className="min-w-0 flex-1 truncate">{d.name}</span>
                      {d.extraction === 'vision' && (
                        <span className="shrink-0 rounded bg-[var(--color-brand-deep)]/20 px-1 text-[10px] text-[var(--color-brand)]">
                          scan
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => removeDoc(d.id)}
                      aria-label={`Delete ${d.name}`}
                      className="rounded-lg p-1.5 text-[var(--color-faint)] opacity-0 transition hover:text-[var(--color-risk-high)] group-hover:opacity-100"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* ---------------------------------------------------- chats */}
          <SectionLabel>Recent chats</SectionLabel>
          {chats.length === 0 ? (
            <p className="px-2 text-[12.5px] text-[var(--color-faint)]">Your chats will appear here.</p>
          ) : (
            <ul className="space-y-0.5">
              {chats.map((c) => (
                <li key={c.id} className="group flex items-center gap-1">
                  <button
                    onClick={() => { void openChat(c.id); onClose(); }}
                    className={`min-w-0 flex-1 rounded-lg px-2 py-2 text-left transition ${
                      activeId === c.id ? 'bg-[var(--color-raised)]' : 'hover:bg-[var(--color-raised)]/60'
                    }`}
                  >
                    <span className="block truncate text-[13px]">{c.title}</span>
                    <span className="block text-[11px] text-[var(--color-faint)]">
                      {relativeTime(c.updatedAt)}
                      {c.docCount > 0 && ` · ${c.docCount} doc`}
                    </span>
                  </button>
                  <button
                    onClick={() => removeChat(c.id)}
                    aria-label="Delete chat"
                    className="rounded-lg p-1.5 text-[var(--color-faint)] opacity-0 transition hover:text-[var(--color-risk-high)] group-hover:opacity-100"
                  >
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>

        {/* ------------------------------------------------------ footer */}
        <div className="border-t border-[var(--color-line)] px-3 py-3">
          {storage && (
            <div className="mb-2.5 px-1">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] text-[var(--color-faint)]">
                <HardDrive size={11} />
                {storage.usedMB.toFixed(1)} MB stored in this browser
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-[var(--color-line)]">
                <div
                  className="h-full rounded-full bg-[var(--color-brand-deep)]"
                  style={{ width: `${Math.min(100, (storage.usedMB / Math.max(1, storage.quotaMB)) * 100)}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate px-2 text-[13px] text-[var(--color-muted)]">
              @{user}
            </span>
            <button onClick={() => setShowSettings(true)} aria-label="Settings" className="rounded-lg p-2 text-[var(--color-muted)] hover:bg-[var(--color-raised)]">
              <Settings2 size={15} />
            </button>
            <button onClick={signOut} aria-label="Sign out" className="rounded-lg p-2 text-[var(--color-muted)] hover:bg-[var(--color-raised)]">
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {showSettings && <SettingsDrawer onClose={() => setShowSettings(false)} />}
    </>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="px-2 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-faint)]">
      {children}
    </h2>
  );
}

/* --------------------------------------------------------------- settings */

/** Exposes the retrieval knobs, so the tuning story is visible, not buried. */
function SettingsDrawer({ onClose }: { onClose: () => void }) {
  const { params, setParams, resetParams, wipe } = useApp();
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then(setHealth).catch(() => undefined);
  }, []);

  const ollama = health?.ollama as Record<string, unknown> | undefined;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-[var(--color-line)] bg-[var(--color-surface)] p-5 sm:rounded-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">Settings</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--color-muted)] hover:bg-[var(--color-raised)]">
            <X size={17} />
          </button>
        </div>

        <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--color-faint)]">Status</h3>
        <dl className="mb-5 space-y-1 rounded-xl border border-[var(--color-line)] p-3 text-[13px]">
          <Row k="Answer model" v={String(ollama?.chatModel ?? 'not set')} />
          <Row k="Vision model" v={String(ollama?.visionModel ?? 'not set')} />
          <Row k="Embeddings" v={String(ollama?.embeddings ?? 'not set')} />
          <Row k="Chat history" v={String(health?.history ?? 'not set')} />
          <Row
            k="Model reachable"
            v={ollama?.reachable === true ? 'yes' : ollama?.configured ? 'no' : 'no key set'}
          />
        </dl>

        <h3 className="mb-1 text-[12px] font-semibold uppercase tracking-wider text-[var(--color-faint)]">
          Retrieval parameters
        </h3>
        <p className="mb-3 text-[12px] leading-relaxed text-[var(--color-muted)]">
          These defaults came out of the parameter sweep in <code>npm run eval:sweep</code>. Change
          them to see retrieval behave differently.
        </p>

        <div className="space-y-3">
          <Slider label="Chunks sent to the model (topK)" value={params.topK} min={2} max={16} step={1} onChange={(v) => setParams({ topK: v })} />
          <Slider label="Candidates per retriever" value={params.candidateK} min={10} max={80} step={5} onChange={(v) => setParams({ candidateK: v })} />
          <Slider label="Keyword vs meaning (1 = keywords only)" value={params.lexicalWeight} min={0} max={1} step={0.05} onChange={(v) => setParams({ lexicalWeight: v })} />
          <Slider label="Diversity (MMR λ, 1 = no diversity)" value={params.mmrLambda} min={0.3} max={1} step={0.05} onChange={(v) => setParams({ mmrLambda: v })} />
          <Slider label="Extra rewritten queries" value={params.multiQuery} min={0} max={4} step={1} onChange={(v) => setParams({ multiQuery: v })} />
          <Slider label="Neighbouring sections pulled in" value={params.neighborWindow} min={0} max={3} step={1} onChange={(v) => setParams({ neighborWindow: v })} />
          <Slider label="Drop weak hits (score floor)" value={params.minScoreRatio} min={0} max={0.6} step={0.05} onChange={(v) => setParams({ minScoreRatio: v })} />

          <label className="flex items-center gap-2.5 text-[13px]">
            <input
              type="checkbox"
              checked={params.useReranker}
              onChange={(e) => setParams({ useReranker: e.target.checked })}
              className="h-4 w-4 accent-[var(--color-brand-deep)]"
            />
            Re-rank results with the model (slower, more precise)
          </label>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button onClick={resetParams} className="rounded-lg border border-[var(--color-line)] px-3 py-2 text-[13px] hover:bg-[var(--color-raised)]">
            Reset to tuned defaults
          </button>
          <button
            onClick={() => {
              if (confirm('Delete every document and chat stored in this browser? This cannot be undone.')) {
                void wipe();
                onClose();
              }
            }}
            className="rounded-lg border border-[var(--color-risk-high)]/40 px-3 py-2 text-[13px] text-[var(--color-risk-high)] hover:bg-[var(--color-risk-high)]/10"
          >
            Delete all my local data
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-[var(--color-muted)]">{k}</dt>
      <dd className="truncate font-mono text-[12px]">{v}</dd>
    </div>
  );
}

function Slider({
  label, value, min, max, step, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between text-[13px]">
        <span className="text-[var(--color-muted)]">{label}</span>
        <span className="font-mono text-[12px]">{value}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--color-brand-deep)]"
      />
    </label>
  );
}
