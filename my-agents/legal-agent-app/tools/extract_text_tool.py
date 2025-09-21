import os
import docx2txt
import fitz
from pathlib import Path

CACHE_DIR = Path(__file__).resolve().parents[0].joinpath("..", "..", "processed_docs")
CACHE_DIR = CACHE_DIR.resolve()
CACHE_DIR.mkdir(parents=True, exist_ok=True)

def _extract_from_pdf(path: str) -> str:
    text = ""
    with fitz.open(path) as doc:
        for page in doc:
            text += page.get_text()
    return text

def _extract_from_docx(path: str) -> str:
    # docx2txt returns raw text
    return docx2txt.process(path)

def _cache_path(original_path: str) -> str:
    # Use filename with extension replaced by .txt
    name = os.path.basename(original_path)
    cache_name = f"{name}.txt"
    return str(CACHE_DIR.joinpath(cache_name))

def extract_text(file_path: str, force_refresh: bool = False) -> str:
    file_path = os.path.expanduser(file_path)
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"file not found: {file_path}")

    ext = os.path.splitext(file_path)[1].lower()
    cache_file = _cache_path(file_path)

    # If cached and not forced, return cached content
    if os.path.exists(cache_file) and not force_refresh:
        with open(cache_file, "r", encoding="utf-8") as f:
            return f.read()

    # Otherwise extract
    if ext == ".pdf":
        text = _extract_from_pdf(file_path)
    elif ext == ".docx":
        text = _extract_from_docx(file_path)
    else:
        raise ValueError("Unsupported file type (only .pdf and .docx supported)")

    # Save to cache
    with open(cache_file, "w", encoding="utf-8") as f:
        f.write(text)

    return text
