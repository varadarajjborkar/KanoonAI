/** Shared domain types. Kept dependency-free so browser, server and eval scripts can all import it. */

export type Role = 'user' | 'assistant' | 'system';

/** A retrievable unit of text. Lives in IndexedDB (user docs) or a corpus shard (statutes). */
export interface Chunk {
  id: string;
  docId: string;
  /** 'corpus' = Indian statute we shipped, 'user' = something the person uploaded. */
  source: 'corpus' | 'user';
  text: string;
  /** Human-facing citation label, e.g. "Indian Contract Act, 1872 - S. 73". */
  title: string;
  /** Section / clause / article number when we could parse one. */
  ref?: string;
  /**
   * The section's marginal note ("Punishment for identity theft"). Carried on
   * every chunk of a section, including continuations, so the lexical index can
   * weight the topic even for a chunk that starts mid-sentence.
   */
  heading?: string;
  /** Page number for uploaded PDFs. */
  page?: number;
  /** Position of the chunk inside its document, used for neighbour expansion. */
  ordinal: number;
  /** Quantised embedding (int8) + scale, or undefined when running BM25-only. */
  vec?: number[];
}

export interface DocMeta {
  id: string;
  name: string;
  source: 'corpus' | 'user';
  chars: number;
  chunks: number;
  createdAt: number;
  /** How the text was obtained: parsed digitally or read by the vision model. */
  extraction: 'text' | 'vision' | 'mixed';
  pages?: number;
}

export interface Citation {
  n: number;
  chunkId: string;
  title: string;
  ref?: string;
  page?: number;
  source: 'corpus' | 'user';
  snippet: string;
  score: number;
}

export interface RiskFinding {
  clause: string;
  severity: 'low' | 'medium' | 'high';
  reasons: string[];
  plain: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  citations?: Citation[];
  risks?: RiskFinding[];
  /** Pipeline trace shown in the "how I got this" drawer. */
  trace?: TraceStep[];
  blocked?: { reason: string; category: string };
}

export interface TraceStep {
  agent: string;
  ms: number;
  detail: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  updatedAt: number;
  docCount: number;
}

export interface RetrievalHit {
  chunk: Chunk;
  score: number;
  bm25?: number;
  dense?: number;
  rank?: number;
}
