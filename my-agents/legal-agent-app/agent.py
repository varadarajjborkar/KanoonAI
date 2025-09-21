from google.adk.agents import Agent
from .subagents.ExtractTextAgent import extract_text_agent
from .subagents.SimplifyJargonAgent import simplify_agent
from .subagents.RiskAnalysisAgent import risk_agent, find_risky_clauses
from .subagents.ReferenceCheckAgent import reference_agent, reference_check
from .subagents.ReasonAgent import reason_agent, reason_over_risks

root_agent = Agent(
    model="gemini-2.5-flash",
    name="LegalMasterAgent",
    description="Master agent that orchestrates subagents for legal document analysis.",
    instruction=(
        "Workflow:\n"
        "1. Use ExtractTextAgent to read the file.\n"
        "2. Simplify text with SimplifyJargonAgent.\n"
        "3. Run RiskAnalysisAgent on the text.\n"
        "4. If risks found, send them to ReasonAgent for 2–3 iterations of refinement.\n"
        "5. Run ReferenceCheckAgent for context from stored legal-docs.\n"
        "6. Return a structured report: Simplified Summary, Risks, Reasoned Verdict, Reference Matches."
    ),
    subagents=[extract_text_agent, simplify_agent, risk_agent, reference_agent, reason_agent]
)
