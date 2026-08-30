'use client';

import { create } from 'zustand';
import type { ChatSummary, Citation, DocMeta, Message, RiskFinding } from '../types.ts';
import type { RagParams } from '../rag/params.ts';
import { TUNED_PARAMS } from '../rag/tuned.ts';
import { STORES, deleteDoc, get, listDocs, put, storageEstimate, wipeAll } from './idb.ts';
import { ask, ingestFile, invalidateIndex } from './pipeline.ts';

/**
 * Application state.
 *
 * The browser is the source of truth: chats and documents live in IndexedDB and
 * are mirrored to Redis so the sidebar survives a device change. If Redis is
 * unreachable the app is fully usable and only loses cross-device history.
 */

const USER_KEY = 'kanoon:user';
const PARAMS_KEY = 'kanoon:params';

export interface LocalChat {
  id: string;
  title: string;
  messages: Message[];
  docIds: string[];
  updatedAt: number;
}

interface AppState {
  /* identity */
  user: string | null;
  signIn: (name: string) => Promise<void>;
  signOut: () => void;

  /* chats */
  chats: ChatSummary[];
  activeId: string | null;
  messages: Message[];
  newChat: () => void;
  openChat: (id: string) => Promise<void>;
  removeChat: (id: string) => Promise<void>;
  refreshChats: () => Promise<void>;

  /* documents */
  docs: DocMeta[];
  scopedDocIds: string[];
  toggleScope: (id: string) => void;
  upload: (files: FileList | File[]) => Promise<void>;
  removeDoc: (id: string) => Promise<void>;
  refreshDocs: () => Promise<void>;

  /* conversation */
  busy: boolean;
  stage: string;
  streaming: string;
  corpus: { pct: number; label: string } | null;
  error: string | null;
  send: (text: string) => Promise<void>;
  stop: () => void;
  clearError: () => void;

  /* upload progress */
  uploading: { name: string; pct: number; label: string } | null;

  /* settings */
  params: RagParams;
  setParams: (p: Partial<RagParams>) => void;
  resetParams: () => void;

  storage: { usedMB: number; quotaMB: number } | null;
  refreshStorage: () => Promise<void>;
  wipe: () => Promise<void>;

  banner: string | null;
  setBanner: (msg: string | null) => void;
}

let controller: AbortController | null = null;

const uid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function titleFrom(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > 52 ? `${t.slice(0, 52)}...` : t || 'New chat';
}

async function syncChat(user: string, chat: LocalChat): Promise<void> {
  await put(STORES.chats, chat).catch(() => undefined);
  // Redis is a mirror, never a blocker.
  await fetch('/api/chats', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-kanoon-user': user },
    body: JSON.stringify({
      id: chat.id,
      title: chat.title,
      messages: chat.messages,
      docIds: chat.docIds,
    }),
  }).catch(() => undefined);
}

