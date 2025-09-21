from pathlib import Path

# import master agent
from legal_agent_app.agent import root_agent

# Example file
file_path = Path.cwd() / "sample_files" / "sample_extract.pdf"

# Run the workflow via the master agent
result = root_agent.run(file_path=str(file_path))

# Print structured output
print("\n=== SIMPLIFIED SUMMARY ===\n")
print(result.get("simplified_summary", ""))

print("\n=== POTENTIAL RISKS ===\n")
print(result.get("risks", ""))

print("\n=== REASONED VERDICT ===\n")
print(result.get("reasoned_verdict", ""))

print("\n=== REFERENCE MATCHES ===\n")
for r in result.get("reference_matches", []):
    print(f"- {r['source']}: {r['snippet'][:200]}...")
