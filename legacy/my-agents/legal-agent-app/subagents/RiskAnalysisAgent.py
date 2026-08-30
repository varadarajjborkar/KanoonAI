from google.adk.agents.llm_agent import Agent
import re
import ahocorasick
from typing import List, Dict

KEYWORDS = [
    "terminate without", "retain the entire", "forfeit", "without notice", 
    "automatic", "penalty", "liable for", "indemnify", "waive", "no refund",
    "irrecoverable", "unlimited liability", "in perpetuity", "sole discretion", 
    "burden", "assign without", "sublet without consent", "termination for convenience", 
    "termination for cause", "breach of contract", "failure to perform", "material breach", 
    "non-performance", "default", "failure to deliver", "failure to pay", "failure to cure", 
    "change of control", "insolvency", "force majeure", "liquidated damages", "arbitration clause", 
    "exclusive jurisdiction", "exclusive venue", "dispute resolution", "mediation", "waiver of rights", 
    "entire agreement", "severability", "survival of terms", "no liability", "hold harmless", 
    "indemnification", "third party beneficiary", "non-compete", "non-solicitation", "confidentiality", 
    "non-disclosure", "intellectual property rights", "ownership of work product", "assignment of rights", 
    "substitution of services", "audit rights", "compliance with laws", "governing law", "choice of law", 
    "no set-off", "no offset", "no deduction", "no appeal", "final decision", "binding arbitration", 
    "final and binding", "discretionary", "discretion of party", "unilateral termination", 
    "unilateral modification", "unilateral amendment", "unilateral assignment", "unilateral waiver", 
    "unilateral suspension", "unilateral revocation", "unilateral rescission", "unilateral cancellation", 
    "unilateral rejection", "unilateral refusal", "unilateral discretion", "unilateral decision", 
    "unilateral determination", "unilateral action", "unilateral exercise", "unilateral implementation", 
    "unilateral enforcement", "unilateral execution", "unilateral performance", "unilateral obligation", 
    "unilateral duty", "unilateral responsibility", "unilateral liability", "unilateral accountability", 
    "unilateral indemnity", "unilateral release", "unilateral discharge", "unilateral exoneration", 
    "unilateral exculpation", "unilateral defense", "unilateral attorney's fees", "unilateral costs", 
    "unilateral expenses", "unilateral damages", "unilateral penalties", "unilateral fines", "unilateral charges", 
    "unilateral fees", "unilateral payments", "unilateral settlement", "unilateral compensation", 
    "unilateral remuneration", "unilateral reimbursement", "unilateral refund", "unilateral credit", 
    "unilateral adjustment", "unilateral reduction", "unilateral increase", "unilateral modification", 
    "unilateral alteration", "unilateral change", "unilateral amendment", "unilateral revision", 
    "unilateral correction", "unilateral update", "unilateral upgrade", "unilateral downgrade", 
    "unilateral reversion", "unilateral reinstatement", "unilateral restoration", "unilateral renewal", 
    "unilateral extension", "unilateral termination", "unilateral cancellation", "unilateral revocation", 
    "unilateral rescission", "unilateral suspension", "unilateral discontinuation", "unilateral discharge", 
    "unilateral release", "unilateral exoneration", "unilateral exculpation", "unilateral hold harmless", 
    "unilateral defense", "unilateral attorney's fees", "unilateral costs", "unilateral expenses", 
    "unilateral damages", "unilateral penalties", "unilateral fines", "unilateral charges", "unilateral fees", 
    "unilateral payments", "unilateral settlement", "unilateral compensation", "unilateral remuneration", 
    "unilateral reimbursement", "unilateral refund", "unilateral credit", "unilateral adjustment", 
    "unilateral reduction", "unilateral increase", "unilateral modification", "unilateral alteration", 
    "unilateral change", "unilateral amendment", "unilateral revision", "unilateral correction", "unilateral update", 
    "unilateral upgrade", "unilateral downgrade", "unilateral reversion", "unilateral reinstatement", 
    "unilateral restoration", "unilateral renewal", "unilateral extension"
]

A = ahocorasick.Automaton()
for idx, kw in enumerate(KEYWORDS):
    A.add_word(kw.lower(), (idx, kw))
A.make_automaton()

RE_FORFEIT = re.compile(r"\b(retain|forfeit|confiscate)\b", re.I)
RE_AMOUNT = re.compile(r"\b(\$|rs\.|inr)\s*\d{3,}", re.I)

_risk_cache: Dict[str, List[Dict]] = {}

def find_risky_clauses(text: str) -> List[Dict]:
    if not text:
        return []

    if text in _risk_cache:
        return _risk_cache[text]

    parts = re.split(r"\n+|(?<=[\.\?\!])\s+", text)
    findings = []

    for pt in map(str.strip, parts):
        if not pt:
            continue

        matched_reasons = []
        score = 0

        for _, (_, kw) in A.iter(pt.lower()):
            matched_reasons.append(kw)
            score += 2

        if RE_FORFEIT.search(pt):
            matched_reasons.append("forfeit/retain language")
            score += 2
        if RE_AMOUNT.search(pt):
            matched_reasons.append("large monetary amount")
            score += 1

        if score > 0:
            severity = "low"
            if score >= 4:
                severity = "high"
            elif score >= 2:
                severity = "medium"

            findings.append({
                "clause": pt,
                "reasons": list(set(matched_reasons)),
                "severity": severity
            })

    # caching
    _risk_cache[text] = findings
    return findings

risk_agent = Agent(
    model="gemini-2.5-flash",
    name="RiskAnalysisAgent",
    description="Detects risky or one-sided clauses in legal text.",
    instruction="You can call run_risk_analysis(text) externally and pass summaries here."
)