export const useApp = create<AppState>((set, getState) => ({
  user: null,
  chats: [],
  activeId: null,
  messages: [],
  docs: [],
  scopedDocIds: [],
  busy: false,
  stage: '',
  streaming: '',
  corpus: null,
  error: null,
  uploading: null,
  params: TUNED_PARAMS,
  storage: null,
  banner: null,

  /* ------------------------------------------------------------ identity */
  async signIn(name) {
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
    if (clean.length < 2) {
      set({ error: 'Pick a username with at least 2 letters.' });
      return;
    }
    localStorage.setItem(USER_KEY, clean);

    const savedParams = localStorage.getItem(PARAMS_KEY);
    set({
      user: clean,
      error: null,
      params: savedParams ? { ...TUNED_PARAMS, ...JSON.parse(savedParams) } : TUNED_PARAMS,
    });

    await Promise.all([getState().refreshChats(), getState().refreshDocs(), getState().refreshStorage()]);
    getState().newChat();
  },

  signOut() {
    localStorage.removeItem(USER_KEY);
    set({ user: null, chats: [], messages: [], activeId: null, docs: [], scopedDocIds: [] });
  },

  /* --------------------------------------------------------------- chats */
  newChat() {
    set({ activeId: uid(), messages: [], streaming: '', stage: '', error: null });
  },

  async openChat(id) {
    const { user } = getState();
    // Local first so switching chats is instant, then reconcile with Redis.
    const local = await get<LocalChat>(STORES.chats, id).catch(() => undefined);
    if (local) {
      set({ activeId: id, messages: local.messages, scopedDocIds: local.docIds ?? [], streaming: '' });
    }
    if (!user) return;
    const res = await fetch(`/api/chats/${id}`, { headers: { 'x-kanoon-user': user } }).catch(() => null);
    if (!res?.ok) return;
    const { chat } = (await res.json()) as { chat: LocalChat };
    if (chat && (!local || chat.updatedAt >= local.updatedAt)) {
      set({ activeId: id, messages: chat.messages, scopedDocIds: chat.docIds ?? [], streaming: '' });
    }
  },

  async removeChat(id) {
    const { user, activeId } = getState();
    set({ chats: getState().chats.filter((c) => c.id !== id) });
    if (user) await fetch(`/api/chats/${id}`, { method: 'DELETE', headers: { 'x-kanoon-user': user } }).catch(() => undefined);
    if (activeId === id) getState().newChat();
  },

  async refreshChats() {
    const { user } = getState();
    if (!user) return;
    const res = await fetch('/api/chats', { headers: { 'x-kanoon-user': user } }).catch(() => null);
    if (!res?.ok) return;
    const { chats } = (await res.json()) as { chats: ChatSummary[] };
    set({ chats });
  },

  /* ----------------------------------------------------------- documents */
  async refreshDocs() {
    const docs = await listDocs().catch(() => []);
    set({ docs: docs.sort((a, b) => b.createdAt - a.createdAt) });
  },

  toggleScope(id) {
    const { scopedDocIds } = getState();
    set({
      scopedDocIds: scopedDocIds.includes(id)
        ? scopedDocIds.filter((d) => d !== id)
        : [...scopedDocIds, id],
    });
    invalidateIndex();
  },

  async upload(files) {
    const { user, params } = getState();
    if (!user) return;
    const list = Array.from(files);
    if (!list.length) return;

    for (const file of list) {
      set({ uploading: { name: file.name, pct: 0, label: 'starting...' }, error: null });
      try {
        const { doc, risks, warnings } = await ingestFile(file, {
          user,
          params,
          onProgress: (pct, label) => set({ uploading: { name: file.name, pct, label } }),
        });

        await getState().refreshDocs();
        set({ scopedDocIds: [...getState().scopedDocIds, doc.id] });

        // Speak up immediately about anything risky - this is often the moment
        // the person most needs to be warned, before they even know what to ask.
        const lines: string[] = [
          `**${doc.name}** is ready. I read ${doc.chunks} sections${doc.extraction === 'vision' ? ' using the vision model (it was a scan)' : ''}.`,
        ];
        if (risks.length) {
          const high = risks.filter((r) => r.severity === 'high').length;
          lines.push(
            `\nI spotted **${risks.length} clause${risks.length > 1 ? 's' : ''} worth a closer look**${high ? `, ${high} of them serious` : ''}. Ask me *"what should I watch out for?"* and I will go through them.`,
          );
        }
        for (const w of warnings) lines.push(`\n_${w}_`);

        const msg: Message = {
          id: uid(),
          role: 'assistant',
          content: lines.join('\n'),
          createdAt: Date.now(),
          risks,
        };
        set({ messages: [...getState().messages, msg] });
      } catch (err) {
        set({ error: (err as Error).message });
      } finally {
        set({ uploading: null });
        await getState().refreshStorage();
      }
    }
  },

  async removeDoc(id) {
    await deleteDoc(id).catch(() => undefined);
    invalidateIndex();
    set({ scopedDocIds: getState().scopedDocIds.filter((d) => d !== id) });
    await getState().refreshDocs();
    await getState().refreshStorage();
  },

  /* -------------------------------------------------------------- asking */
  async send(text) {
    const { user, params, messages, scopedDocIds, activeId } = getState();
    if (!user || !text.trim() || getState().busy) return;

    const chatId = activeId ?? uid();
    const userMsg: Message = { id: uid(), role: 'user', content: text.trim(), createdAt: Date.now() };
    const next = [...messages, userMsg];

    controller = new AbortController();
    set({ messages: next, busy: true, streaming: '', stage: 'thinking', error: null, activeId: chatId });

    try {
      const result = await ask({
        user,
        question: text.trim(),
        history: messages,
        docIds: scopedDocIds,
        params,
        signal: controller.signal,
        callbacks: {
          onStage: (stage) => set({ stage }),
          onDelta: (d) => set({ streaming: getState().streaming + d }),
          onCorpusProgress: (pct, label) => set({ corpus: pct >= 100 ? null : { pct, label } }),
        },
      });

      const assistant: Message = {
        id: uid(),
        role: 'assistant',
        content: result.answer,
        createdAt: Date.now(),
        citations: result.citations,
        risks: result.risks,
        trace: result.trace,
        blocked: result.blocked,
      };

      const finalMessages = [...next, assistant];
      set({ messages: finalMessages, streaming: '', stage: '', corpus: null });

      const chat: LocalChat = {
        id: chatId,
        title: titleFrom(next[0]?.content ?? text),
        messages: finalMessages,
        docIds: scopedDocIds,
        updatedAt: Date.now(),
      };
      await syncChat(user, chat);
      await getState().refreshChats();

      // Distil anything durable worth remembering for next time.
      if (!result.blocked) {
        fetch('/api/memory', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-kanoon-user': user },
          body: JSON.stringify({ exchange: `User: ${text}\nAssistant: ${result.answer.slice(0, 1500)}` }),
        }).catch(() => undefined);
      }
    } catch (err) {
      const message = (err as Error).name === 'AbortError' ? 'Stopped.' : (err as Error).message;
      set({ error: message, streaming: '', stage: '' });
    } finally {
      controller = null;
      set({ busy: false, corpus: null });
    }
  },

  stop() {
    controller?.abort();
    set({ busy: false, stage: '', streaming: '' });
  },

  clearError: () => set({ error: null }),

  /* ------------------------------------------------------------ settings */
  setParams(p) {
    const params = { ...getState().params, ...p };
    localStorage.setItem(PARAMS_KEY, JSON.stringify(params));
    invalidateIndex();
    set({ params });
  },

  resetParams() {
    localStorage.removeItem(PARAMS_KEY);
    invalidateIndex();
    set({ params: TUNED_PARAMS });
  },

  async refreshStorage() {
    set({ storage: await storageEstimate().catch(() => null) });
  },

  async wipe() {
    await wipeAll();
    invalidateIndex();
    set({ docs: [], scopedDocIds: [], messages: [], banner: 'Everything stored in this browser was deleted.' });
    await getState().refreshStorage();
  },

  setBanner: (banner) => set({ banner }),
}));

/** Restores the signed-in username on load. */
export function bootstrapUser(): string | null {
  try {
    return localStorage.getItem(USER_KEY);
  } catch {
    return null;
  }
}
