"""In-memory vector index.

Everything lives in this process's RAM: the chunk texts, their embeddings and their 3D
positions. It is rebuilt from the data folder on every start, so a restart is a full re-index.

3D positions come from UMAP, which squeezes 384 dimensions into 3. That is for looks only.
Ranking always uses cosine similarity on the full embeddings, because a 3D distance is a
distorted picture of the real similarity.
"""

import threading
from dataclasses import dataclass

import numpy as np
import umap

from .chunker import chunk_text, split_query
from .config import CHUNK_MAX_WORDS, CHUNK_OVERLAP_WORDS
from .embedder import Embedder
from .loader import SourceDoc

COORD_SCALE = 100.0  # positions are scaled so the largest coordinate is about this value
MIN_CHUNKS = 5  # UMAP needs a few points to build its neighbour graph


METRICS = ("cosine", "euclidean", "map")


def _ranks(order_key: np.ndarray) -> np.ndarray:
    """1-based rank of every item when sorted ascending by order_key (stable, so ties keep input order)."""
    order = np.argsort(order_key, kind="stable")
    ranks = np.empty(len(order_key), dtype=np.int64)
    ranks[order] = np.arange(1, len(order_key) + 1)
    return ranks


def compare_chunks(similarities: np.ndarray, map_distances: np.ndarray, k: int) -> list[dict]:
    """Score every chunk three ways and keep those that make the top k under any of them.

    - cosine: similarity on the full vectors (higher is closer).
    - euclidean: straight-line distance between the full vectors. Vectors are unit length, so
      d^2 = 2 - 2*cos and the ranking is the same as cosine's.
    - map: distance between the 3D UMAP positions. This is a distorted picture of the full
      space, so its ranking can disagree with the other two.
    Use -inf similarity / inf map distance to exclude an item (e.g. the chunk itself).
    """
    euclidean = np.sqrt(np.clip(2.0 - 2.0 * similarities, 0.0, None))
    ranks = {
        "cosine": _ranks(-similarities),
        "euclidean": _ranks(euclidean),
        "map": _ranks(map_distances),
    }
    keep = np.flatnonzero(np.minimum.reduce([ranks[m] for m in METRICS]) <= k)
    keep = keep[np.argsort(ranks["cosine"][keep], kind="stable")]
    return [
        {
            "index": int(i),
            "cosine": round(float(similarities[i]), 4),
            "euclidean": round(float(euclidean[i]), 4),
            "map_distance": round(float(map_distances[i]), 2),
            "ranks": {m: int(ranks[m][i]) for m in METRICS},
        }
        for i in keep
    ]


@dataclass(frozen=True)
class ChunkRecord:
    id: str
    doc_id: str
    doc_title: str
    text: str
    embedding: np.ndarray
    xyz: tuple[float, float, float]


