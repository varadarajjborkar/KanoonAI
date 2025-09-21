import sys
import os
import docx2txt
import fitz

def extract_from_pdf(path):
    text = ""
    with fitz.open(path) as doc:
        for page in doc:
            text += page.get_text()
    return text

def extract_from_docx(path):
    return docx2txt.process(path)

if __name__ == "__main__":
    file_path = sys.argv[1]  # MCP Toolbox passes the file path
    ext = os.path.splitext(file_path)[1].lower()

    if ext == ".pdf":
        print(extract_from_pdf(file_path))
    elif ext == ".docx":
        print(extract_from_docx(file_path))
    else:
        print("Unsupported file type", file=sys.stderr)
        sys.exit(1)
