"""
Regression tests for the OpenVuln findings: intake validation, disclosure control
in the published aggregates, and the static results page.
"""

import importlib
import json
import sys
import uuid
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent
SERVER_DIR = ROOT / "src" / "server"
STRUCTURE_JSON = ROOT / "src" / "survey" / "umfrage_struktur.json"


def _schema_questions():
    schema = json.loads(STRUCTURE_JSON.read_text(encoding="utf-8"))
    return [q for sec in schema["sections"] for q in sec["questions"]]


@pytest.fixture(scope="module")
def _server_module(tmp_path_factory):
    # server.py registers Prometheus metrics at import time, so import it only once.
    base = tmp_path_factory.mktemp("srv")
    mp = pytest.MonkeyPatch()
    mp.setenv("SURVEY_DATA_DIR", str(base / "data"))
    mp.setenv("SURVEY_RATE_LIMIT_REQ", "100000")
    mp.delenv("FRIENDLYCAPTCHA_API_KEY", raising=False)
    mp.syspath_prepend(str(SERVER_DIR))
    module = importlib.import_module("server")
    yield module
    mp.undo()
    for name in ("server", "aggregator", "survey_options"):
        sys.modules.pop(name, None)


@pytest.fixture()
def server(_server_module, tmp_path, monkeypatch):
    static = tmp_path / "static"
    (static / "results").mkdir(parents=True)
    (static / "results" / "index.html").write_text("<html>results</html>")
    monkeypatch.setattr(_server_module, "DATA_DIR", tmp_path / "data")
    monkeypatch.setattr(_server_module, "STATIC_DIR", static)
    (tmp_path / "data").mkdir()
    _server_module._file_cache.clear()
    _server_module._aggregator.invalidate_cache()
    return _server_module


@pytest.fixture()
def client(server):
    from fastapi.testclient import TestClient

    return TestClient(server.app)


def _submit(client, server, responses, lang="de"):
    return client.post(
        "/api/survey",
        json={
            "id": uuid.uuid4().hex,
            "schema_hash": server.SCHEMA_HASH,
            "lang": lang,
            "responses": responses,
        },
    )


# ── allowed_options.json ───────────────────────────────────────


def test_allowed_options_cover_every_closed_question():
    allowed = json.loads((SERVER_DIR / "allowed_options.json").read_text(encoding="utf-8"))
    closed = {q["id"]: q for q in _schema_questions() if q["type"] in ("radio", "check")}
    assert set(allowed) == set(closed)
    for qid, q in closed.items():
        for opt in q["opts"]:
            assert allowed[qid][opt] == opt, f"{qid}: German option {opt!r} must map to itself"
        assert set(allowed[qid].values()) == set(q["opts"]), f"{qid}: translations must fold onto schema options"


def test_free_text_set_matches_schema():
    sys.path.insert(0, str(SERVER_DIR))
    try:
        from survey_options import FREE_TEXT_QUESTIONS
    finally:
        sys.path.remove(str(SERVER_DIR))
    assert FREE_TEXT_QUESTIONS == {q["id"] for q in _schema_questions() if q["type"] == "text"}


# ── intake ─────────────────────────────────────────────────────


def test_intake_rejects_invented_region(client, server):
    r = _submit(client, server, {"Q004": "<img src=x onerror=alert(1)>"})
    assert r.status_code == 422


def test_intake_rejects_unknown_option_in_multiple_choice(client, server):
    r = _submit(client, server, {"Q010": ["Vollzeit (Angestellt)", "Erfunden"]})
    assert r.status_code == 422


def test_intake_rejects_long_party_string(client, server):
    r = _submit(client, server, {"Q037": "x" * 500})
    assert r.status_code == 422


def test_intake_folds_translation_onto_german_option(client, server):
    r = _submit(client, server, {"Q004": "Bavaria"}, lang="en")
    assert r.status_code == 200
    stored = next(server.DATA_DIR.rglob("*.json"))
    assert json.loads(stored.read_text(encoding="utf-8"))["responses"]["Q004"] == "Bayern"


def test_intake_accepts_keine_angabe(client, server):
    assert _submit(client, server, {"Q004": "__ka__", "Q010": ["__ka__"]}).status_code == 200


# ── results page ───────────────────────────────────────────────


def test_results_page_ignores_range_header(client):
    huge = "bytes=" + ",".join(f"{i * 2}-{i * 2 + 1}" for i in range(900))
    r = client.get("/results", headers={"Range": huge})
    assert r.status_code == 200
    assert r.text == "<html>results</html>"


# ── published aggregates ───────────────────────────────────────


def _records(n, **per_record):
    return [
        {"id": str(i), "lang": "de", "_month": "2025-05", "responses": {k: f(i) for k, f in per_record.items()}}
        for i in range(n)
    ]


