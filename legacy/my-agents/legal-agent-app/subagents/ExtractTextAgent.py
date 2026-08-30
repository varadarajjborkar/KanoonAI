from google.adk.agents.llm_agent import Agent
from ..tools.extract_text_tool import extract_text

extract_text_agent = Agent(
    model="gemini-2.5-flash",
    name="ExtractTextAgent",
    description="Extracts text from uploaded PDF or DOCX and caches it.",
    instruction="Call extract_text(file_path) to get plain text."
)

def run_extract(file_path: str, force_refresh: bool = False) -> str:
    return extract_text(file_path, force_refresh=force_refresh)
