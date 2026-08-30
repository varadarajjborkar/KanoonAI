import os
from pathlib import Path
from difflib import SequenceMatcher
from typing import List, Dict

BASE_DIR = Path(__file__).resolve().parents[0].joinpath("..", "processed_docs").resolve()
if not BASE_DIR.exists():
    BASE_DIR = Path(__file__).resolve().parents[1].joinpath("..", "processed_docs").resolve()

def _load_all_cached_texts() -> List[Dict]:
    docs = []
    p = BASE_DIR
    for f in p.iterdir():
        if f.is_file() and f.suffix == ".txt":
            try:
                text = f.read_text(encoding="utf-8")
            except Exception:
                text = ""
            docs.append({"source": str(f), "text": text})
    return docs

_REFERENCE_CACHE = None

def build_reference_cache(force_refresh: bool = False):
    global _REFERENCE_CACHE
    if _REFERENCE_CACHE is None or force_refresh:
        _REFERENCE_CACHE = _load_all_cached_texts()
    return _REFERENCE_CACHE

def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a[:2000], b[:2000]).ratio()

def reference_check_snippets(text: str, top_k: int = 3) -> List[Dict]:
    build_reference_cache()
    scores = []
    for doc in _REFERENCE_CACHE:
        sim = _similarity(text, doc["text"])
        if sim > 0:
            snippet = doc["text"][:600].replace("\n", " ").strip()
            scores.append({"source": doc["source"], "score": sim, "snippet": snippet})
    # descending
    scores.sort(key=lambda x: x["score"], reverse=True)
    return scores[:top_k]
