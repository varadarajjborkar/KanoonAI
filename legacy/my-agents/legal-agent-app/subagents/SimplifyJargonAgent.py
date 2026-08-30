from google.adk.agents.llm_agent import Agent
import re

simplify_agent = Agent(
    model="gemini-2.5-flash",
    name="SimplifyJargonAgent",
    description="Simplifies legal text into plain English for laypeople.",
    instruction="Simplify legal language while keeping legal meaning intact."
)

# Lightweight(prototyping)
REPLACEMENTS = [
    (r"\bhereinafter\b", "from now on"),
    (r"\bheretofore\b", "before now"),
    (r"\bwhereas\b", "because"),
    (r"\bnotwithstanding\b", "despite"),
    (r"\bshall\b", "must"),
    (r"\bthereof\b", "of that"),
    (r"\bparty of the first part\b", "the first party"),
    (r"\bparty of the second part\b", "the second party"),
]

def simplify_text(text: str, max_chars: int = 4000) -> str:
    if not text:
        return ""
    sample = text if len(text) <= max_chars else text[:max_chars]
    s = sample
    for pattern, repl in REPLACEMENTS:
        s = re.sub(pattern, repl, s, flags=re.IGNORECASE)
    s = re.sub(r"\n{2,}", "\n\n", s)
    s = re.sub(r"[ \t]+", " ", s)
    return s.strip()
