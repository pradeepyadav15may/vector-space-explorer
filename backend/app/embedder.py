"""Turns text into normalized vectors.

FastEmbedEmbedder runs an ONNX model locally on the CPU (no API key, no per-call cost).
HashEmbedder is an offline stand-in for tests and sandboxes that cannot download models.
It only matches shared words, so never use it for the real demo.
"""

import hashlib
import re

import numpy as np

HASH_DIM = 384
_TOKEN = re.compile(r"[a-z0-9]+")
_STOPWORDS = frozenset(
    "a an and are as at be by did do does for from how in is it of on or that the this to was were what which who why with get got".split()
)


def _normalize(x: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(x, axis=1, keepdims=True)
    return x / np.maximum(norms, 1e-12)


class Embedder:
    name: str
    dim: int

    def embed(self, texts: list[str]) -> np.ndarray:  # (n, dim), L2-normalized
        raise NotImplementedError


class FastEmbedEmbedder(Embedder):
    def __init__(self, model_name: str):
        from fastembed import TextEmbedding  # imported lazily so tests can skip it

        self._model = TextEmbedding(model_name)
        self.name = model_name
        self.dim = 384  # BAAI/bge-small-en-v1.5

    def embed(self, texts: list[str]) -> np.ndarray:
        vectors = np.asarray(list(self._model.embed(texts)), dtype=np.float32)
        return _normalize(vectors)


class HashEmbedder(Embedder):
    name = "hash-bow-384 (offline test stand-in)"
    dim = HASH_DIM

    def embed(self, texts: list[str]) -> np.ndarray:
        out = np.zeros((len(texts), HASH_DIM), dtype=np.float32)
        for row, text in enumerate(texts):
            for token in _TOKEN.findall(text.lower()):
                if token in _STOPWORDS:
                    continue
                digest = int(hashlib.md5(token.encode()).hexdigest(), 16)
                sign = 1.0 if (digest >> 1) & 1 else -1.0
                out[row, digest % HASH_DIM] += sign
        return _normalize(out)


def create_embedder(kind: str, model_name: str) -> Embedder:
    if kind == "hash":
        return HashEmbedder()
    if kind == "fastembed":
        return FastEmbedEmbedder(model_name)
    raise ValueError(f"Unknown VSE_EMBEDDER: {kind!r} (use 'fastembed' or 'hash')")
