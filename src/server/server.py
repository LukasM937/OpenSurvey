"""
Umfrage-Server v4.

Neu in v4:
  [F] Schema-Validierung: Client sendet SHA-256 über normalisierte Response-Keys.
      Server vergleicht gegen kanonischen Hash der 107 bekannten Fragen-IDs.
      Fremde Payloads werden abgelehnt bevor sie auf Disk landen.
  [G] Wert-Validierung: Responses dürfen nur bekannte Typen und Werte enthalten.
"""

import fcntl
import hashlib
import hmac
import ipaddress
import json
import logging
import os
import re
import shutil
import time
import urllib.error
import urllib.request
from base64 import b64encode
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from prometheus_client import (
    CONTENT_TYPE_LATEST,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)
from starlette.responses import PlainTextResponse

# ── Konfiguration ─────────────────────────────────────────────

DATA_DIR        = Path(os.getenv("SURVEY_DATA_DIR",      "/var/data/survey")).resolve()
MAX_BODY_BYTES  = int(os.getenv("SURVEY_MAX_BODY",        str(512 * 1024)))
MAX_JSON_DEPTH  = int(os.getenv("SURVEY_MAX_DEPTH",       "12"))
MAX_FILES       = int(os.getenv("SURVEY_MAX_FILES",       "50000"))
MIN_FREE_MB     = int(os.getenv("SURVEY_MIN_FREE_MB",     "200"))
RATE_LIMIT_REQ  = int(os.getenv("SURVEY_RATE_LIMIT_REQ",  "5"))
RATE_LIMIT_WIN  = int(os.getenv("SURVEY_RATE_LIMIT_WIN",  "60"))
ALLOWED_ORIGINS  = os.getenv("SURVEY_ALLOWED_ORIGINS",     "*").split(",")
ADMIN_TOKEN      = os.getenv("ADMIN_TOKEN",                "")
STATIC_DIR       = Path(os.getenv("STATIC_DIR", str(Path(__file__).parent))).resolve()
SCHEMA_FILE      = Path(os.getenv("SCHEMA_FILE",
                   str(Path(__file__).parent.parent / "survey" / "umfrage_struktur.json")))
NEWSLETTER_FILE     = Path(os.getenv("NEWSLETTER_DATA_FILE",
                      "/var/data/newsletter/subscribers.ndjson"))
NEWSLETTER_PUB_KEY  = Path(os.getenv("NEWSLETTER_PUB_KEY",
                      "/etc/survey/newsletter_pub.pem"))
# Friendly Captcha v2 — set both vars to enable; leave empty to disable (dev mode)
CAPTCHA_API_KEY  = os.getenv("FRIENDLYCAPTCHA_API_KEY",  "")
CAPTCHA_SITEKEY  = os.getenv("FRIENDLYCAPTCHA_SITEKEY",  "")
# Use the EU endpoint if your data must stay in the EU, otherwise global
CAPTCHA_ENDPOINT = os.getenv("FRIENDLYCAPTCHA_ENDPOINT",
                   "https://global.frcapi.com/api/v2/captcha/siteverify")
# Tailscale CGNAT range; must match Apache's "Require ip 100.64.0.0/10"
_TAILSCALE_NET = ipaddress.ip_network("100.64.0.0/10")

DATA_DIR.mkdir(parents=True, exist_ok=True)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("umfrage")

# ── Prometheus metrics ────────────────────────────────────────

_survey_submissions = Counter(
    "survey_submissions_total", "Accepted survey submissions", ["month", "lang"]
)
_survey_duplicates = Counter(
    "survey_duplicates_total", "Duplicate submission attempts"
)
_survey_schema_mismatches = Counter(
    "survey_schema_mismatches_total", "Schema hash mismatches from clients"
)
_survey_validation_errors = Counter(
    "survey_validation_errors_total", "Payload validation rejections"
)
_captcha_failures = Counter(
    "captcha_failures_total", "Captcha verification failures"
)
_captcha_network_errors = Counter(
    "captcha_network_errors_total", "Captcha API network/timeout errors"
)
_rate_limit_hits = Counter(
    "rate_limit_hits_total", "Rate limit rejections", ["endpoint"]
)
_newsletter_signups = Counter(
    "newsletter_signups_total", "Newsletter signups", ["lang"]
)
_newsletter_access_events = Counter(
    "newsletter_access_total", "Newsletter subscriber list access audit events"
)
_http_requests = Counter(
    "http_requests_total", "HTTP requests processed", ["method", "endpoint", "status"]
)
_http_duration = Histogram(
    "http_request_duration_seconds", "HTTP request latency", ["endpoint"],
    buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0],
)
_gauge_submissions = Gauge(
    "survey_total_submissions", "Total survey files on disk"
)
_gauge_disk_free = Gauge(
    "survey_disk_free_bytes", "Free disk space in bytes"
)
_gauge_disk_used = Gauge(
    "survey_disk_used_bytes", "Used disk space in bytes"
)
_gauge_newsletter = Gauge(
    "newsletter_subscriber_count", "Newsletter subscriber count"
)


