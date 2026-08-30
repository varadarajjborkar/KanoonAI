/**
 * Deterministic guardrails.
 *
 * These run before (and after) any model call. They are regex-based on purpose:
 * a guardrail that itself needs an LLM can fail open when the provider is down,
 * which is exactly when you least want it to. The LLM-based scope/intent check
 * in agents/router.ts sits on top of this layer, not underneath it.
 */

export type BlockCategory =
  | 'empty'
  | 'too_long'
  | 'prompt_injection'
  | 'unauthorised_practice'
  | 'harmful_legal'
  | 'crisis'
  | 'ok';

export interface InputVerdict {
  ok: boolean;
  category: BlockCategory;
  message?: string;
  /** Query with personal identifiers masked, safe to send onward. */
  sanitised: string;
  redactions: string[];
  notices: string[];
}

const MAX_QUERY_CHARS = 4000;

const INJECTION = [
  /ignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above)\s+instructions?/i,
  /disregard\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions?|rules?)/i,
  /(?:reveal|print|show|repeat)\s+(?:your|the)\s+(?:system\s+)?prompt/i,
  /you\s+are\s+now\s+(?:a|an|in)\s+(?:developer|dan|jailbreak|god)\s*mode/i,
  /pretend\s+(?:you\s+)?(?:are|to\s+be)\s+(?:not\s+)?(?:an?\s+)?(?:ai|assistant|lawyer)\b.*\b(?:no\s+rules|without\s+restrictions)/i,
  /\bsystem\s*:\s*you\s+must\b/i,
];

/** Things a legal-explainer must not help with, however it is phrased. */
const HARMFUL = [
  /\b(?:forge|fabricate|falsify|backdate)\b[^.?!]{0,40}\b(?:signature|document|affidavit|stamp|evidence|receipt|will)\b/i,
  /\bhow\s+(?:do\s+i|to)\b[^.?!]{0,40}\b(?:bribe|pay\s+off)\b[^.?!]{0,30}\b(?:judge|officer|official|police|clerk)\b/i,
  /\b(?:destroy|shred|delete|hide)\b[^.?!]{0,30}\b(?:evidence|records?)\b[^.?!]{0,30}\b(?:before|from)\b[^.?!]{0,30}\b(?:court|police|audit|investigat)/i,
  /\b(?:launder|laundering)\b[^.?!]{0,25}\bmoney\b/i,
  /\bhelp\s+me\b[^.?!]{0,30}\b(?:evade|dodge)\b[^.?!]{0,20}\b(?:tax|taxes|summons|arrest)\b/i,
  /\b(?:threaten|intimidate)\b[^.?!]{0,30}\b(?:witness|tenant|complainant)\b/i,
];

/** Distress signals get a human-support response, never a retrieval answer. */
const CRISIS = [
  /\b(?:kill|hurt|harm)\s+my\s*self\b/i,
  /\bsuicid(?:e|al)\b/i,
  /\bend\s+my\s+life\b/i,
  /\bi\s+(?:want|am\s+going)\s+to\s+die\b/i,
];

/**
 * Indian PII. We mask before the text reaches the model or Redis, because a
 * rent agreement or an FIR copy is full of exactly this.
 */
const PII: Array<[string, RegExp, (m: string) => string]> = [
  ['Aadhaar', /\b\d{4}\s?\d{4}\s?\d{4}\b/g, () => '[AADHAAR]'],
  ['PAN', /\b[A-Z]{5}\d{4}[A-Z]\b/g, () => '[PAN]'],
  ['phone', /\b(?:\+91[- ]?)?[6-9]\d{9}\b/g, () => '[PHONE]'],
  ['email', /\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/g, () => '[EMAIL]'],
  ['account', /\b\d{11,18}\b/g, () => '[ACCOUNT]'],
];

export function redactPII(text: string): { text: string; found: string[] } {
  const found: string[] = [];
  let out = text;
  for (const [label, re, repl] of PII) {
    if (re.test(out)) {
      found.push(label);
      out = out.replace(new RegExp(re.source, re.flags), repl as unknown as string);
    }
    re.lastIndex = 0;
  }
  return { text: out, found: [...new Set(found)] };
}

