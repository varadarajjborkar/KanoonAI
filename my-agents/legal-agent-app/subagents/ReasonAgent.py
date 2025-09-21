from google.adk.agents.llm_agent import Agent
from .RiskAnalysisAgent import find_risky_clauses

def reason_over_risks(text: str, loops: int = 3):
    findings = find_risky_clauses(text)
    if not findings:
        return {"final_verdict": "No significant risks detected.", "iterations": []}

    iterations = []
    refined = findings

    for i in range(loops):
        summary = "\n".join(
            [f"- {f['clause']} (Reasons: {', '.join(f['reasons'])}, Severity: {f['severity']})"
             for f in refined]
        )
        reasoning_prompt = (
            f"Iteration {i+1}: Review the risky clauses below. "
            f"Improve clarity, merge duplicates, and check if severity is fair.\n\n{summary}"
        )
        agent = Agent(
            model="gemini-2.5-flash",
            name=f"ReasoningLoop{i+1}",
            description="Reasoning iteration to refine risky clauses.",
            instruction=reasoning_prompt
        )
        result = agent.run(reasoning_prompt)
        iterations.append({"iteration": i+1, "refined": result})
        refined = [{"clause": "see reasoning output", "reasons": [result], "severity": "refined"}]

    return {"final_verdict": refined, "iterations": iterations}

# ADK Sub-agent
reason_agent = Agent(
    model="gemini-2.5-flash",
    name="ReasonAgent",
    description="Refines risky clause detection by self-looped reasoning.",
    instruction="Takes RiskAnalysisAgent findings and reasons over them multiple times.",
    functions={"reason_over_risks": reason_over_risks}
)