class VectorStore:
    def __init__(self, embedder: Embedder):
        self.embedder = embedder
        self.chunks: list[ChunkRecord] = []
        self.doc_titles: dict[str, str] = {}
        self._matrix: np.ndarray | None = None
        self._index_by_id: dict[str, int] = {}
        self._xyz: np.ndarray | None = None
        self._reducer: umap.UMAP | None = None
        self._center: np.ndarray | None = None
        self._scale: float = 1.0
        # UMAP's transform() is not documented as thread-safe, so queries take this lock.
        self._lock = threading.Lock()

    # ----- ingestion -------------------------------------------------------------------------

    def ingest(self, docs: list[SourceDoc]) -> None:
        pieces: list[tuple[str, str, str, int]] = []  # (doc_id, title, text, index)
        for doc in docs:
            self.doc_titles[doc.doc_id] = doc.title
            for index, text in enumerate(
                chunk_text(doc.text, CHUNK_MAX_WORDS, CHUNK_OVERLAP_WORDS)
            ):
                pieces.append((doc.doc_id, doc.title, text, index))
        if len(pieces) < MIN_CHUNKS:
            raise ValueError(f"Need at least {MIN_CHUNKS} chunks to build the map, got {len(pieces)}")

        embeddings = self.embedder.embed([p[2] for p in pieces])
        reducer = umap.UMAP(
            n_components=3,
            n_neighbors=min(15, len(pieces) - 1),
            min_dist=0.1,
            metric="cosine",
            random_state=42,
        )
        raw_xyz = reducer.fit_transform(embeddings)
        center = raw_xyz.mean(axis=0)
        scale = float(np.abs(raw_xyz - center).max()) or 1.0
        xyz = (raw_xyz - center) / scale * COORD_SCALE

        chunks = [
            ChunkRecord(
                id=f"{doc_id}:{index}",
                doc_id=doc_id,
                doc_title=title,
                text=text,
                embedding=embeddings[i],
                xyz=(float(xyz[i, 0]), float(xyz[i, 1]), float(xyz[i, 2])),
            )
            for i, (doc_id, title, text, index) in enumerate(pieces)
        ]

        with self._lock:
            self.chunks = chunks
            self._index_by_id = {c.id: i for i, c in enumerate(chunks)}
            self._matrix = embeddings
            self._xyz = np.asarray([c.xyz for c in chunks], dtype=np.float32)
            self._reducer = reducer
            self._center = center
            self._scale = scale

    def warm_up(self) -> None:
        """First UMAP transform compiles numba code and is slow. Do it at startup, not on a visitor's query."""
        self.query("warm up the index", k=1)

    # ----- reads -----------------------------------------------------------------------------

    @property
    def doc_count(self) -> int:
        return len(self.doc_titles)

    def map_points(self) -> list[dict]:
        return [
            {
                "id": c.id,
                "doc_id": c.doc_id,
                "doc_title": c.doc_title,
                "text": c.text,
                "xyz": list(c.xyz),
            }
            for c in self.chunks
        ]

    def neighbors(self, chunk_id: str, k: int = 5) -> list[dict] | None:
        """The chunks closest to one chunk, scored by cosine, Euclidean and 3D map distance.

        Returns None for an unknown chunk id. The chunk itself is never in its own list. A chunk
        is included if it is in the top k under any metric; each carries its rank under all three.
        """
        index = self._index_by_id.get(chunk_id)
        matrix, xyz = self._matrix, self._xyz
        if index is None or matrix is None or xyz is None:
            return None
        similarities = matrix @ matrix[index]
        map_distances = np.linalg.norm(xyz - xyz[index], axis=1)
        similarities[index] = -np.inf
        map_distances[index] = np.inf
        return [
            {
                "chunk_id": self.chunks[row["index"]].id,
                "doc_title": self.chunks[row["index"]].doc_title,
                "text": self.chunks[row["index"]].text,
                "score": row["cosine"],
                "euclidean": row["euclidean"],
                "map_distance": row["map_distance"],
                "ranks": row["ranks"],
                "rank": row["ranks"]["cosine"],
            }
            for row in compare_chunks(similarities, map_distances, min(k, len(self.chunks) - 1))
        ]

    def query(self, text: str, k: int = 5) -> dict:
        pieces = split_query(text)
        if not pieces:
            return {"query_points": [], "matches": []}

        query_vectors = self.embedder.embed(pieces)
        with self._lock:
            matrix = self._matrix
            reducer = self._reducer
            center = self._center
            scale = self._scale
            assert matrix is not None and reducer is not None and center is not None
            query_xyz = (reducer.transform(query_vectors) - center) / scale * COORD_SCALE

        similarities = query_vectors @ matrix.T  # cosine, because all vectors are normalized
        xyz = self._xyz
        assert xyz is not None
        top_k = min(k, len(self.chunks))

        query_points = []
        matches = []
        for piece_index, piece in enumerate(pieces):
            query_points.append(
                {
                    "id": f"q:{piece_index}",
                    "text": piece,
                    "xyz": [float(v) for v in query_xyz[piece_index]],
                }
            )
            map_distances = np.linalg.norm(xyz - query_xyz[piece_index], axis=1)
            for row in compare_chunks(similarities[piece_index], map_distances, top_k):
                chunk = self.chunks[row["index"]]
                matches.append(
                    {
                        "query_point_id": f"q:{piece_index}",
                        "chunk_id": chunk.id,
                        "doc_title": chunk.doc_title,
                        "text": chunk.text,
                        "score": row["cosine"],
                        "euclidean": row["euclidean"],
                        "map_distance": row["map_distance"],
                        "ranks": row["ranks"],
                        "rank": row["ranks"]["cosine"],
                    }
                )
        return {"query_points": query_points, "matches": matches}