def _normalize_endpoint(path: str) -> str:
    if path in ("/api/survey", "/api/newsletter", "/health"):
        return path
    if path in ("/results", "/results/"):
        return "/results"
    if path in ("/admin", "/admin/"):
        return "/admin"
    if path.startswith("/admin/api/"):
        return "/admin/api/*"
    if path.startswith("/results/api/"):
        return "/results/api/*"
    return "other"


def _update_live_gauges() -> None:
    _gauge_submissions.set(get_file_count())
    try:
        usage = shutil.disk_usage(DATA_DIR)
        _gauge_disk_free.set(usage.free)
        _gauge_disk_used.set(usage.used)
    except Exception:
        pass
    count = _newsletter_count()
    if count >= 0:
        _gauge_newsletter.set(count)


if not CAPTCHA_API_KEY:
    log.warning("FRIENDLYCAPTCHA_API_KEY not set – captcha verification disabled (dev mode)")

try:
    import aggregator as _aggregator
except ImportError:
    _aggregator = None  # type: ignore
    log.warning("aggregator.py not found – /admin and /results endpoints disabled")


# ── Friendly Captcha v2 verification ─────────────────────────
#
# If CAPTCHA_API_KEY is not set the check is skipped — useful during
# local development. In production both env vars must be present.
#
# The frontend must include the Friendly Captcha widget and submit the
# solved token in the JSON body under the key "frc-captcha-response".

