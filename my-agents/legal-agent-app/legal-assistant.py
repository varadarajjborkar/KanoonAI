from mcp_toolbox import MCPClient

class LegalAssistantAgent:
    def __init__(self):
        self.client = MCPClient(toolset="legal-assistant")

    def run(self, file_path):
        extracted = self.client.call_tool("extract-text", {"file": file_path})
        text = extracted["output"]

        simplified = self.client.call_tool("simplify-legal-jargon", {"text": text})

        risks = self.client.call_tool("highlight-risks", {"text": text})

        print("\n=== SIMPLIFIED SUMMARY ===\n")
        print(simplified["output"])
        print("\n=== POTENTIAL RISKS ===\n")
        print(risks["output"])

if __name__ == "__main__":
    import sys
    agent = LegalAssistantAgent()
    agent.run(sys.argv[1])
