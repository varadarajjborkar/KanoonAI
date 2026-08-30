# KanoonAI

Legal documents are written for lawyers. KanoonAI reads them for everyone else.

Upload a rent agreement, an offer letter, a loan sanction letter or a court
notice, ask a question in your own words, and get an answer in plain language,
with the exact clause it came from. It answers against the document you upload
*and* against a corpus of Indian statutes, so it can tell you both what your
paper says and what the law says about it.

Your documents never leave your browser.

---

## Contents

- [How it works](#how-it-works)
- [The RAG pipeline](#the-rag-pipeline)
- [Storage model](#storage-model)
- [Agents](#agents)
- [Guardrails](#guardrails)
- [The corpus](#the-corpus)
- [Parameter tuning](#parameter-tuning)
- [Decision-tree tests](#decision-tree-tests)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Scripts](#scripts)
- [Deploying](#deploying)
- [Project structure](#project-structure)
- [Known limitations](#known-limitations)

---

## How it works

```
                 BROWSER (your device)                        SERVER (stateless)
 ┌──────────────────────────────────────────────┐   ┌────────────────────────────────┐
 │  Upload                                       │   │                                │
 │   PDF / DOCX / photo                          │   │                                │
 │        │                                      │   │                                │
 │        ├─ text layer?  ──yes──► parse locally │   │                                │
 │        └─ no (a scan)  ────────► page image ──┼──►│  /api/vision                   │
 │                                               │   │   gemma4:31b transcribes it    │
 │        ▼                                      │◄──┼─────────────────────────────── │
 │  chunk ─► vectorise ─► IndexedDB              │   │                                │
 │                                               │   │                                │
 │  Ask a question                               │   │                                │
 │        │                                      │   │                                │
 │        ├──────────────────────────────────────┼──►│  /api/agent/prepare            │
 │        │                                      │   │   guardrails → router →        │
 │        │        plan + rewritten queries      │◄──┼─  query rewriter → memory      │
 │        ▼                                      │   │                                │
 │  RETRIEVAL runs here                          │   │                                │
 │   BM25 + dense over IndexedDB                 │   │                                │
 │   (your document + Indian statutes)           │   │                                │
 │        │                                      │   │                                │
 │        │  question + ~6 winning passages      │   │                                │
 │        └──────────────────────────────────────┼──►│  /api/chat                     │
 │                                               │   │   gpt-oss:120b, streamed       │
 │  streamed answer + citations                  │◄──┼─  output guardrails            │
 └──────────────────────────────────────────────┘   └────────────────────────────────┘
                                                             │
                                                             ▼
                                                     Redis (chat list, memory)
```

The important line in that diagram is the one that does **not** exist: no arrow
carries your document to the server. Retrieval happens on your device, and only
the passages that win retrieval are sent to the model.

### Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router), React 19, TypeScript strict |
| Styling | Tailwind CSS v4 |
| Client state | Zustand |
| Validation | Zod |
| Models | Ollama Cloud: `gpt-oss:120b` (answers), `nemotron-3-nano:30b` (agents), `gemma4:31b` (vision) |
| Vector + text store | IndexedDB in the browser |
| Retrieval | BM25F + dense vectors, custom, no vector DB |
| Chat history and memory | Upstash Redis over REST, with an in-memory fallback |
| Document parsing | pdf.js, mammoth, vision model for scans |

---

## The RAG pipeline

```
question
   │
   ├─ input guardrail        deterministic: injection, harm, crisis, PII masking
   ├─ intent router          doc_question │ law_question │ risk_scan │ smalltalk │ out_of_scope
   ├─ query rewriter         "cheque bounce ho gaya" ──► "dishonour of cheque s.138 NI Act"
   │
   ├─ RETRIEVE  (in the browser)
   │     ├─ BM25F      lexical, section headings weighted 8x
   │     ├─ dense      cosine over int8 vectors
   │     ├─ fuse       best-score across rewrites, then RRF across channels
   │     ├─ MMR        drops near-duplicate clauses
   │     └─ budget     truncate to maxContextChars
   │
   ├─ risk scanner           deterministic clause patterns, runs with or without a model
   ├─ answer                 streamed, grounded, citation-numbered
   └─ output guardrail       strip invented citations, soften over-claims, simplify if too hard to read
```

### Design decisions worth calling out

**Retrieval runs client-side.** The corpus ships as static shards, the user's
document is chunked in the browser, and both are searched from IndexedDB. This
is what makes the hosting story trivial: the server holds no state, needs no
blob storage, and cannot leak a document it never received.

**BM25 does the heavy lifting, not embeddings.** Legal text is full of terms of
art that must match exactly ("retrenchment", "s.138", "lock-in period"). Tuning
selected `lexicalWeight: 1.0` on the gold set, which is to say the dense channel
did not earn its place there. The channel is fully implemented and switches on
the moment a real embedding model is configured; the tuned value is a measured
result, not a shortcut.

**Section headings are a separate field.** Every chunk carries the section's
marginal note ("Documents of which registration is compulsory"), including
continuation chunks that start mid-sentence, and the lexical index weights it.
This is a lightweight BM25F and it was the single largest quality jump after
query rewriting.

**Rewrites are fused by best score, not by RRF.** The rewritten queries are
paraphrases of one question, not independent retrievers. Summing reciprocal
ranks lets four mediocre agreements outvote one exact hit, which measurably
dropped correct sections out of the top-k. See
[eval/report.md](eval/report.md).

---

## Storage model

Everything the user owns lives in IndexedDB under the `kanoonai` database:

| Store | Contents |
|---|---|
| `docs` | metadata for each uploaded document |
| `chunks` | the chunked text and its int8 vectors |
| `corpus` | the cached statute shards, downloaded once |
| `chats` | local mirror of conversations |
| `meta` | corpus version, so a rebuilt corpus refreshes itself |

Redis stores only the recent-chat list, message history for the sidebar, and a
short list of durable non-identifying facts ("is a tenant in Pune"). Both are
namespaced per username and expire after 30 days. If Redis is not configured the
app falls back to an in-process map and nothing in the UI breaks.

The sidebar shows live storage usage, and there is a one-click wipe in Settings.

---

## Agents

Small, single-purpose, and individually optional: if any one of them fails or
returns malformed output, it falls back to a sane default and the pipeline
continues.

| Agent | Model | Job |
|---|---|---|
| Router | fast | Classify intent; decide whether retrieval is needed at all |
| Query rewriter | fast | Bridge everyday words to statutory vocabulary, in any language |
| Re-ranker | fast | Reorder candidates by direct relevance (off by default, see tuning) |
| Grader | fast | Drop passages that are clearly about something else |
| Answerer | main | Write the grounded, plain-language answer |
| Memory | fast | Extract durable, non-identifying facts across chats |
| Vision | vision | Transcribe scanned pages and photos |

The **risk scanner** is deliberately not an agent. It is a deterministic pattern
matcher over clause text, so it runs in milliseconds, works with no API key, and
cannot invent a clause that is not in the document.

---

## Guardrails

Input guardrails are regex-based and run *before* any model call, because a
guardrail that itself needs an LLM fails open exactly when the provider is down.

- **Prompt injection** blocked, with care taken not to trip on legitimate
  questions that happen to contain words like "ignore".
- **Unlawful requests** refused ("how do I forge a signature"), while the
  informational version stays allowed ("what is the punishment for forgery").
- **Crisis language** routed to real Indian helplines instead of to retrieval.
- **PII masked** before anything is sent onward or written to Redis: Aadhaar,
  PAN, phone, email, account numbers. Rupee amounts are deliberately preserved.

Output guardrails run over the completed answer:

- Citations pointing at sources that were never supplied are **stripped**, which
  catches the most damaging hallucination without another model call.
- Guarantees are softened ("you will definitely win" becomes "you may have a case").
- The answer is scored for readability, and if it is too dense or contains
  unexplained jargon it is rewritten simpler, then re-scored. The rewrite is
  only accepted if it genuinely reads easier.
- Em dashes and en dashes are converted to ordinary punctuation.

---

## The corpus

40 Indian Acts, section-wise, chosen for the situations ordinary people are
actually in: rent and property, wages and employment, consumer complaints,
cheque bounce, motor accidents, domestic violence, workplace harassment, RTI,
free legal aid, marriage and divorce, wills and succession, disability rights,
online fraud.

Source: **India Code** (Government of India), via the section-wise dataset at
[`V0RTEXX99/indian-legal-acts-dataset`](https://github.com/V0RTEXX99/indian-legal-acts-dataset).

```
40 acts  ·  3.1M characters  ·  5,083 chunks  ·  6 shards  ·  4.4 MB
```

The upstream extraction has two systematic faults that
[`scripts/fetch-corpus.mjs`](scripts/fetch-corpus.mjs) repairs, because both
produce wrong citations:

1. **Merged sections.** Consecutive sections are sometimes recorded as one, so
   the second silently disappears. In the Indian Contract Act this is what made
   s.73 (compensation for breach, one of the most-cited provisions in the Act)
   unreachable: its text was sitting inside the record labelled s.72. The
   splitter recovers it and takes that Act from 120 to 182 sections.
2. **Footnotes recorded as sections.** These would make the app cite "s.1" for a
   line of marginalia, so the section number is stripped from them. The passage
   stays searchable; it just cannot be cited with a number it does not own.

Malformed section headings fall from 9.1% to 4.9% of the corpus after repair.

---

## Parameter tuning

`npm run eval:sweep` starts from deliberately untuned defaults and walks one
parameter at a time (coordinate ascent, multiple passes) against a fixed batch
of 24 gold queries in [`eval/goldset.json`](eval/goldset.json). A change is kept
only if it improves the objective by a real margin.

The gold queries are written the way people actually type, including Hinglish
and shaky grammar: *"cheque bounce ho gaya hai mera paisa kaise milega"*,
*"boss not paying my salary since 3 months kya karu"*. A retrieved chunk counts
as relevant only if it is the right Act **and** the right section, so the score
cannot be gamed by returning the right Act's table of contents.

### Objective

```
0.6 * hit@topK  +  0.4 * MRR  -  0.08 * (avgContextChars / 24000)
```

Recall on its own is bought by raising `topK`. The context penalty makes that a
real trade-off, which is what it is in production: a bigger context costs
latency, money, and the model's attention.

### Result

| | baseline | tuned |
|---|---|---|
| hit@topK | 0.083 | **0.750** |
| MRR | 0.014 | **0.488** |
| nDCG | 0.030 | **0.758** |
| context per query | 7,610 chars | **3,362 chars** |
| retrieval latency | 15 ms | **15 ms** |

The full run, every parameter's table, and the per-query outcome are written to
[`eval/report.md`](eval/report.md), and the winning values to
[`src/lib/rag/tuned.ts`](src/lib/rag/tuned.ts).

### What the sweep found

- **Query rewriting matters most.** `multiQuery: 0 → 3` roughly tripled the
  objective on its own. The users this is built for do not know the statutory
  word for their problem, so bridging vocabulary is the whole game.
- **Smaller chunks win.** `1800 → 600` characters. A statutory section is a
  natural retrieval unit and cutting across several dilutes every one of them.
- **Heading weighting is worth 8x.** Statutory marginal notes state the topic
  far more directly than the operative text.
- **The re-ranker was rejected.** It cost about 400x the retrieval latency for a
  gain below the noise floor on this batch, so it is off by default. The code is
  there and one toggle switches it on.
- **Neighbour expansion was rejected on cost.** It bought 8 points of hit rate
  for 3.7x the context. Under the stated objective that is not a good trade.

Every parameter is exposed in the Settings drawer, so the trade-offs can be felt
directly rather than taken on trust.

---

## Decision-tree tests

`npm run eval:tree` walks every branch a real session can take and asserts what
should happen at each leaf. Not just the happy path: empty input, a 5,000
character paste, prompt injection, unlawful requests, crisis language, PII, a
corrupt PDF, a password-protected PDF, a scan with no text layer, an empty
document, a 400k character document, a query that matches nothing, an embedding
provider that dies mid-request, a re-ranker that throws, an exceeded context
budget, hallucinated citations, malformed model JSON, a missing username, a
malformed request body, an oversized upload.

```
$ npm run eval:tree
44 passed, 0 failed

$ npm run eval:tree -- --http     # adds the live HTTP branch
```

It exits non-zero on failure, so it works as a CI gate.

---

## Getting started

```bash
git clone https://github.com/varadarajjborkar/KanoonAI.git
cd KanoonAI
npm install

cp .env.example .env.local        # add your Ollama Cloud key
npm run corpus:fetch              # download and repair the Indian law corpus
npm run corpus:build              # chunk and shard it for the browser

npm run dev                       # http://localhost:3000
```

Sign in with any username. There is no password by design: the username is a
namespace for chat history, not a security boundary, and every document stays on
the device.

The corpus steps are one-time. `public/corpus/` is all the app needs at runtime.

---

## Configuration

All optional except the API key.

| Variable | Default | Notes |
|---|---|---|
| `OLLAMA_API_KEY` | — | Required. From <https://ollama.com/settings/keys> |
| `OLLAMA_BASE_URL` | `https://ollama.com` | |
| `OLLAMA_CHAT_MODEL` | `gpt-oss:120b` | Writes the answers |
| `OLLAMA_FAST_MODEL` | `nemotron-3-nano:30b` | Router, rewriter, grader, re-ranker |
| `OLLAMA_VISION_MODEL` | `gemma4:31b` | Reads scans and photos |
| `OLLAMA_EMBED_MODEL` | *(blank)* | Blank uses the built-in local encoder |
| `UPSTASH_REDIS_REST_URL` | *(blank)* | Blank falls back to in-memory history |
| `UPSTASH_REDIS_REST_TOKEN` | *(blank)* | |
| `NEXT_PUBLIC_MAX_DOC_CHARS` | `400000` | Per-document indexing cap |

**On choosing the fast model:** it must not emit hidden reasoning. On reasoning
models the thinking tokens are charged against the generation budget, so a
structured call returns HTTP 200 with an empty body and the JSON never gets
written. `gpt-oss:20b` took ~25s and failed most structured calls this way;
`nemotron-3-nano:30b` does the same work in ~1.4s. The client detects the
condition, retries once with a larger budget, and then fails loudly rather than
handing an empty string to a parser.

**On embeddings:** Ollama Cloud currently exposes no embedding endpoint, so the
app ships a deterministic hashed TF-IDF encoder that runs locally with no
network. Set `OLLAMA_EMBED_MODEL` against any endpoint that has one and the
remote encoder takes over. The corpus manifest records which encoder built it,
and the client refuses to mix the two, since cosine similarity across different
encoders is meaningless.

---

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `start` | Production build and serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run corpus:fetch` | Download and repair the statute corpus |
| `npm run corpus:build` | Chunk and shard it (`--embed` to bake in vectors) |
| `npm run eval:sweep` | Tune retrieval parameters against the gold set |
| `npm run eval:tree` | Run the decision-tree tests |

The scripts import the app's own TypeScript modules directly, using Node's
native type stripping, so the tuner and the product can never drift apart.

---

## Deploying

Vercel, with no other infrastructure:

1. Push the repo and import it.
2. Add `OLLAMA_API_KEY` (and the Upstash pair if you want cross-device history).
3. Deploy.

`public/corpus/` is served from the CDN, so serverless functions never touch it.
Nothing else is persisted server-side, so there is no database to provision and
no per-user storage to outgrow. `/api/vision` receives one page image at a time
rather than a whole document, which keeps every request inside the serverless
body limit and function timeout.

---

## Project structure

```
src/
  app/
    api/
      agent/prepare     guardrails + router + rewriter + memory, one round trip
      agent/rerank      LLM re-ranking of a shortlist
      chat              streamed answer (SSE) + output guardrails
      chats             recent-chat CRUD
      embed             embedding proxy, keeps the key server-side
      memory            durable user facts
      vision            page-image transcription
      health            what is actually configured and reachable
    page.tsx            app shell
  components/           sidebar, chat view, composer, citations, risks, settings
  lib/
    agents/             the agents and every prompt
    rag/
      chunk.ts          structure-aware chunking
      bm25.ts           BM25F with heading field
      embed.ts          hashing + remote encoders, int8 quantisation
      fuse.ts           RRF, best-score fusion, MMR
      retrieve.ts       the pipeline
      params.ts         every knob and its search grid
      tuned.ts          generated by the sweep
    client/
      idb.ts            IndexedDB
      corpus.ts         shard download and caching
      extract.ts        PDF / DOCX / image extraction with vision fallback
      pipeline.ts       client-side retrieval and streaming
      store.ts          Zustand store
    guardrails.ts       input and output guardrails
    risk.ts             deterministic clause risk scanner
    readability.ts      Flesch scoring and jargon detection
scripts/
  fetch-corpus.mjs      download + repair
  build-index.mjs       chunk + shard
  eval/
    goldset.json → eval/, lib.mjs, sweep.mjs, rerank.mjs, decision-tree.mjs
```

---

## Known limitations

- **Retrieval is at 75% on the gold set**, measured strictly. Six queries still
  miss, and the cause is documented rather than papered over: at
  `headingWeight: 8` a coincidental heading match can beat the correct section
  ("unauthorized use of goods bailed" wins on an online-fraud query). The sweep
  still selects 8 because it wins on balance. Proper per-field BM25F length
  normalisation is the fix, rather than repeating heading tokens.
- **The corpus is 40 Acts, not all of Indian law.** Questions outside it fall
  back to a grounded "I could not find this" rather than a guess. State
  amendments, rules, and case law are not included.
- **RTI s.7 is absent upstream**, so questions about the 30-day reply deadline
  land on s.6 instead. A handful of Acts have residual numbering drift that the
  repair pass does not catch.
- **Vision transcription is not proofread.** Pages read by the vision model are
  marked as such in the sidebar and flagged in chat.
- **The local encoder is lexical, not semantic.** It adds diversity signal for
  MMR but will not bridge a genuine synonym gap. Query rewriting does that job.
- **Answers are informational, not advice**, and the app says so wherever it
  matters.
