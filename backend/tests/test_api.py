import os

os.environ.setdefault("VSE_EMBEDDER", "hash")  # tests run offline; the real model is exercised by hand

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app import main  # noqa: E402
from app.chunker import chunk_text, split_query  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:
        yield c


def test_chunk_text_windows_and_overlap():
    words = " ".join(f"w{i}" for i in range(200))
    chunks = chunk_text(words, max_words=90, overlap=15)
    assert len(chunks) == 3
    assert chunks[0].split()[-15:] == chunks[1].split()[:15]


def test_chunks_never_cross_paragraphs():
    text = "alpha beta\n\ngamma delta"
    assert chunk_text(text, max_words=90, overlap=15) == ["alpha beta", "gamma delta"]


def test_split_query_groups_sentences():
    pieces = split_query("One fact here. Another fact here. " * 10, max_words=10)
    assert len(pieces) > 1
    assert all(p.strip() for p in pieces)


def test_health_reports_index(client):
    body = client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["docs"] == 16
    assert body["chunks"] >= 16


def test_map_points_have_3d_coordinates(client):
    body = client.get("/api/map").json()
    assert len(body["points"]) >= 16
    for point in body["points"]:
        assert len(point["xyz"]) == 3
        assert all(abs(v) <= 100.0001 for v in point["xyz"])


def test_query_ranks_matching_document_first(client):
    body = client.post("/api/query", json={"text": "espresso brewing pressure", "k": 3}).json()
    top = [m for m in body["matches"] if m["rank"] == 1][0]
    assert top["doc_title"] == "Brewing Methods: Espresso, Pour-Over and French Press"
    assert 0.0 < top["score"] <= 1.0


def test_query_rejects_empty_and_oversized_input(client):
    assert client.post("/api/query", json={"text": ""}).status_code == 422
    assert client.post("/api/query", json={"text": "x" * 501}).status_code == 422
    assert client.post("/api/query", json={"text": "ok", "k": 99}).status_code == 422


def test_rate_limit_returns_429(client, monkeypatch):
    monkeypatch.setattr(main.config, "QUERY_RATE_PER_MIN", 2)
    main._query_hits.clear()
    codes = [client.post("/api/query", json={"text": "coral"}).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    main._query_hits.clear()
