"""
Survey data aggregation and k-anonymity export.

Public interface:
    get_admin_stats(data_dir)   → full aggregates for admin dashboard
    get_public_stats(data_dir)  → k-anon aggregates for public results page
    get_export_dataset(data_dir)→ scientific export with full k-anonymity
    invalidate_cache()          → force reload on next call
"""
import json
import statistics
import threading
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

K_ANON_THRESHOLD = 50
REGION_QUESTION  = "Q004"   # Bundesland
SKIP_IN_EXPORT   = frozenset({"Q052", "Q064", "Q121"})  # free text + PLZ

_cache: dict[str, Any] = {}
_cache_lock = threading.Lock()
CACHE_TTL   = 300.0  # 5 minutes


# ── Helpers ───────────────────────────────────────────────────

def _load_records(data_dir: Path) -> list[dict]:
    recs = []
    for f in sorted(data_dir.rglob("*.json")):
        try:
            recs.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception:
            pass
    return recs


def _agg_question(values: list) -> dict:
    """Aggregate raw values for one question into counts + numeric stats."""
    counts: dict[str, int] = defaultdict(int)
    numerics: list[float]  = []

    for v in values:
        if v is None or v == "__skipped__":
            continue
        if isinstance(v, list):
            for item in v:
                counts[str(item)] += 1
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            if v != -1:  # -1 means "numeric question, not answered"
                counts[str(v)] += 1
                numerics.append(float(v))
        else:
            counts[str(v)] += 1

    result: dict[str, Any] = {"counts": dict(counts), "n": sum(counts.values())}
    if numerics:
        result["mean"]   = round(statistics.mean(numerics), 2)
        result["median"] = statistics.median(numerics)
        if len(numerics) > 1:
            result["stdev"] = round(statistics.stdev(numerics), 2)
    return result


def _agg_records(records: list[dict], skip: frozenset[str] = frozenset()) -> dict:
    by_q: dict[str, list] = defaultdict(list)
    for rec in records:
        for qid, val in rec.get("responses", {}).items():
            if qid not in skip:
                by_q[qid].append(val)
    return {qid: _agg_question(vals) for qid, vals in sorted(by_q.items())}


def _monthly_counts(records: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for r in records:
        counts[r.get("_month", "unknown")] += 1
    return dict(sorted(counts.items()))


def _lang_counts(records: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for r in records:
        counts[r.get("lang", "de")] += 1
    return dict(sorted(counts.items()))


def _region_groups(records: list[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        region = r.get("responses", {}).get(REGION_QUESTION)
        groups[str(region) if region is not None else "__ka__"].append(r)
    return groups


def _cached(key: str, builder):
    # Double-checked locking: hold the lock for both read and write so only
    # one caller ever runs builder() — prevents thundering herd on cache miss.
    with _cache_lock:
        entry = _cache.get(key)
        if entry and time.monotonic() - entry["ts"] < CACHE_TTL:
            return entry["data"]
        data = builder()
        _cache[key] = {"ts": time.monotonic(), "data": data}
    return data


# ── Public API ────────────────────────────────────────────────

def get_admin_stats(data_dir: Path) -> dict:
    """Full stats for admin dashboard (no k-anon, includes all questions)."""
    def build():
        records = _load_records(data_dir)
        n = len(records)
        regions = _region_groups(records)

        completion: dict[str, float] = {}
        if n:
            all_qids: set[str] = set()
            for r in records:
                all_qids.update(r.get("responses", {}).keys())
            for qid in sorted(all_qids):
                answered = sum(
                    1 for r in records
                    if r.get("responses", {}).get(qid) not in (None, "__skipped__", "__ka__")
                )
                completion[qid] = round(answered / n, 3)

        return {
            "total":           n,
            "by_month":        _monthly_counts(records),
            "by_lang":         _lang_counts(records),
            "by_region":       {k: len(v) for k, v in sorted(regions.items())},
            "completion_rate": completion,
            "questions":       _agg_records(records),
        }
    return _cached(f"admin:{data_dir}", build)


def get_public_stats(data_dir: Path) -> dict:
    """K-anonymous aggregates for public results page."""
    def build():
        records = _load_records(data_dir)
        n = len(records)
        regions = _region_groups(records)

        regional: dict[str, Any] = {}
        suppressed: list[str]    = []
        for region, recs in sorted(regions.items()):
            if region in ("__ka__", "__skipped__", "None"):
                continue
            if len(recs) >= K_ANON_THRESHOLD:
                regional[region] = {
                    "n":         len(recs),
                    "questions": _agg_records(recs, skip=SKIP_IN_EXPORT | {REGION_QUESTION}),
                }
            else:
                suppressed.append(region)

        return {
            "total":              n,
            "by_month":           _monthly_counts(records),
            "national":           _agg_records(records, skip=SKIP_IN_EXPORT),
            "regional":           regional,
            "k_anon_threshold":   K_ANON_THRESHOLD,
            "suppressed_regions": suppressed,
        }
    return _cached(f"public:{data_dir}", build)


def get_export_dataset(data_dir: Path) -> dict:
    """
    Scientific export dataset with full k-anonymity.
    Free text (Q052, Q064) and PLZ (Q121) are excluded.
    Timestamps are rounded to YYYY-MM only.
    """
    def build():
        records = _load_records(data_dir)
        n       = len(records)
        regions = _region_groups(records)

        national_agg = _agg_records(records, skip=SKIP_IN_EXPORT)

        regional: dict[str, Any] = {}
        suppressed: list[str]    = []
        for region, recs in sorted(regions.items()):
            if region in ("__ka__", "__skipped__", "None"):
                continue
            if len(recs) >= K_ANON_THRESHOLD:
                regional[region] = {
                    "n":         len(recs),
                    "questions": _agg_records(recs, skip=SKIP_IN_EXPORT | {REGION_QUESTION}),
                }
            else:
                suppressed.append(region)

        return {
            "meta": {
                "total_submissions":     n,
                "k_anonymity_threshold": K_ANON_THRESHOLD,
                "excluded_questions":    sorted(SKIP_IN_EXPORT),
                "suppressed_regions":    suppressed,
                "notes": [
                    "Free-text answers (Q052, Q064) and postal codes (Q121) are excluded.",
                    f"Regional data only provided for regions with >= {K_ANON_THRESHOLD} submissions.",
                    "Suppressed regions are included in national totals but not listed individually.",
                    "Timestamps are rounded to YYYY-MM to reduce re-identification risk.",
                ],
            },
            "national": {
                "n":        n,
                "by_month": _monthly_counts(records),
                "by_lang":  _lang_counts(records),
                "questions": national_agg,
            },
            "regional": regional,
        }
    return _cached(f"export:{data_dir}", build)


def invalidate_cache() -> None:
    with _cache_lock:
        _cache.clear()
