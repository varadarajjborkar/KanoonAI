import type { RiskFinding } from './types.ts';

/**
 * Clause-level risk scanner.
 *
 * A port of the pattern scanner from the original Python prototype, trimmed to
 * the patterns that actually fire on Indian rent agreements, loan sanction
 * letters, employment offers and service contracts. It runs locally in a few
 * milliseconds, so every uploaded document gets scanned even before the user
 * asks anything - which is the moment a first-time reader most needs the flag.
 */

interface Rule {
  re: RegExp;
  weight: number;
  label: string;
  plain: string;
}

const RULES: Rule[] = [
  {
    re: /\b(?:forfeit|forfeited|retain\s+the\s+entire|confiscate)\b/i,
    weight: 3,
    label: 'money can be kept',
    plain: 'The other side can keep your money in some situations. Check exactly when.',
  },
  {
    re: /\bwithout\s+(?:any\s+)?(?:prior\s+)?notice\b/i,
    weight: 3,
    label: 'no warning needed',
    plain: 'They can act without telling you first. You may not get a chance to fix the problem.',
  },
  {
    re: /\b(?:sole|absolute)\s+discretion\b/i,
    weight: 3,
    label: 'one-sided decision power',
    plain: 'They decide on their own, and you have little say in it.',
  },
  {
    re: /\b(?:indemnify|indemnification|hold\s+harmless)\b/i,
    weight: 3,
    label: 'you pay for their losses',
    plain: 'If someone sues them because of you, you may have to pay their costs.',
  },
  {
    re: /\bunlimited\s+liability\b|\bliable\s+for\s+all\b/i,
    weight: 4,
    label: 'no cap on what you owe',
    plain: 'There is no upper limit on what you could have to pay.',
  },
  {
    re: /\b(?:waive|waiver)\b[^.]{0,40}\b(?:right|claim|notice)\b/i,
    weight: 3,
    label: 'you give up a right',
    plain: 'You are signing away a right you would otherwise have.',
  },
  {
    re: /\bno\s+refund(?:s|able)?\b|\bnon-?refundable\b/i,
    weight: 2,
    label: 'money is not coming back',
    plain: 'If things end early, you do not get this money back.',
  },
  {
    re: /\bliquidated\s+damages\b|\bpenalt(?:y|ies)\b/i,
    weight: 2,
    label: 'fixed penalty',
    plain: 'A set amount you must pay if you break this term.',
  },
  {
    re: /\bin\s+perpetuity\b|\bnever\s+expires?\b/i,
    weight: 3,
    label: 'lasts forever',
    plain: 'This obligation has no end date.',
  },
  {
    re: /\bnon-?compete\b|\bnon-?solicit(?:ation)?\b/i,
    weight: 2,
    label: 'limits your next job',
    plain: 'This can restrict where you work or who you work with after you leave.',
  },
  {
    re: /\b(?:exclusive\s+jurisdiction|courts?\s+(?:at|of|in)\s+[A-Z][a-z]+\s+(?:alone|only))/,
    weight: 2,
    label: 'you must go to their city to fight',
    plain: 'Any dispute has to be filed in a particular city, which may be far from you.',
  },
  {
    re: /\bbinding\s+arbitration\b|\bfinal\s+and\s+binding\b/i,
    weight: 2,
    label: 'no court, no appeal',
    plain: 'Disputes go to a private arbitrator instead of a court, and you usually cannot appeal.',
  },
  {
    re: /\bautomatic(?:ally)?\s+renew(?:al|ed|s)?\b/i,
    weight: 2,
    label: 'renews by itself',
    plain: 'It continues on its own unless you cancel in time.',
  },
  {
    re: /\bterminate\b[^.]{0,50}\bfor\s+convenience\b/i,
    weight: 3,
    label: 'they can walk away anytime',
    plain: 'They can end this whenever they like, without needing a reason.',
  },
  {
    re: /\b(?:sub-?let|assign)\b[^.]{0,40}\bwithout\b[^.]{0,20}\bconsent\b/i,
    weight: 2,
    label: 'transfer restrictions',
    plain: 'Passing this on to someone else needs permission, or is blocked outright.',
  },
  {
    re: /\binterest\s+@?\s*\d{2,}\s*%/i,
    weight: 3,
    label: 'high interest rate',
    plain: 'The interest rate here is high. Work out what it costs you over a full year.',
  },
  {
    re: /\block-?in\s+period\b/i,
    weight: 2,
    label: 'you are locked in',
    plain: 'You cannot leave before a fixed time without losing something.',
  },
  {
    re: /\bsecurity\s+deposit\b[^.]{0,80}\b(?:months?|times)\b/i,
    weight: 1,
    label: 'large deposit',
    plain: 'Check how big the deposit is and exactly when you get it back.',
  },
];

const AMOUNT = /(?:₹|rs\.?|inr)\s?[\d,]{4,}/i;

/** Split into clause-sized units: numbered clauses first, then sentences. */
function splitClauses(text: string): string[] {
  return text
    .split(/\n{2,}|(?<=[.;])\s+(?=[A-Z(])|(?=\n\s*\d+(?:\.\d+)*\s)/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 30 && s.length < 1200);
}

export function scanRisks(text: string, limit = 12): RiskFinding[] {
  if (!text?.trim()) return [];
  const findings: RiskFinding[] = [];

  for (const clause of splitClauses(text)) {
    let score = 0;
    const reasons: string[] = [];
    const plains: string[] = [];

    for (const rule of RULES) {
      if (rule.re.test(clause)) {
        score += rule.weight;
        reasons.push(rule.label);
        plains.push(rule.plain);
      }
    }
    if (AMOUNT.test(clause) && score > 0) score += 1;
    if (score === 0) continue;

    findings.push({
      clause: clause.length > 420 ? `${clause.slice(0, 420)}...` : clause,
      severity: score >= 6 ? 'high' : score >= 3 ? 'medium' : 'low',
      reasons: [...new Set(reasons)],
      plain: [...new Set(plains)].join(' '),
    });
  }

  const rank = { high: 0, medium: 1, low: 2 } as const;
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, limit);
}
