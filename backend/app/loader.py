"""Reads .md and .txt files from a folder. Title = first '# heading', else the file name."""

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class SourceDoc:
    doc_id: str
    title: str
    text: str


def load_docs(folder: Path) -> list[SourceDoc]:
    if not folder.is_dir():
        raise FileNotFoundError(f"Data folder not found: {folder}")
    docs: list[SourceDoc] = []
    for path in sorted(folder.iterdir()):
        if path.suffix.lower() not in {".md", ".txt"} or not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        title = path.stem.replace("-", " ").replace("_", " ").title()
        body_lines = text.splitlines()
        for i, line in enumerate(body_lines):
            if line.startswith("# "):
                title = line[2:].strip()
                del body_lines[i]  # the title is metadata, not searchable body text
                break
        docs.append(SourceDoc(doc_id=path.stem, title=title, text="\n".join(body_lines).strip()))
    if not docs:
        raise ValueError(f"No .md or .txt files in {folder}")
    return docs