def _verify_captcha(token: str | None, ip: str) -> None:
    """Raise HTTPException(400) if the captcha token is missing or invalid."""
    if not CAPTCHA_API_KEY:
        return  # dev mode — skip

    if not token or not isinstance(token, str) or len(token) > 2048:
        log.warning("captcha-missing  ip=%s", ip)
        raise HTTPException(400, "Captcha fehlt oder ungültig")

    payload = json.dumps({"response": token, "sitekey": CAPTCHA_SITEKEY}).encode()
    req = urllib.request.Request(
        CAPTCHA_ENDPOINT,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Accept":       "application/json",
            "X-Api-Key":    CAPTCHA_API_KEY,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            result = json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body = exc.read()
        try:
            result = json.loads(body)
        except Exception:
            result = {}
        log.warning("captcha-api-error  ip=%s  status=%s  body=%s",
                    ip, exc.code, body[:200])
    except Exception as exc:
        # Network failure — fail open so the server stays usable if FriendlyCaptcha
        # has an outage. Change to fail closed by raising HTTPException here if
        # you prefer strict mode.
        log.error("captcha-network-error  ip=%s  err=%s", ip, exc)
        _captcha_network_errors.inc()
        return

    if not result.get("success"):
        errors = result.get("errors", [])
        log.warning("captcha-fail  ip=%s  errors=%s", ip, errors)
        _captcha_failures.inc()
        raise HTTPException(400, "Captcha-Lösung ungültig – bitte erneut versuchen")

# ── [F] Kanonisches Schema ─────────────────────────────────────
#
# Alle gültigen Fragen-IDs. Muss mit dem Frontend synchron gehalten werden.
# Wenn Fragen hinzugefügt/entfernt werden: neuen Hash generieren mit
#   python3 -c "import hashlib,json; ids=sorted([...]); print(hashlib.sha256(json.dumps(ids,separators=(',',':')).encode()).hexdigest())"

VALID_QUESTION_IDS: frozenset[str] = frozenset([
    "Q001","Q002","Q003","Q004","Q005","Q006","Q007","Q008","Q009","Q010",
    "Q011","Q012","Q013","Q014","Q015","Q016","Q017","Q018","Q019","Q020",
    "Q021","Q022","Q023","Q024","Q025","Q026","Q027","Q028","Q029","Q030",
    "Q031","Q032","Q033","Q034","Q035","Q036","Q037","Q038","Q039","Q040",
    "Q041","Q042","Q043","Q044","Q045","Q046","Q047","Q048","Q049","Q050",
    "Q051","Q052","Q053","Q054","Q055","Q056","Q057","Q058","Q059","Q060",
    "Q061","Q062","Q063","Q064","Q065","Q066","Q067","Q068","Q069","Q070",
    "Q071","Q072","Q073","Q074","Q075","Q076","Q077","Q078","Q079","Q080",
    "Q081","Q082","Q083","Q084","Q085","Q086","Q087","Q088","Q089","Q090",
    "Q091","Q092","Q093","Q094","Q095","Q096","Q097","Q098","Q099","Q100",
    "Q101","Q102","Q103","Q104","Q105","Q106","Q107","Q108","Q109","Q110",
    "Q111","Q112","Q113","Q114","Q115","Q116","Q117","Q118","Q119","Q120",
    "Q121","Q122","Q123","Q124","Q125","Q126","Q127","Q128","Q129","Q130",
    "Q131","Q132","Q133","Q134","Q135","Q136","Q137","Q138","Q139","Q140",
    "Q141","Q142","Q143","Q144","Q145","Q146","Q147","Q148","Q149","Q150",
    "Q151","Q152","Q153","Q154","Q155","Q156","Q157",
])

# Kanonischer Hash = SHA-256 über sortierte IDs als kompaktes JSON-Array.
# Wird beim Serverstart einmalig berechnet.
_CANONICAL_IDS_JSON = json.dumps(sorted(VALID_QUESTION_IDS), separators=(",", ":")).encode()
SCHEMA_HASH: str = hashlib.sha256(_CANONICAL_IDS_JSON).hexdigest()
log.info("Schema-Hash: %s  (%d Fragen)", SCHEMA_HASH[:16] + "…", len(VALID_QUESTION_IDS))
# Erwarteter Hash für Q001–Q122: b659a728a1147f0f2ea35727ac21fab2046f92c36be751eb594e5f6ad762615f

# Gültige Werttypen pro Fragen-ID.
# "ka" = __ka__ (Keine Angabe), "int1-5" = Likert, "int1-7" = Slider,
# "int0-10" = SOEP, "int" = freie Zahl, "str" = Freitext/Radio/Party,
# "list" = Mehrfachauswahl
QUESTION_TYPES: dict[str, str] = {
    **{f"Q{i:03d}": "int"     for i in [1, 14, 113]},
    **{f"Q{i:03d}": "int1-5"  for i in [25,26,27,31,32,33,34,35,36,39,50,51,53,54,
                                          55,56,57,58,59,60,61,62,65,68,69,70,71,73,
                                          76,77,78,79,80,81,82,83,84,85,86,87,88,
                                          89,90,91,95,106,115,116,117,118,119,120,123,125,126,130,
                                          132,134,135,137,138,141,151,152,153,154,155,156,157,]},
    **{f"Q{i:03d}": "int1-7"  for i in [29, 30, 66, 133]},
    **{f"Q{i:03d}": "int0-10" for i in [104]},
    # list = Mehrfachauswahl (Q010 jetzt auch list)
    **{f"Q{i:03d}": "list"    for i in [10, 15, 22, 40, 63, 67, 92, 108, 136, 140, 146, 148]},
    **{f"Q{i:03d}": "str"     for i in [2,3,4,5,6,7,8,9,11,12,13,16,17,18,19,20,
                                          21,23,24,28,37,38,41,42,43,44,45,46,47,48,49,
                                          52,64,72,74,75,93,94,96,97,98,99,100,101,102,103,
                                          105,107,109,110,111,112,114,121,122,127,128,129,
                                          131,139,142,143,144,145,]},
}

KA_VALUE = "__ka__"
MAX_STR_LEN = 2000   # Freitext-Felder


def validate_responses(responses: dict) -> list[str]:
    """
    Prüft alle Response-Werte gegen das Schema.
    Gibt eine Liste von Fehler-Strings zurück (leer = alles ok).
    """
    errors: list[str] = []

    # Nur bekannte IDs
    unknown = set(responses.keys()) - VALID_QUESTION_IDS
    if unknown:
        errors.append(f"Unbekannte Fragen-IDs: {sorted(unknown)[:5]}")
        return errors  # früh abbrechen

    for qid, val in responses.items():
        # Keine Angabe und übersprungene Fragen sind immer gültig
        if val == KA_VALUE or val == "__skipped__":
            continue
        if val is None:
            continue

        qtype = QUESTION_TYPES.get(qid, "str")

        if qtype == "int":
            if not isinstance(val, int) or val < 0 or val > 120:
                errors.append(f"{qid}: ungültiger int-Wert {val!r}")

        elif qtype == "int1-5":
            if val not in (1, 2, 3, 4, 5):
                errors.append(f"{qid}: Likert-Wert außerhalb 1-5: {val!r}")

        elif qtype == "int1-7":
            if val not in (1, 2, 3, 4, 5, 6, 7):
                errors.append(f"{qid}: Slider-Wert außerhalb 1-7: {val!r}")

        elif qtype == "int0-10":
            if not isinstance(val, int) or val < 0 or val > 10:
                errors.append(f"{qid}: SOEP-Wert außerhalb 0-10: {val!r}")

        elif qtype == "str":
            if not isinstance(val, str):
                errors.append(f"{qid}: erwartet str, bekam {type(val).__name__}")
            elif len(val) > MAX_STR_LEN:
                errors.append(f"{qid}: Freitext zu lang ({len(val)} > {MAX_STR_LEN})")
            # PLZ-Sonderregel: Q121 muss genau 5 Ziffern sein
            elif qid == "Q121" and not re.fullmatch(r"\d{5}", val):
                errors.append(f"Q121: ungültige Postleitzahl {val!r}")

        elif qtype == "list":
            if not isinstance(val, list):
                errors.append(f"{qid}: erwartet list, bekam {type(val).__name__}")
            elif len(val) > 20:
                errors.append(f"{qid}: Liste zu lang")
            elif not all(isinstance(v, str) and len(v) <= 200 for v in val):
                errors.append(f"{qid}: Listenwerte ungültig")

    return errors


# ── FastAPI App ────────────────────────────────────────────────

app = FastAPI(docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response as StarletteResponse

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next) -> StarletteResponse:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"]        = "DENY"
        response.headers["Referrer-Policy"]        = "no-referrer"
        response.headers["Permissions-Policy"]     = "interest-cohort=()"
        return response


class MetricsMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: StarletteRequest, call_next) -> StarletteResponse:
        endpoint = _normalize_endpoint(request.url.path)
        start = time.perf_counter()
        try:
            response = await call_next(request)
            status = str(response.status_code)
        except Exception:
            _http_requests.labels(
                method=request.method, endpoint=endpoint, status="500"
            ).inc()
            _http_duration.labels(endpoint=endpoint).observe(time.perf_counter() - start)
            raise
        _http_requests.labels(
            method=request.method, endpoint=endpoint, status=status
        ).inc()
        _http_duration.labels(endpoint=endpoint).observe(time.perf_counter() - start)
        return response


