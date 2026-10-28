"""Splits documents and queries into chunks. Chunks never cross paragraph boundaries."""

import re


def chunk_text(text: str, max_words: int = 90, overlap: int = 15) -> list[str]:
    """Word windows inside each paragraph, with a small overlap so ideas at window edges survive."""
    if max_words <= overlap:
        raise ValueError("max_words must be greater than overlap")
    step = max_words - overlap
    chunks: list[str] = []
    for paragraph in re.split(r"\n\s*\n", text):
        words = paragraph.split()
        if not words:
            continue
        start = 0
        while True:
            chunks.append(" ".join(words[start : start + max_words]))
            if start + max_words >= len(words):
                break
            start += step
    return chunks


def split_query(text: str, max_words: int = 40) -> list[str]:
    """Groups sentences of a query into pieces of roughly max_words, so each piece gets its own point."""
    sentences = [s for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s]
    pieces: list[str] = []
    buffer: list[str] = []
    count = 0
    for sentence in sentences:
        n = len(sentence.split())
        if buffer and count + n > max_words:
            pieces.append(" ".join(buffer))
            buffer, count = [], 0
        buffer.append(sentence)
        count += n
    if buffer:
        pieces.append(" ".join(buffer))
    return pieces
