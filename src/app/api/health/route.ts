import { NextResponse } from 'next/server';
import { config, hasOllama } from '@/lib/config';
import { backend } from '@/lib/redis';

export const runtime = 'nodejs';

/** Cheap status probe the UI uses to tell the user what is and is not wired up. */
export async function GET() {
  let modelReachable: boolean | null = null;
  if (hasOllama()) {
    try {
      const res = await fetch(`${config.ollama.baseUrl}/api/tags`, {
        headers: { Authorization: `Bearer ${config.ollama.apiKey}` },
        signal: AbortSignal.timeout(6000),
      });
      modelReachable = res.ok;
    } catch {
      modelReachable = false;
    }
  }

  return NextResponse.json({
    ok: true,
    ollama: {
      configured: hasOllama(),
      reachable: modelReachable,
      chatModel: config.ollama.chatModel,
      visionModel: config.ollama.visionModel,
      embedModel: config.ollama.embedModel || null,
      embeddings: config.ollama.embedModel ? 'remote' : 'local-hashing',
    },
    history: backend(),
  });
}