app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(MetricsMiddleware)

# ── Monatlicher Unterordner ───────────────────────────────────
#
# Struktur: DATA_DIR/YYYY-MM/YYYYMMDDTHHMMSSZ_{safe_id}.json
#
# Vorteil:
#   - Zeitliche Filterung per Verzeichnis ohne Datei-Parsing
#   - Vergangene Monate per `chattr +a <monat-dir>` immutable setzbar
#   - `ls /var/data/survey/2025-04/ | wc -l` gibt April-Einreichungen

def get_month_dir(dt: datetime) -> Path:
    """Gibt das Monatsverzeichnis zurück und erstellt es bei Bedarf."""
    month_dir = DATA_DIR / dt.strftime("%Y-%m")
    month_dir.mkdir(exist_ok=True)
    return month_dir

# ── Dateianzahl-Cache (rekursiv über alle Monatsordner) ───────

_file_count      = sum(1 for _ in DATA_DIR.rglob("*.json"))
_file_count_lock = Lock()

def increment_file_count() -> None:
    global _file_count
    with _file_count_lock:
        _file_count += 1

def get_file_count() -> int:
    with _file_count_lock:
        return _file_count

# ── Rate Limiter ──────────────────────────────────────────────

_rate: dict[str, list[float]] = defaultdict(list)
_rate_lock     = Lock()
_last_cleanup  = 0.0
CLEANUP_INT    = 300.0

def _cleanup(now: float) -> None:
    global _last_cleanup
    if now - _last_cleanup < CLEANUP_INT:
        return
    cutoff = now - RATE_LIMIT_WIN
    dead = [ip for ip, ts in _rate.items() if not any(t > cutoff for t in ts)]
    for ip in dead:
        del _rate[ip]
    _last_cleanup = now

def is_rate_limited(ip: str) -> bool:
    now = time.monotonic()
    cutoff = now - RATE_LIMIT_WIN
    with _rate_lock:
        _cleanup(now)
        recent = [t for t in _rate[ip] if t > cutoff]
        if len(recent) >= RATE_LIMIT_REQ:
            _rate[ip] = recent
            return True
        recent.append(now)
        _rate[ip] = recent
        return False

# ── Hilfsfunktionen ───────────────────────────────────────────

def get_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"

def sanitize_id(raw: str) -> str:
    return "".join(c for c in raw if c.isascii() and c.isalnum())[:64]

def check_depth(obj, depth: int = 0) -> None:
    if depth > MAX_JSON_DEPTH:
        raise ValueError("zu tief")
    if isinstance(obj, dict):
        for v in obj.values():
            check_depth(v, depth + 1)
    elif isinstance(obj, list):
        for item in obj:
            check_depth(item, depth + 1)

def guard_resources() -> None:
    usage = shutil.disk_usage(DATA_DIR)
    if usage.free < MIN_FREE_MB * 1_048_576:
        raise HTTPException(503, "Dienst vorübergehend nicht verfügbar")
    if get_file_count() >= MAX_FILES:
        raise HTTPException(503, "Dienst vorübergehend nicht verfügbar")

