"""Runtime settings. Every value can be overridden with an environment variable."""

import os
from pathlib import Path

# repo/backend/app/config.py -> repo/
REPO_ROOT = Path(__file__).resolve().parents[2]

DATA_DIR = Path(os.getenv("VSE_DATA_DIR", REPO_ROOT / "data" / "sample"))
FRONTEND_DIST = Path(os.getenv("VSE_FRONTEND_DIST", REPO_ROOT / "frontend" / "dist"))

# "fastembed" = real local model (downloads once, ~130 MB). "hash" = offline stand-in for tests only.
EMBEDDER = os.getenv("VSE_EMBEDDER", "fastembed")
EMBED_MODEL = os.getenv("VSE_EMBED_MODEL", "BAAI/bge-small-en-v1.5")

CHUNK_MAX_WORDS = int(os.getenv("VSE_CHUNK_MAX_WORDS", "90"))
CHUNK_OVERLAP_WORDS = int(os.getenv("VSE_CHUNK_OVERLAP_WORDS", "15"))

MAX_QUERY_CHARS = 500
MAX_TOP_K = 10
QUERY_RATE_PER_MIN = int(os.getenv("VSE_QUERY_RATE_PER_MIN", "30"))
NEIGHBOR_RATE_PER_MIN = int(os.getenv("VSE_NEIGHBOR_RATE_PER_MIN", "120"))
