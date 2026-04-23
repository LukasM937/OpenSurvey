"""
Survey data aggregation and k-anonymity export.

Public interface:
    get_admin_stats(data_dir)    → full aggregates for admin dashboard
    get_public_stats(data_dir)   → Bundesland k-anon for public results page
    get_export_dataset(data_dir) → Bundesland k-anon scientific export
    get_plz_stats(data_dir)      → PLZ-based k-anon bundles (with question data)
    get_plz_export(data_dir)     → PLZ k-anon scientific export
    invalidate_cache()           → force reload on next call
"""
import json
import re
import statistics
import threading
import time
from collections import defaultdict
from pathlib import Path
from typing import Any

K_ANON_THRESHOLD = 50
REGION_QUESTION  = "Q004"   # Bundesland
PLZ_QUESTION     = "Q121"   # Postleitzahl
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
            if v != -1:
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
    with _cache_lock:
        entry = _cache.get(key)
        if entry and time.monotonic() - entry["ts"] < CACHE_TTL:
            return entry["data"]
        data = builder()
        _cache[key] = {"ts": time.monotonic(), "data": data}
    return data


# ── PLZ iterative bundling ─────────────────────────────────────

def _bundle_by_plz(records: list[dict]) -> list[dict]:
    """
    Groups records by PLZ with iterative prefix broadening until k-anonymity is met.

    Tries resolutions 5→4→3→2→1 digits. Records that cannot form a group of
    ≥ K_ANON_THRESHOLD at any resolution, plus records without a valid PLZ,
    are collected in a national pool (resolution=0).

    Returns list of bundles sorted finest-first:
        {prefix, resolution, n, plzs_covered, questions}
    """
    by_plz: dict[str, list[dict]] = defaultdict(list)
    no_plz: list[dict] = []

    for r in records:
        plz = r.get("responses", {}).get(PLZ_QUESTION)
        if isinstance(plz, str) and re.fullmatch(r"\d{5}", plz):
            by_plz[plz].append(r)
        else:
            no_plz.append(r)

    published: list[dict] = []
    unassigned: dict[str, list[dict]] = dict(by_plz)

    for resolution in range(5, 0, -1):
        if not unassigned:
            break

        by_prefix: dict[str, list[str]] = defaultdict(list)
        for plz in unassigned:
            by_prefix[plz[:resolution]].append(plz)

        next_unassigned: dict[str, list[dict]] = {}
        for prefix, plzs in sorted(by_prefix.items()):
            group_recs = [r for p in plzs for r in unassigned[p]]
            if len(group_recs) >= K_ANON_THRESHOLD:
                published.append({
                    "prefix":       prefix,
                    "resolution":   resolution,
                    "n":            len(group_recs),
                    "plzs_covered": sorted(plzs),
                    "questions":    _agg_records(
                        group_recs, skip=SKIP_IN_EXPORT | {PLZ_QUESTION}
                    ),
                })
            else:
                for p in plzs:
                    next_unassigned[p] = unassigned[p]

        unassigned = next_unassigned

    pool = [r for recs in unassigned.values() for r in recs] + no_plz
    if pool:
        published.append({
            "prefix":       "national_pool",
            "resolution":   0,
            "n":            len(pool),
            "plzs_covered": sorted(unassigned.keys()),
            "questions":    _agg_records(pool, skip=SKIP_IN_EXPORT | {PLZ_QUESTION}),
        })

    return sorted(published, key=lambda b: (-b["resolution"], b.get("prefix", "")))


# ── Public API ────────────────────────────────────────────────

def get_admin_stats(data_dir: Path) -> dict:
    """Full stats for admin dashboard (no k-anon, includes all questions)."""
    def build():
        records = _load_records(data_dir)
        n       = len(records)
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
    """Bundesland k-anonymous aggregates for public results page."""
    def build():
        records = _load_records(data_dir)
        n       = len(records)
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
    """Bundesland k-anon scientific export (legacy format)."""
    def build():
        records = _load_records(data_dir)
        n       = len(records)
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
            "meta": {
                "total_submissions":     n,
                "k_anonymity_threshold": K_ANON_THRESHOLD,
                "geographic_resolution": "Bundesland",
                "excluded_questions":    sorted(SKIP_IN_EXPORT),
                "suppressed_regions":    suppressed,
                "notes": [
                    "Free-text answers (Q052, Q064) and postal codes (Q121) are excluded.",
                    f"Regional data only for regions with >= {K_ANON_THRESHOLD} submissions.",
                    "Timestamps rounded to YYYY-MM.",
                ],
            },
            "national": {
                "n":        n,
                "by_month": _monthly_counts(records),
                "by_lang":  _lang_counts(records),
                "questions": _agg_records(records, skip=SKIP_IN_EXPORT),
            },
            "regional": regional,
        }
    return _cached(f"export:{data_dir}", build)


def get_plz_stats(data_dir: Path) -> dict:
    """PLZ k-anonymous bundles with full question aggregates per bundle (cached)."""
    def build():
        records = _load_records(data_dir)
        bundles = _bundle_by_plz(records)

        by_res: dict[str, int] = defaultdict(int)
        for b in bundles:
            by_res[str(b["resolution"])] += 1

        plz_records = sum(
            len(recs)
            for r in records
            for recs in ([r],)
            if isinstance(r.get("responses", {}).get(PLZ_QUESTION), str)
            and re.fullmatch(r"\d{5}", r["responses"][PLZ_QUESTION] or "")
        )

        return {
            "total":            len(records),
            "plz_records":      plz_records,
            "no_plz_records":   len(records) - plz_records,
            "k_anon_threshold": K_ANON_THRESHOLD,
            "bundle_count":     len(bundles),
            "by_resolution":    dict(by_res),
            "bundles":          bundles,
        }
    return _cached(f"plz:{data_dir}", build)


def get_plz_export(data_dir: Path) -> dict:
    """PLZ k-anon scientific export — finest geographic resolution possible."""
    stats   = get_plz_stats(data_dir)
    bundles = stats["bundles"]

    return {
        "meta": {
            "total_submissions":     stats["total"],
            "k_anonymity_threshold": K_ANON_THRESHOLD,
            "geographic_resolution": "PLZ iterative bundling (5→4→3→2→1 digit prefix)",
            "excluded_questions":    sorted(SKIP_IN_EXPORT),
            "bundle_count":          stats["bundle_count"],
            "by_resolution":         stats["by_resolution"],
            "notes": [
                "Free-text answers (Q052, Q064) and postal codes (Q121) are excluded.",
                f"Each geographic group contains >= {K_ANON_THRESHOLD} submissions.",
                "resolution=5: full 5-digit PLZ; resolution=4: first 4 digits; etc.",
                "resolution=0: national pool (no valid PLZ or too sparse at 1-digit).",
                "Timestamps rounded to YYYY-MM.",
            ],
        },
        "geographic_groups": [
            {k: v for k, v in b.items() if k != "questions"}
            | {"questions": b["questions"]}
            for b in bundles
        ],
    }


def invalidate_cache() -> None:
    with _cache_lock:
        _cache.clear()