# ── Endpoint ──────────────────────────────────────────────────

@app.post("/api/survey")
async def receive_survey(request: Request) -> JSONResponse:

    ip = get_ip(request)

    if is_rate_limited(ip):
        log.warning("rate-limit  ip=%s", ip)
        _rate_limit_hits.labels(endpoint="/api/survey").inc()
        raise HTTPException(429, "Zu viele Anfragen")

    if "application/json" not in request.headers.get("content-type", ""):
        raise HTTPException(415, "Content-Type muss application/json sein")

    cl = request.headers.get("content-length", "")
    if cl:
        # Guard against absurdly long content-length strings before int() conversion
        if len(cl) > 12 or not cl.isdigit():
            raise HTTPException(400, "Ungültiger Content-Length-Header")
        if int(cl) > MAX_BODY_BYTES:
            raise HTTPException(413, "Payload zu groß")
    raw = await request.body()
    if len(raw) > MAX_BODY_BYTES:
        raise HTTPException(413, "Payload zu groß")

    try:
        body = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(400, "Ungültiges JSON")
    if not isinstance(body, dict):
        raise HTTPException(400, "Erwartet ein JSON-Objekt")

    try:
        check_depth(body)
    except ValueError:
        raise HTTPException(400, "JSON-Struktur zu komplex")

    # Captcha verification (skipped in dev mode if CAPTCHA_API_KEY is unset)
    _verify_captcha(body.get("frc-captcha-response"), ip)

    # [F] Schema-Hash prüfen
    client_hash = str(body.get("schema_hash", ""))
    if client_hash != SCHEMA_HASH:
        log.warning("schema-mismatch  ip=%s  got=%s", ip, client_hash[:16])
        _survey_schema_mismatches.inc()
        raise HTTPException(400, "Schema-Version stimmt nicht überein – bitte Seite neu laden")

    # [F] Wert-Validierung
    responses = body.get("responses", {})
    if not isinstance(responses, dict):
        raise HTTPException(400, "responses muss ein Objekt sein")

    val_errors = validate_responses(responses)
    if val_errors:
        log.warning("validation  ip=%s  errors=%s", ip, val_errors[:3])
        _survey_validation_errors.inc()
        raise HTTPException(422, f"Ungültige Werte: {val_errors[0]}")

    safe_id = sanitize_id(str(body.get("id", "")))
    if not safe_id:
        raise HTTPException(400, "Fehlende oder ungültige id")

    # Whitelist top-level fields — reject payloads with unknown keys
    known_fields = {
        "id", "schema_hash", "responses", "lang", "frc-captcha-response",
        "submitted_at", "version", "answered", "total", "duration_seconds",
    }
    unknown_fields = set(body.keys()) - known_fields
    if unknown_fields:
        raise HTTPException(400, f"Unbekannte Felder: {sorted(unknown_fields)[:5]}")

    # Validate lang if present: BCP-47 short tag, e.g. "de", "en", "fr-CH"
    lang_raw = body.get("lang", "de")
    if not isinstance(lang_raw, str) or not re.fullmatch(r"[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?", lang_raw):
        raise HTTPException(400, "Ungültiger lang-Wert")
    safe_lang = lang_raw[:10]

    guard_resources()

    # Zeitstempel einmalig festlegen
    now_utc = datetime.now(timezone.utc)
    ts_file = now_utc.strftime("%Y%m%dT%H%M%SZ")   # 20250420T143201Z  → sortierbar
    ts_iso  = now_utc.isoformat()

    # Monatsverzeichnis: DATA_DIR/YYYY-MM/
    month_dir = get_month_dir(now_utc)

    # Dateiname: YYYYMMDDTHHMMSSZ_{safe_id}.json
    target = (month_dir / f"{ts_file}_{safe_id}.json").resolve()
    try:
        target.relative_to(DATA_DIR)
    except ValueError:
        raise HTTPException(400, "Ungültige Anfrage")

    # Duplikat-Check über alle Monatsordner (rglob)
    if list(DATA_DIR.rglob(f"*_{safe_id}.json")):
        log.info("duplicate  id=%s", safe_id)
        _survey_duplicates.inc()
        return JSONResponse({"status": "duplicate", "message": "Bereits eingereicht"})

    # Only store whitelisted, validated fields
    duration_raw = body.get("duration_seconds")
    stored = {
        "id":           safe_id,
        "lang":         safe_lang,
        "responses":    responses,
        "_received_at": ts_iso,
        "_month":       now_utc.strftime("%Y-%m"),
        **({"duration_seconds": duration_raw}
           if isinstance(duration_raw, int) and 0 <= duration_raw <= 86400 else {}),
    }

    try:
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(stored, f, ensure_ascii=False, indent=2)
    except FileExistsError:
        log.info("duplicate-race  id=%s", safe_id)
        return JSONResponse({"status": "duplicate", "message": "Bereits eingereicht"})

    increment_file_count()
    _survey_submissions.labels(month=stored["_month"], lang=safe_lang).inc()
    log.info("ok  id=%s  month=%s  n=%d", safe_id, stored["_month"], len(responses))
    return JSONResponse({"status": "ok"})


