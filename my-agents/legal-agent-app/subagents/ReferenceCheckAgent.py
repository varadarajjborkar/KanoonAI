from google.adk.agents.llm_agent import Agent
import os
import pickle
from langchain.vectorstores import FAISS
from langchain.embeddings import VertexAIEmbeddings
from langchain.docstore.document import Document
from ..tools.extract_text_tool import extract_text

INDEX_PATH = "reference_index/faiss_store.pkl"

def build_reference_index(reference_dir: str = "legal-docs"):
    docs = []
    for root, _, files in os.walk(reference_dir):
        for f in files:
            if f.endswith((".pdf", ".docx")):
                path = os.path.join(root, f)
                text = extract_text(path)
                if text.strip():
                    docs.append(Document(page_content=text, metadata={"source": path}))
    embeddings = VertexAIEmbeddings()
    return FAISS.from_documents(docs, embeddings)

def load_or_create_index():
    os.makedirs("reference_index", exist_ok=True)
    if os.path.exists(INDEX_PATH):
        with open(INDEX_PATH, "rb") as f:
            return pickle.load(f)
    else:
        idx = build_reference_index()
        with open(INDEX_PATH, "wb") as f:
            pickle.dump(idx, f)
        return idx

reference_index = load_or_create_index()

def reference_check(text: str, k: int = 3):
    results = reference_index.similarity_search(text, k=k)
    return [
        {"source": r.metadata["source"], "snippet": r.page_content[:400]}
        for r in results
    ]

reference_agent = Agent(
    model="gemini-2.5-flash",
    name="ReferenceCheckAgent",
    description="Compares document text against reference legal-docs.",
    instruction="Return most similar clauses from the reference library for comparison.",
    functions={"reference_check": reference_check}
)