export function checkInput(raw: string): InputVerdict {
  const query = (raw ?? '').trim();
  const base = { sanitised: query, redactions: [] as string[], notices: [] as string[] };

  if (!query) {
    return {
      ...base,
      ok: false,
      category: 'empty',
      message: 'Type a question, or upload a document and ask me what it means.',
    };
  }
  if (query.length > MAX_QUERY_CHARS) {
    return {
      ...base,
      ok: false,
      category: 'too_long',
      message:
        `That message is very long (${query.length} characters). ` +
        'Please upload it as a document instead - then ask me a short question about it.',
    };
  }
  if (CRISIS.some((r) => r.test(query))) {
    return {
      ...base,
      ok: false,
      category: 'crisis',
      message:
        'It sounds like you are going through something very hard, and that matters more than the paperwork right now. ' +
        'Please talk to someone who can help: in India you can call **Tele-MANAS on 14416** (free, 24x7) or **AASRA on 9820466726**. ' +
        'I will still be here for the legal document whenever you want to come back to it.',
    };
  }
  if (INJECTION.some((r) => r.test(query))) {
    return {
      ...base,
      ok: false,
      category: 'prompt_injection',
      message:
        'I can only work as a legal-document explainer, so I cannot change my instructions. ' +
        'Ask me about a document or an Indian law and I will explain it in plain language.',
    };
  }
  if (HARMFUL.some((r) => r.test(query))) {
    return {
      ...base,
      ok: false,
      category: 'harmful_legal',
      message:
        'I cannot help with that, because it involves breaking the law rather than understanding it. ' +
        'If you tell me the situation you are actually in, I can explain what the law says about it and what your lawful options are.',
    };
  }

  const { text, found } = redactPII(query);
  return {
    ok: true,
    category: 'ok',
    sanitised: text,
    redactions: found,
    notices: found.length
      ? [`Personal details (${found.join(', ')}) were masked before processing.`]
      : [],
  };
}

/* --------------------------------------------------------------- output */

export interface OutputVerdict {
  text: string;
  warnings: string[];
  /** Citation numbers the model used that do not exist in the context. */
  invalidCitations: number[];
}

/** Language that would turn an explanation into a promise. */
const OVERCLAIM: Array<[RegExp, string]> = [
  [/\byou\s+will\s+(?:definitely\s+)?win\b/gi, 'you may have a case'],
  [/\byou\s+are\s+guaranteed\b/gi, 'you may be entitled'],
  [/\bthis\s+is\s+100%\s+(?:legal|illegal)\b/gi, 'this appears to be'],
  [/\bi\s+guarantee\b/gi, 'based on the text'],
  [/\byou\s+should\s+sue\b/gi, 'one option is to take legal action'],
];

export function checkOutput(text: string, availableCitations: number): OutputVerdict {
  const warnings: string[] = [];
  // Models reach for em dashes constantly, and they read as a stumble to
  // someone who is not a confident English reader. Convert rather than ask.
  let out = text
    .replace(/\s*\u2014\s*/g, ', ')
    .replace(/(\w)\s*\u2013\s*(\w)/g, '$1 to $2')
    .replace(/\s*\u2013\s*/g, ', ')
    .replace(/,\s*,/g, ',')
    .replace(/,\s*\./g, '.');

  for (const [re, replacement] of OVERCLAIM) {
    if (re.test(out)) {
      warnings.push('softened an over-confident claim');
      out = out.replace(re, replacement);
    }
    re.lastIndex = 0;
  }

  // A citation pointing at a source we never supplied is a hallucination we can
  // catch without another model call, so we strip it rather than show it.
  const used = [...out.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1]));
  const invalid = [...new Set(used.filter((n) => n < 1 || n > availableCitations))];
  if (invalid.length) {
    warnings.push(`removed ${invalid.length} citation(s) that pointed at nothing`);
    out = out.replace(/\[(\d{1,2})\]/g, (m, d) => (invalid.includes(Number(d)) ? '' : m));
  }

  return { text: out.trim(), warnings, invalidCitations: invalid };
}

export const DISCLAIMER =
  'This is general information to help you understand the document, not legal advice. ' +
  'For a decision that affects your money, home, job or freedom, please confirm with a lawyer.';