@app.get("/health")
async def health(request: Request) -> JSONResponse:
    if get_ip(request) not in ("127.0.0.1", "::1"):
        raise HTTPException(404)
    usage = shutil.disk_usage(DATA_DIR)
    months = {
        d.name: sum(1 for _ in d.glob("*.json"))
        for d in sorted(DATA_DIR.iterdir())
        if d.is_dir() and len(d.name) == 7  # YYYY-MM
    }
    return JSONResponse({
        "status":       "ok",
        "submissions":  get_file_count(),
        "by_month":     months,
        "disk_free_mb": usage.free  // 1_048_576,
        "disk_used_mb": usage.used  // 1_048_576,
        "schema_hash":  SCHEMA_HASH,
    })


# ── Admin helpers ─────────────────────────────────────────────

def _is_local(ip: str) -> bool:
    """True for localhost and Tailscale IPs within 100.64.0.0/10."""
    if ip in ("127.0.0.1", "::1"):
        return True
    try:
        return ipaddress.ip_address(ip) in _TAILSCALE_NET
    except ValueError:
        return False

def _verify_admin(token: str) -> None:
    if not ADMIN_TOKEN:
        raise HTTPException(503, "Admin nicht konfiguriert (ADMIN_TOKEN nicht gesetzt)")
    if not hmac.compare_digest(token or "", ADMIN_TOKEN):
        log.warning("admin-auth-failure  token_prefix=%s", (token or "")[:4])
        raise HTTPException(401, "Ungültiger Admin-Token")

def _newsletter_count() -> int:
    try:
        return sum(1 for ln in NEWSLETTER_FILE.read_text().splitlines() if ln.strip())
    except Exception:
        return -1


def _load_newsletter_pubkey():
    """Load RSA public key for newsletter encryption. Returns None if not configured."""
    if not NEWSLETTER_PUB_KEY.exists():
        return None
    try:
        from cryptography.hazmat.primitives import serialization
        return serialization.load_pem_public_key(NEWSLETTER_PUB_KEY.read_bytes())
    except Exception as exc:
        log.error("newsletter pubkey load failed: %s", exc)
        return None


