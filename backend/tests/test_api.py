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


def test_neighbors_exclude_self_and_are_ranked(client):
    chunk_id = client.get("/api/map").json()["points"][0]["id"]
    body = client.get(f"/api/neighbors/{chunk_id}", params={"k": 4}).json()
    assert body["chunk_id"] == chunk_id
    # The list is the union of the top 4 under cosine, Euclidean and map distance, best cosine first.
    assert len(body["neighbors"]) >= 4
    assert chunk_id not in [n["chunk_id"] for n in body["neighbors"]]
    scores = [n["score"] for n in body["neighbors"]]
    assert scores == sorted(scores, reverse=True)
    assert [n["rank"] for n in body["neighbors"]][:4] == [1, 2, 3, 4]


def test_neighbors_reject_unknown_chunk_and_bad_k(client):
    assert client.get("/api/neighbors/nope:0").status_code == 404
    chunk_id = client.get("/api/map").json()["points"][0]["id"]
    assert client.get(f"/api/neighbors/{chunk_id}", params={"k": 99}).status_code == 422


def test_neighbors_rate_limit_is_separate_from_queries(client, monkeypatch):
    chunk_id = client.get("/api/map").json()["points"][0]["id"]
    monkeypatch.setattr(main.config, "NEIGHBOR_RATE_PER_MIN", 1)
    main._neighbor_hits.clear()
    main._query_hits.clear()
    assert client.get(f"/api/neighbors/{chunk_id}").status_code == 200
    assert client.get(f"/api/neighbors/{chunk_id}").status_code == 429
    assert client.post("/api/query", json={"text": "coral"}).status_code == 200
    main._neighbor_hits.clear()
    main._query_hits.clear()


def test_query_returns_all_three_metrics_with_ranks(client):
    body = client.post("/api/query", json={"text": "espresso brewing pressure", "k": 3}).json()
    for m in body["matches"]:
        assert set(m["ranks"]) == {"cosine", "euclidean", "map"}
        assert m["rank"] == m["ranks"]["cosine"]
        # unit vectors: d^2 = 2 - 2*cos (values are rounded, so allow a small tolerance)
        assert abs(m["euclidean"] ** 2 - (2 - 2 * m["score"])) < 1e-3
        assert m["map_distance"] >= 0
    # every chunk in the union is in the top 3 under at least one metric
    assert all(min(m["ranks"].values()) <= 3 for m in body["matches"])


def test_cosine_and_euclidean_rank_identically_on_unit_vectors(client):
    body = client.post("/api/query", json={"text": "how do coral reefs bleach", "k": 5}).json()
    by_cosine = sorted(body["matches"], key=lambda m: m["ranks"]["cosine"])
    by_euclid = sorted(body["matches"], key=lambda m: m["ranks"]["euclidean"])
    assert [m["chunk_id"] for m in by_cosine] == [m["chunk_id"] for m in by_euclid]


def test_neighbors_carry_all_metrics(client):
    chunk_id = client.get("/api/map").json()["points"][0]["id"]
    for n in client.get(f"/api/neighbors/{chunk_id}", params={"k": 3}).json()["neighbors"]:
        assert set(n["ranks"]) == {"cosine", "euclidean", "map"}
        assert chunk_id != n["chunk_id"]
        assert n["map_distance"] > 0