@pytest.fixture()
def agg(server):
    return importlib.import_module("aggregator")


def _write(data_dir, records):
    month = data_dir / "2025-05"
    month.mkdir(parents=True, exist_ok=True)
    for i, rec in enumerate(records):
        (month / f"20250501T{i // 3600:02d}{i // 60 % 60:02d}{i % 60:02d}Z_{i}.json").write_text(json.dumps(rec))


def test_public_stats_exclude_free_text_and_bin_numbers(server, agg):
    recs = _records(
        100,
        Q004=lambda i: "Bayern",
        Q151=lambda i: f"secret-{i}",
        Q182=lambda i: f"Bürgermeister {i}",
        Q001=lambda i: 20 + i % 60,
    )
    _write(server.DATA_DIR, recs)
    stats = agg.get_public_stats(server.DATA_DIR)
    published = json.dumps(stats)
    assert "secret-" not in published and "Bürgermeister" not in published
    nat = stats["national"]
    assert "Q151" not in nat and "Q182" not in nat
    assert all("-" in k or k.endswith("+") for k in nat["Q001"]["counts"])
    assert "mean" not in nat["Q001"]


def test_small_cells_are_suppressed_and_stats_withheld(server, agg):
    recs = _records(100, Q004=lambda i: "Bayern", Q029=lambda i: 7 if i < 3 else 4)
    _write(server.DATA_DIR, recs)
    q = agg.get_public_stats(server.DATA_DIR)["national"]["Q029"]
    assert q["counts"] == {"4": 97}
    assert q["suppressed_cells"] == 3
    assert "mean" not in q


def test_means_are_published_when_nothing_is_suppressed(server, agg):
    recs = _records(100, Q004=lambda i: "Bayern", Q029=lambda i: 3 + i % 2)
    _write(server.DATA_DIR, recs)
    assert agg.get_public_stats(server.DATA_DIR)["national"]["Q029"]["mean"] == 3.5


def test_data_is_released_in_blocks(server, agg):
    _write(server.DATA_DIR, _records(149, Q004=lambda i: "Bayern"))
    stats = agg.get_public_stats(server.DATA_DIR)
    assert stats["total"] == 100
    assert stats["regional"]["Bayern"]["n"] == 100


def test_legacy_poisoned_values_do_not_become_regions(server, agg):
    recs = _records(100, Q004=lambda i: "Bayern") + _records(60, Q004=lambda i: "Evil<script>")
    _write(server.DATA_DIR, recs)
    stats = agg.get_public_stats(server.DATA_DIR)
    assert "Evil<script>" not in json.dumps(stats)
    assert set(stats["regional"]) == {"Bayern"}


def test_translated_legacy_values_are_merged(server, agg):
    recs = _records(30, Q004=lambda i: "Bayern") + _records(30, Q004=lambda i: "Bavaria")
    _write(server.DATA_DIR, recs)
    regions = agg.get_public_stats(server.DATA_DIR)["regional"]
    assert set(regions) == {"Bayern"}
    assert regions["Bayern"]["n"] == 50


def test_plz_export_hides_free_text_and_small_pool(server, agg):
    recs = _records(
        120,
        Q121=lambda i: "20095",
        Q151=lambda i: "ethnic-free-text",
        Q004=lambda i: "Hamburg",
    ) + _records(10, Q151=lambda i: "pool-free-text")
    _write(server.DATA_DIR, recs)
    export = agg.get_plz_export(server.DATA_DIR)
    text = json.dumps(export)
    assert "ethnic-free-text" not in text and "pool-free-text" not in text
    pool = [g for g in export["geographic_groups"] if g["prefix"] == "national_pool"]
    assert not pool or pool[0].get("suppressed") is True


# ── admin schema editor ────────────────────────────────────────


def test_real_schema_passes_schema_validation(server):
    schema = json.loads(STRUCTURE_JSON.read_text(encoding="utf-8"))
    assert server._validate_schema_doc(schema) == []


@pytest.mark.parametrize(
    "mutate",
    [
        lambda s: s["sections"][0]["questions"][0].update(id='Q001"]);import os#'),
        lambda s: s["sections"][0].update(id="<img src=x onerror=alert(1)>"),
        lambda s: s["sections"][0]["questions"][0].update(type="evil"),
        lambda s: s["sections"][0]["questions"][0].update(opts=["ok", {"x": 1}]),
    ],
)
def test_schema_validation_rejects_injection(server, mutate):
    schema = json.loads(STRUCTURE_JSON.read_text(encoding="utf-8"))
    mutate(schema)
    assert server._validate_schema_doc(schema)