def _encrypt_newsletter_entry(pubkey, payload: dict) -> dict:
    """Encrypt payload dict with AES-256-GCM, wrap key with RSA-OAEP."""
    import os as _os
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding as _padding
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    aes_key = _os.urandom(32)
    nonce   = _os.urandom(12)
    aesgcm  = AESGCM(aes_key)
    plaintext = json.dumps(payload, ensure_ascii=False).encode()
    ciphered  = aesgcm.encrypt(nonce, plaintext, None)

    enc_key = pubkey.encrypt(
        aes_key,
        _padding.OAEP(
            mgf=_padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return {
        "encrypted": True,
        "enc_key":   b64encode(enc_key).decode(),
        "nonce":     b64encode(nonce).decode(),
        "enc_data":  b64encode(ciphered).decode(),
    }


# ── Admin endpoints ───────────────────────────────────────────

@app.get("/admin")
@app.get("/admin/")
async def admin_page(request: Request) -> FileResponse:
    if not _is_local(get_ip(request)):
        raise HTTPException(404)
    html = STATIC_DIR / "admin" / "index.html"
    if not html.exists():
        raise HTTPException(404, "Admin-Dashboard nicht deployt (admin/index.html fehlt)")
    return FileResponse(html, media_type="text/html")


@app.get("/admin/api/stats")
async def admin_stats(
    request: Request,
    x_admin_token: str = Header(default=""),
) -> JSONResponse:
    ip = get_ip(request)
    if not _is_local(ip):
        raise HTTPException(404)
    _verify_admin(x_admin_token)
    log.info("admin-stats  ip=%s", ip)
    if _aggregator is None:
        raise HTTPException(503, "aggregator.py nicht verfügbar")
    stats = _aggregator.get_admin_stats(DATA_DIR)
    return JSONResponse({**stats, "newsletter_count": _newsletter_count()})


@app.get("/admin/api/export")
async def admin_export(
    request: Request,
    x_admin_token: str = Header(default=""),
) -> JSONResponse:
    ip = get_ip(request)
    if not _is_local(ip):
        raise HTTPException(404)
    _verify_admin(x_admin_token)
    log.info("admin-export  ip=%s", ip)
    if _aggregator is None:
        raise HTTPException(503, "aggregator.py nicht verfügbar")
    return JSONResponse(_aggregator.get_export_dataset(DATA_DIR))


@app.post("/admin/api/invalidate-cache")
async def admin_invalidate_cache(
    request: Request,
    x_admin_token: str = Header(default=""),
) -> JSONResponse:
    ip = get_ip(request)
    if not _is_local(ip):
        raise HTTPException(404)
    _verify_admin(x_admin_token)
    log.info("admin-invalidate-cache  ip=%s", ip)
    if _aggregator:
        _aggregator.invalidate_cache()
    return JSONResponse({"status": "ok"})


@app.get("/admin/api/plz-stats")
async def admin_plz_stats(
    request: Request,
    x_admin_token: str = Header(default=""),
) -> JSONResponse:
    ip = get_ip(request)
    if not _is_local(ip):
        raise HTTPException(404)
    _verify_admin(x_admin_token)
    if _aggregator is None:
        raise HTTPException(503, "aggregator.py nicht verfügbar")
    data = _aggregator.get_plz_stats(DATA_DIR)
    # Strip heavy question data from summary response; client fetches export separately
    summary = {k: v for k, v in data.items() if k != "bundles"}
    summary["bundles"] = [
        {k: v for k, v in b.items() if k != "questions"}
        for b in data["bundles"]
    ]
    return JSONResponse(summary)


@app.get("/admin/api/plz-export")
async def admin_plz_export(
    request: Request,
    x_admin_token: str = Header(default=""),
) -> JSONResponse:
    ip = get_ip(request)
    if not _is_local(ip):
        raise HTTPException(404)
    _verify_admin(x_admin_token)
    if _aggregator is None:
        raise HTTPException(503, "aggregator.py nicht verfügbar")
    log.info("admin-plz-export  ip=%s", ip)
    return JSONResponse(_aggregator.get_plz_export(DATA_DIR))


@app.get("/admin/api/schema")
async def admin_get_schema(
    request: Request,
    x_admin_token: str = Header(default=""),
) -> JSONResponse:
    ip = get_ip(request)
    if not _is_local(ip):
        raise HTTPException(404)
    _verify_admin(x_admin_token)
    if not SCHEMA_FILE.exists():
        raise HTTPException(404, f"Schema-Datei nicht gefunden: {SCHEMA_FILE}")
    try:
        schema = json.loads(SCHEMA_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        raise HTTPException(500, f"Schema konnte nicht gelesen werden: {exc}")
    return JSONResponse(schema)


@app.put("/admin/api/schema")
async def admin_put_schema(
    request: Request,
    x_admin_token: str = Header(default=""),
) -> JSONResponse:
    ip = get_ip(request)
    if not _is_local(ip):
        raise HTTPException(404)
    _verify_admin(x_admin_token)

    raw = await request.body()
    if len(raw) > 2_000_000:
        raise HTTPException(413, "Schema-Payload zu groß")
    try:
        schema = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(400, "Ungültiges JSON")
    if not isinstance(schema, dict) or "sections" not in schema:
        raise HTTPException(422, "Schema muss ein Objekt mit 'sections' sein")

    try:
        SCHEMA_FILE.write_text(
            json.dumps(schema, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
    except PermissionError:
        raise HTTPException(
            403,
            f"Keine Schreibrechte auf {SCHEMA_FILE}. "
            "ReadWritePaths in der systemd-Unit anpassen.",
        )
    except Exception as exc:
        raise HTTPException(500, f"Speichern fehlgeschlagen: {exc}")

    log.info("admin-schema-saved  ip=%s  sections=%d", ip, len(schema.get("sections", [])))
    return JSONResponse({"status": "ok", "path": str(SCHEMA_FILE)})


# ── Newsletter signup ─────────────────────────────────────────

_EMAIL_RE = re.compile(r"[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{1,63}", re.ASCII)
_newsletter_lock = Lock()


@app.post("/api/newsletter")
async def newsletter_signup(request: Request) -> JSONResponse:
    ip = get_ip(request)

    if is_rate_limited(ip):
        _rate_limit_hits.labels(endpoint="/api/newsletter").inc()
        raise HTTPException(429, "Zu viele Anfragen")

    if "application/json" not in request.headers.get("content-type", ""):
        raise HTTPException(415, "Content-Type muss application/json sein")

    cl = request.headers.get("content-length", "")
    if cl:
        if len(cl) > 12 or not cl.isdigit():
            raise HTTPException(400, "Ungültiger Content-Length-Header")
        if int(cl) > 4096:
            raise HTTPException(413, "Payload zu groß")
    raw = await request.body()
    if len(raw) > 4096:
        raise HTTPException(413, "Payload zu groß")

    try:
        body = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(400, "Ungültiges JSON")
    if not isinstance(body, dict):
        raise HTTPException(400, "Erwartet ein JSON-Objekt")

    # Captcha before any expensive processing
    _verify_captcha(body.get("frc-captcha-response"), ip)

    email = body.get("email", "")
    if not isinstance(email, str) or not _EMAIL_RE.fullmatch(email.strip()):
        raise HTTPException(422, "Ungültige E-Mail-Adresse")
    email = email.strip().lower()

    consent = body.get("consent", False)
    if consent is not True:
        raise HTTPException(422, "Einwilligung erforderlich")

    lang_raw = body.get("lang", "de")
    if not isinstance(lang_raw, str) or not re.fullmatch(r"[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?", lang_raw):
        lang_raw = "de"
    safe_lang = lang_raw[:10]

    pubkey = _load_newsletter_pubkey()
    if pubkey is None:
        log.error("newsletter pubkey not available – signup rejected")
        raise HTTPException(503, "Newsletter-Dienst nicht verfügbar")

    now_utc = datetime.now(timezone.utc)
    # consent_at is always server-generated — never trust the client's clock
    # for GDPR audit trail purposes
    consent_at = now_utc.isoformat()
    stored_at  = consent_at

    payload = {"email": email, "lang": safe_lang, "consent_at": consent_at}
    entry   = _encrypt_newsletter_entry(pubkey, payload)
    entry["_stored_at"] = stored_at

    NEWSLETTER_FILE.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(entry, ensure_ascii=False)
    # fcntl.flock provides cross-process safety (threading.Lock alone is not enough
    # if uvicorn is ever started with multiple workers)
    with _newsletter_lock:
        with open(NEWSLETTER_FILE, "a", encoding="utf-8") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            try:
                f.write(line + "\n")
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)

    _newsletter_signups.labels(lang=safe_lang).inc()
    log.info("newsletter  ip=%s  lang=%s", ip, safe_lang)
    return JSONResponse({"status": "ok"})


# ── Public results endpoints ──────────────────────────────────

@app.get("/results")
@app.get("/results/")
async def results_page() -> FileResponse:
    html = STATIC_DIR / "results" / "index.html"
    if not html.exists():
        raise HTTPException(404, "Results-Seite nicht deployt (results/index.html fehlt)")
    return FileResponse(html, media_type="text/html")


@app.get("/results/api/stats")
async def results_stats(request: Request) -> JSONResponse:
    if is_rate_limited(get_ip(request)):
        raise HTTPException(429, "Zu viele Anfragen")
    if _aggregator is None:
        raise HTTPException(503, "aggregator.py nicht verfügbar")
    return JSONResponse(_aggregator.get_public_stats(DATA_DIR))


# ── Prometheus metrics endpoint ───────────────────────────────

@app.get("/admin/metrics")
async def admin_metrics(request: Request) -> PlainTextResponse:
    """Prometheus scrape target — IP-gated, no token required."""
    if not _is_local(get_ip(request)):
        raise HTTPException(404)
    _update_live_gauges()
    return PlainTextResponse(generate_latest(), media_type=CONTENT_TYPE_LATEST)


# ── Newsletter access audit endpoint ─────────────────────────

_AUDIT_FILE = NEWSLETTER_FILE.parent / "access_log.ndjson"


@app.post("/admin/api/newsletter-access")
async def admin_newsletter_access(
    request: Request,
    x_admin_token: str = Header(default=""),
) -> JSONResponse:
    """Record a newsletter subscriber list access for GDPR audit trail."""
    ip = get_ip(request)
    if not _is_local(ip):
        raise HTTPException(404)
    _verify_admin(x_admin_token)

    raw = await request.body()
    note = ""
    if raw:
        try:
            body = json.loads(raw)
            if isinstance(body, dict) and isinstance(body.get("note"), str):
                note = body["note"][:200]
        except Exception:
            pass

    count = _newsletter_count()
    now_utc = datetime.now(timezone.utc)
    entry = {
        "accessed_at":      now_utc.isoformat(),
        "ip":               ip,
        "subscriber_count": count,
        "note":             note,
    }

    _AUDIT_FILE.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(entry, ensure_ascii=False)
    with _newsletter_lock:
        with open(_AUDIT_FILE, "a", encoding="utf-8") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            try:
                f.write(line + "\n")
            finally:
                fcntl.flock(f, fcntl.LOCK_UN)

    _newsletter_access_events.inc()
    log.info("newsletter-access  ip=%s  count=%d  note=%r", ip, count, note)
    return JSONResponse({
        "status":           "ok",
        "subscriber_count": count,
        "accessed_at":      entry["accessed_at"],
    })