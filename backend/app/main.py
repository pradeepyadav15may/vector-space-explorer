"""HTTP API plus, when the frontend is built, the web app itself."""

import time
from collections import defaultdict, deque
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config
from .embedder import create_embedder
from .loader import load_docs
from .store import VectorStore

store: VectorStore | None = None
_query_hits: dict[str, deque[float]] = defaultdict(deque)
_neighbor_hits: dict[str, deque[float]] = defaultdict(deque)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global store
    embedder = create_embedder(config.EMBEDDER, config.EMBED_MODEL)
    store = VectorStore(embedder)
    store.ingest(load_docs(config.DATA_DIR))
    store.warm_up()
    yield


app = FastAPI(title="Vector Space Explorer", lifespan=lifespan)


class QueryIn(BaseModel):
    text: str = Field(min_length=1, max_length=config.MAX_QUERY_CHARS)
    k: int = Field(default=5, ge=1, le=config.MAX_TOP_K)


def _require_store() -> VectorStore:
    if store is None:
        raise HTTPException(status_code=503, detail="Index is not ready yet")
    return store


def _check_rate_limit(client: str, bucket: dict[str, deque[float]], limit: int) -> None:
    """Sliding window per client IP. In-memory, so it resets on restart. Enough for a demo."""
    now = time.monotonic()
    hits = bucket[client]
    while hits and now - hits[0] > 60:
        hits.popleft()
    if len(hits) >= limit:
        raise HTTPException(status_code=429, detail="Too many requests, try again in a minute")
    hits.append(now)


@app.get("/api/health")
def health():
    index = _require_store()
    return {
        "status": "ok",
        "embedder": index.embedder.name,
        "docs": index.doc_count,
        "chunks": len(index.chunks),
    }


@app.get("/api/map")
def map_points():
    index = _require_store()
    return {
        "embedder": index.embedder.name,
        "docs": [{"id": k, "title": v} for k, v in index.doc_titles.items()],
        "points": index.map_points(),
    }


@app.post("/api/query")
def query(body: QueryIn, request: Request):
    index = _require_store()
    client = request.client.host if request.client else "unknown"
    _check_rate_limit(client, _query_hits, config.QUERY_RATE_PER_MIN)
    return index.query(body.text, k=body.k)


@app.get("/api/neighbors/{chunk_id}")
def neighbors(chunk_id: str, request: Request, k: int = Query(default=5, ge=1, le=config.MAX_TOP_K)):
    index = _require_store()
    client = request.client.host if request.client else "unknown"
    _check_rate_limit(client, _neighbor_hits, config.NEIGHBOR_RATE_PER_MIN)
    found = index.neighbors(chunk_id, k=k)
    if found is None:
        raise HTTPException(status_code=404, detail="Unknown chunk")
    return {"chunk_id": chunk_id, "neighbors": found}


# Mounted last so /api routes win. Only served when the frontend has been built.
if config.FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIST, html=True), name="web")
