import { NextResponse } from 'next/server';
import { deleteChat, getChat } from '@/lib/redis';
import { requireUser } from '@/lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { user, error } = requireUser(req);
  if (error) return error;
  const { id } = await params;
  const chat = await getChat(user!, id);
  if (!chat) return NextResponse.json({ error: 'Chat not found.' }, { status: 404 });
  return NextResponse.json({ chat });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { user, error } = requireUser(req);
  if (error) return error;
  const { id } = await params;
  await deleteChat(user!, id);
  return NextResponse.json({ ok: true });
}
