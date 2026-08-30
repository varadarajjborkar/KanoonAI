# KanoonAI

Legal documents are written for lawyers. KanoonAI reads them for everyone else.

**Live: [kanunai.vercel.app](https://kanunai.vercel.app/)**

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
- [Daily token budget](#daily-token-budget)
- [Security posture](#security-posture)
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
namespaced per username and expire after 30 days.

Redis is a mirror, never the source of truth. The sidebar reads IndexedDB first
and layers the server copy on top, so the app is complete without Redis and
Redis only adds sync across devices. This matters on serverless in particular,
where the in-memory fallback does not survive between invocations.

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

### Measuring it honestly

Query rewriting is a model call, so it is not deterministic, and the whole
pipeline inherits that. Measured across three independent rewrite samples with
identical parameters, hit@topK ranged **0.583 to 0.750**. Tuning against a single
sample therefore fits that sample rather than the pipeline, and any headline
number from one run is partly luck.

So the sweep averages every configuration over three fixed rewrite samples,
committed in [`eval/rewrites/`](eval/rewrites/). That makes a run reproducible,
and it makes a parameter earn its place across samples instead of exploiting the
quirks of one. It also produced a better and steadier result: the tuned
configuration's own spread across samples is 0.042, down from 0.071.

The gold queries are written the way people actually type, including Hinglish
and shaky grammar: *"cheque bounce ho gaya hai mera paisa kaise milega"*,
*"boss not paying my salary since 3 months kya karu"*. A retrieved chunk counts
as relevant only if it is the right Act **and** the right section, so the score
cannot be gamed by returning the right Act's table of contents.

### Objective

```
0.6*hit@topK + 0.4*MRR - 0.08*(contextChars/24000) - 0.02*(ms/1000)
```

Quality minus what it costs to get. Recall on its own is bought by raising
`topK`, and ranking quality is bought with an expensive re-ranker, so both
context and time are priced.

The latency term was not there originally, and its absence showed. The sweep
accepted the LLM re-ranker for a gain that was **entirely ordering**: identical
hit rate, 300x the retrieval time. Since every retrieved passage goes into the
prompt regardless, reordering them barely changes what the model reads. Context
was priced and time was free, so the search spent time freely. With time priced
at roughly "one second is worth three points of hit rate", the same comparison
comes out 0.5952 off versus 0.5862 on, and the re-ranker is correctly rejected:
same answers, 500x faster.

### Result

Averaged over three rewrite samples, 24 gold queries:

| | baseline | tuned | held out |
|---|---|---|---|
| hit@topK | 0.083 | 0.764 | **0.694** |
| MRR | 0.014 | 0.398 | **0.444** |
| nDCG | 0.030 | 0.907 | **0.928** |
| retrieval latency | 14 ms | **4 ms** | 3 ms |

**Read the held-out column.** "Tuned" is measured on the three samples in
[`eval/rewrites/`](eval/rewrites/) that the sweep optimised against, so it is
optimistic by construction. "Held out" re-generates the samples from scratch, so
the parameters have never seen them. The 0.764 to 0.694 gap is what remains of
fitting the tuning samples; averaging over three of them shrank it but did not
remove it, and **0.694 is the number to believe for an unseen run**.

That is still 8.4x the untuned baseline, at 4 ms of retrieval per query.

### What the sweep found

- **Query rewriting matters most.** `multiQuery: 0 → 3` roughly tripled the
  objective on its own. The users this is built for do not know the statutory
  word for their problem, so bridging vocabulary is the whole game.
- **Smaller chunks win.** `1800 → 600` characters. A statutory section is a
  natural retrieval unit and cutting across several dilutes every one of them.
- **Heading weighting is worth 3x.** Statutory marginal notes state the topic
  far more directly than the operative text does.
- **The re-ranker was rejected**, on latency. It reordered results without
  finding any the retriever had missed, so hit rate was identical and only the
  ranking metrics moved, for 500x the retrieval time. Off by default; the code is
  there and one toggle switches it on.
- **Neighbour expansion was rejected on cost.** It bought hit rate for several
  times the context. Under the stated objective that is not a good trade.

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
$ npm test
48 passed, 0 failed

$ npm run test:http               # adds the live HTTP branch
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
| `DAILY_TOKEN_BUDGET` | `100000` | Tokens per username per day |
| `DAILY_DEVICE_TOKEN_BUDGET` | `100000` | Tokens per browser per day |
| `GLOBAL_DAILY_TOKEN_BUDGET` | `2000000` | Tokens for the whole deployment per day |
| `RATE_LIMIT_PER_MIN` | `30` | Requests per user per minute |

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

Running at [kanunai.vercel.app](https://kanunai.vercel.app/) on Vercel, with no
other infrastructure:

1. Push the repo and import it at [vercel.com/new](https://vercel.com/new).
2. Add `OLLAMA_API_KEY`. The model names default to the verified set, so nothing
   else is required.
3. Optionally add Redis, either through Vercel's Upstash integration (which
   injects `KV_REST_API_URL` / `KV_REST_API_TOKEN`) or a database created
   directly on Upstash (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`).
   Both naming schemes are read. Without it the app still works from browser
   storage, but the per-user rate limiter has nothing durable to count in and is
   effectively inert, which matters on a public URL.
4. Deploy.

`/api/health` reports which of these actually took effect, including which Redis
variable naming it found.

`public/corpus/` is served from the CDN, so serverless functions never touch it.
Nothing else is persisted server-side, so there is no database to provision and
no per-user storage to outgrow. `/api/vision` receives one page image at a time
rather than a whole document, which keeps every request inside the serverless
body limit and function timeout.

---

## Daily token budget

The username is a namespace, not a credential, so on a public URL anyone can
spend the deployment's model quota. Every model call is metered using the exact
counts Ollama reports (`prompt_eval_count` + `eval_count`, no estimation) and
charged against three scopes at once. The strictest one wins:

| Scope | Default | Key |
|---|---|---|
| device | 100,000 tokens/day | a random id the browser generates and keeps |
| user | 100,000 tokens/day | the username |
| global | 2,000,000 tokens/day | the whole deployment |

The budget is checked at the start of a turn, so a caller who is out is told
before anything is billed rather than halfway through an answer. Usage is
recorded after the model responds, including when the stream errors or the user
presses stop, because those tokens were still generated. Counters are keyed by
IST calendar day and expire on their own, so everything resets at midnight IST.

The sidebar shows how much of the day is left, and the refusal names the reset
time and reassures the user their documents are still in their browser.

**This needs Redis to mean anything.** Counters live in the same store as chat
history, and on serverless the in-memory fallback does not survive between
invocations, so without Upstash the budget is decorative. `/api/quota` reports
`enforceable: false` when that is the case rather than implying protection that
is not there.

**And it is a speed bump, not a wall.** Device ids and usernames are both
client-supplied, so a determined person can reset either one. The global cap is
the only scope they cannot walk around. Real protection for a public URL is
access control, not metering.

Tune with `DAILY_TOKEN_BUDGET`, `DAILY_DEVICE_TOKEN_BUDGET` and
`GLOBAL_DAILY_TOKEN_BUDGET`.

---

## Security posture

Audited against the live deployment.

**What is enforced**

- Every API route requires an `x-kanoon-user` header and returns 401 without it.
- Guardrails run server-side, not only in the browser, so calling the API
  directly is no way around them.
- No CORS headers on `/api/*`, so only the app's own origin can call it.
- PII is masked before it reaches a model or Redis.
- Request bodies are schema-validated with Zod; malformed input returns 400,
  never 500. Vision uploads over ~6 MB are refused with 413.
- `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
  `Permissions-Policy` and `Cross-Origin-Opener-Policy` are set on every
  response; `/api/*` is `no-store` and `noindex`. HSTS comes from the host.
- The API key stays server-side. Verified by grepping every client bundle on the
  live deployment for the key and for server-only variable names: neither
  appears.
- Model output is rendered through react-markdown without `rehype-raw`, so no
  raw HTML from a model or a document reaches the DOM.

**Known exposures, stated plainly**

- **The username is not authentication.** It is a namespace, by design. Anyone
  with the URL can use the app, and therefore the deployment's model quota. The
  brakes are a 30/min rate limit and the [daily token budget](#daily-token-budget),
  and both need Redis to be durable: without it, serverless instances each start
  with an empty counter and neither is enforced. For a public deployment,
  configure Redis and consider putting the site behind access control.
- **Prompt injection via an uploaded document** is not fully solved. Input
  guardrails cover the user's message; a hostile instruction inside a PDF is
  mitigated by the answer prompt's grounding rules and by stripping citations
  that point at nothing, but it is mitigation, not a guarantee.
- **The vision model transcribes whatever it is shown**, and a transcription
  error is not distinguishable from the document by the pipeline downstream.
  Pages read by vision are labelled as such in the UI for that reason.

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
      quota             today's remaining token budget
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

- **Retrieval is at 69% held out**, measured strictly: right Act *and* right
  section. Three or four queries miss depending on the sample. `deposit-not-returned`
  wants s.108 of the Transfer of Property Act, whose heading ("Rights and
  liabilities of lessor and lessee") never mentions deposits; `retrenchment`
  wants s.25F of the Industrial Disputes Act, which the rewriter reliably
  describes in words the section does not use. Both are vocabulary gaps that
  heading weighting cannot close.
- **The pipeline is not deterministic.** Rewriting is a model call, so the same
  question can retrieve differently on two runs: hit@topK varies by up to 0.125
  across rewrite samples. Every number here is an average over three samples,
  never a best-of.
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
