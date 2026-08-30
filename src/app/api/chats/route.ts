import { NextResponse } from 'next/server';
import { z } from 'zod';
import { listChats, saveChat, type StoredChat } from '@/lib/redis';
import { bad, requireUser } from '@/lib/http';

export const runtime = 'nodejs';

const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  createdAt: z.number(),
  citations: z.array(z.any()).optional(),
  risks: z.array(z.any()).optional(),
  trace: z.array(z.any()).optional(),
  blocked: z.any().optional(),
});

const SaveSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().max(120).default('New chat'),
  messages: z.array(MessageSchema).max(200),
  docIds: z.array(z.string()).max(50).default([]),
});

/** Recent chats for the sidebar. */
export async function GET(req: Request) {
  const { user, error } = requireUser(req);
  if (error) return error;
  return NextResponse.json({ chats: await listChats(user!) });
}

/** Upsert a chat. The browser owns the truth; Redis is the cross-device mirror. */
export async function POST(req: Request) {
  const { user, error } = requireUser(req);
  if (error) return error;

  const parsed = SaveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? 'Invalid chat payload.');

  const chat: StoredChat = { ...parsed.data, updatedAt: Date.now() } as StoredChat;
  await saveChat(user!, chat);
  return NextResponse.json({ ok: true, updatedAt: chat.updatedAt });
}
