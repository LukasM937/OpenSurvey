"""
Survey data aggregation and k-anonymity export.

Public interface:
    get_admin_stats(data_dir)    → full aggregates for admin dashboard
    get_public_stats(data_dir)   → Bundesland k-anon for public results page
    get_public_stats_json(...)   → same, pre-serialized (cached bytes)
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

from survey_options import FREE_TEXT_QUESTIONS, SKIPPED_VALUE, sanitize_closed

K_ANON_THRESHOLD = 50
REGION_QUESTION = "Q004"  # Bundesland
PLZ_QUESTION = "Q121"  # Postleitzahl
# Every free-text answer and the PLZ are excluded from all published aggregates
# (public results page, both scientific exports). Verbatim text is never k-anonymisable.
SKIP_IN_EXPORT = FREE_TEXT_QUESTIONS | {PLZ_QUESTION}

# ── Statistical disclosure control for everything that leaves the server ──
# Admin stats keep full resolution; public/export paths use these rules.
MIN_CELL_COUNT = 5  # per-value counts below this are suppressed
# Free-number questions are binned (a count-1 key would name the one respondent
# with that value): qid -> (bin_size, top_code)
NUMERIC_PUBLIC_BINS = {"Q001": (10, 90), "Q014": (1, 4), "Q113": (10, 40)}
# New data is published in steps of this many submissions. Two successive
# snapshots therefore differ by >= RELEASE_STEP respondents, which stops
# poll-and-diff from isolating a single respondent.
RELEASE_STEP = K_ANON_THRESHOLD

_cache: dict[str, Any] = {}
_cache_lock = threading.RLock()
CACHE_TTL = 300.0  # 5 minutes


# ── Helpers ───────────────────────────────────────────────────


def _load_records(data_dir: Path) -> list[dict]:
    """All stored submissions in submission order. Answers to closed questions are
    folded onto the canonical German option; anything else becomes "keine Angabe"."""
    recs = []
    for f in sorted(data_dir.rglob("*.json")):
        try:
            rec = json.loads(f.read_text(encoding="utf-8"))
            responses = rec.get("responses", {})
            rec["responses"] = {qid: sanitize_closed(qid, val) for qid, val in responses.items()}
            recs.append(rec)
        except Exception:
            pass
    return recs


def _released(records: list[dict]) -> list[dict]:
    """Prefix of the records that is public: whole RELEASE_STEP blocks only."""
    return records[: len(records) // RELEASE_STEP * RELEASE_STEP]


def _bin_label(v: float, bin_size: int, top_code: int) -> str:
    if v >= top_code:
        return f"{top_code}+"
    lo = int(v) // bin_size * bin_size
    return str(lo) if bin_size == 1 else f"{lo}-{lo + bin_size - 1}"


def _agg_question(values: list, min_cell: int = 0, bins: tuple[int, int] | None = None) -> dict:
    """Aggregate raw values for one question into counts + numeric stats.

    min_cell > 0 (public/export paths): counts below min_cell are suppressed and
    exact mean/median/stdev are only published when nothing was suppressed
    (otherwise mean*n - sum(published) would recover the suppressed values).
    bins: (bin_size, top_code) publishes numbers as ranges without exact stats.
    """
    counts: dict[str, int] = defaultdict(int)
    numerics: list[float] = []

    for v in values:
        if v is None or v == SKIPPED_VALUE:
            continue
        if isinstance(v, list):
            for item in v:
                counts[str(item)] += 1
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            if v != -1:
                counts[_bin_label(v, *bins) if bins else str(v)] += 1
                numerics.append(float(v))
        else:
            counts[str(v)] += 1

    n = sum(counts.values())
    published = dict(counts)
    suppressed = 0
    if min_cell > 0:
        suppressed = sum(c for c in counts.values() if 0 < c < min_cell)
        published = {k: c for k, c in counts.items() if c >= min_cell}
    result: dict[str, Any] = {"counts": published, "n": n}
    if suppressed:
        result["suppressed_cells"] = suppressed
    if numerics and not bins and not suppressed:
        result["mean"] = round(statistics.mean(numerics), 2)
        result["median"] = statistics.median(numerics)
        if len(numerics) > 1:
            result["stdev"] = round(statistics.stdev(numerics), 2)
    return result


def _agg_records(records: list[dict], skip: frozenset[str] = frozenset(), public: bool = False) -> dict:
    """public=True applies disclosure control (see MIN_CELL_COUNT / NUMERIC_PUBLIC_BINS)."""
    by_q: dict[str, list] = defaultdict(list)
    for rec in records:
        for qid, val in rec.get("responses", {}).items():
            if qid not in skip:
                by_q[qid].append(val)
    if not public:
        return {qid: _agg_question(vals) for qid, vals in sorted(by_q.items())}
    return {
        qid: _agg_question(vals, min_cell=MIN_CELL_COUNT, bins=NUMERIC_PUBLIC_BINS.get(qid))
        for qid, vals in sorted(by_q.items())
    }


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
    """TTL cache with a single rebuilder. While one thread rebuilds, other callers
    get the stale entry instead of piling up behind the lock."""
    entry = _cache.get(key)
    if entry and time.monotonic() - entry["ts"] < CACHE_TTL:
        return entry["data"]
    if not _cache_lock.acquire(blocking=entry is None):
        return entry["data"]  # stale, another thread is rebuilding
    try:
        entry = _cache.get(key)
        if entry and time.monotonic() - entry["ts"] < CACHE_TTL:
            return entry["data"]
        data = builder()
        _cache[key] = {"ts": time.monotonic(), "data": data}
        return data
    finally:
        _cache_lock.release()


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
                published.append(
                    {
                        "prefix": prefix,
                        "resolution": resolution,
                        "n": len(group_recs),
                        "plzs_covered": sorted(plzs),
                        "questions": _agg_records(group_recs, skip=SKIP_IN_EXPORT | {PLZ_QUESTION}, public=True),
                    }
                )
            else:
                for p in plzs:
                    next_unassigned[p] = unassigned[p]

        unassigned = next_unassigned

    pool = [r for recs in unassigned.values() for r in recs] + no_plz
    if pool:
        # The pool is the remainder and can be tiny; below k its answers are not published.
        pool_ok = len(pool) >= K_ANON_THRESHOLD
        published.append(
            {
                "prefix": "national_pool",
                "resolution": 0,
                "n": len(pool),
                "plzs_covered": sorted(unassigned.keys()) if pool_ok else [],
                "questions": (_agg_records(pool, skip=SKIP_IN_EXPORT | {PLZ_QUESTION}, public=True) if pool_ok else {}),
                **({} if pool_ok else {"suppressed": True}),
            }
        )

    return sorted(published, key=lambda b: (-b["resolution"], b.get("prefix", "")))


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
                    1 for r in records if r.get("responses", {}).get(qid) not in (None, "__skipped__", "__ka__")
                )
                completion[qid] = round(answered / n, 3)

        return {
            "total": n,
            "by_month": _monthly_counts(records),
            "by_lang": _lang_counts(records),
            "by_region": {k: len(v) for k, v in sorted(regions.items())},
            "completion_rate": completion,
            "questions": _agg_records(records),
        }

    return _cached(f"admin:{data_dir}", build)


def get_public_stats(data_dir: Path) -> dict:
    """Bundesland k-anonymous aggregates for public results page."""

    def build():
        records = _released(_load_records(data_dir))
        n = len(records)
        regions = _region_groups(records)

        regional: dict[str, Any] = {}
        suppressed: list[str] = []
        for region, recs in sorted(regions.items()):
            if region in ("__ka__", "__skipped__", "None"):
                continue
            if len(recs) >= K_ANON_THRESHOLD:
                regional[region] = {
                    "n": len(recs),
                    "questions": _agg_records(recs, skip=SKIP_IN_EXPORT | {REGION_QUESTION}, public=True),
                }
            else:
                suppressed.append(region)

        return {
            "total": n,
            "by_month": _monthly_counts(records),
            "national": _agg_records(records, skip=SKIP_IN_EXPORT, public=True),
            "regional": regional,
            "k_anon_threshold": K_ANON_THRESHOLD,
            "suppressed_regions": suppressed,
        }

    return _cached(f"public:{data_dir}", build)


def get_public_stats_json(data_dir: Path) -> bytes:
    """Serialized get_public_stats(); cached as bytes so a request costs no JSON encoding."""
    return _cached(
        f"public_json:{data_dir}",
        lambda: json.dumps(get_public_stats(data_dir), ensure_ascii=False, separators=(",", ":")).encode(),
    )


def get_export_dataset(data_dir: Path) -> dict:
    """Bundesland k-anon scientific export (legacy format)."""

    def build():
        records = _released(_load_records(data_dir))
        n = len(records)
        regions = _region_groups(records)

        regional: dict[str, Any] = {}
        suppressed: list[str] = []
        for region, recs in sorted(regions.items()):
            if region in ("__ka__", "__skipped__", "None"):
                continue
            if len(recs) >= K_ANON_THRESHOLD:
                regional[region] = {
                    "n": len(recs),
                    "questions": _agg_records(recs, skip=SKIP_IN_EXPORT | {REGION_QUESTION}, public=True),
                }
            else:
                suppressed.append(region)

        return {
            "meta": {
                "total_submissions": n,
                "k_anonymity_threshold": K_ANON_THRESHOLD,
                "geographic_resolution": "Bundesland",
                "excluded_questions": sorted(SKIP_IN_EXPORT),
                "suppressed_regions": suppressed,
                "notes": [
                    "All free-text answers and postal codes (Q121) are excluded (see excluded_questions).",
                    f"Regional data only for regions with >= {K_ANON_THRESHOLD} submissions.",
                    f"Per-value counts below {MIN_CELL_COUNT} are suppressed; numeric questions are binned; "
                    "mean/median/stdev are omitted for questions where a cell was suppressed.",
                    f"Data is released in blocks of {RELEASE_STEP} submissions.",
                    "Timestamps rounded to YYYY-MM.",
                ],
            },
            "national": {
                "n": n,
                "by_month": _monthly_counts(records),
                "by_lang": _lang_counts(records),
                "questions": _agg_records(records, skip=SKIP_IN_EXPORT, public=True),
            },
            "regional": regional,
        }

    return _cached(f"export:{data_dir}", build)


def get_plz_stats(data_dir: Path) -> dict:
    """PLZ k-anonymous bundles with full question aggregates per bundle (cached)."""

    def build():
        records = _released(_load_records(data_dir))
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
            "total": len(records),
            "plz_records": plz_records,
            "no_plz_records": len(records) - plz_records,
            "k_anon_threshold": K_ANON_THRESHOLD,
            "bundle_count": len(bundles),
            "by_resolution": dict(by_res),
            "bundles": bundles,
        }

    return _cached(f"plz:{data_dir}", build)


def get_plz_export(data_dir: Path) -> dict:
    """PLZ k-anon scientific export — finest geographic resolution possible."""
    stats = get_plz_stats(data_dir)
    bundles = stats["bundles"]

    return {
        "meta": {
            "total_submissions": stats["total"],
            "k_anonymity_threshold": K_ANON_THRESHOLD,
            "geographic_resolution": "PLZ iterative bundling (5→4→3→2→1 digit prefix)",
            "excluded_questions": sorted(SKIP_IN_EXPORT),
            "bundle_count": stats["bundle_count"],
            "by_resolution": stats["by_resolution"],
            "notes": [
                "All free-text answers and postal codes (Q121) are excluded (see excluded_questions).",
                f"Each geographic group contains >= {K_ANON_THRESHOLD} submissions; the national pool "
                "(no valid PLZ or too sparse at 1 digit) is only published with answers if it reaches that size.",
                f"Per-value counts below {MIN_CELL_COUNT} are suppressed; numeric questions are binned; "
                "mean/median/stdev are omitted for questions where a cell was suppressed.",
                f"Data is released in blocks of {RELEASE_STEP} submissions.",
                "Publish only ONE of the Bundesland and PLZ exports per release: the two tabulate the same "
                "records under different partitions and can be differenced against each other.",
                "resolution=5: full 5-digit PLZ; resolution=4: first 4 digits; etc.",
                "resolution=0: national pool (no valid PLZ or too sparse at 1-digit).",
                "Timestamps rounded to YYYY-MM.",
            ],
        },
        "geographic_groups": [
            {k: v for k, v in b.items() if k != "questions"} | {"questions": b["questions"]} for b in bundles
        ],
    }


def invalidate_cache() -> None:
    with _cache_lock:
        _cache.clear()
