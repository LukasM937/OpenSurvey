"""
Umfrage-Server v4.

Neu in v4:
  [F] Schema-Validierung: Client sendet SHA-256 über normalisierte Response-Keys.
      Server vergleicht gegen kanonischen Hash der 107 bekannten Fragen-IDs.
      Fremde Payloads werden abgelehnt bevor sie auf Disk landen.
  [G] Wert-Validierung: Responses dürfen nur bekannte Typen und Werte enthalten.
"""

import hashlib
import json
import logging
import os
import re
import shutil
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# ── Konfiguration ─────────────────────────────────────────────

DATA_DIR        = Path(os.getenv("SURVEY_DATA_DIR",      "/var/data/umfrage")).resolve()
MAX_BODY_BYTES  = int(os.getenv("SURVEY_MAX_BODY",        str(512 * 1024)))
MAX_JSON_DEPTH  = int(os.getenv("SURVEY_MAX_DEPTH",       "12"))
MAX_FILES       = int(os.getenv("SURVEY_MAX_FILES",       "50000"))
MIN_FREE_MB     = int(os.getenv("SURVEY_MIN_FREE_MB",     "200"))
RATE_LIMIT_REQ  = int(os.getenv("SURVEY_RATE_LIMIT_REQ",  "5"))
RATE_LIMIT_WIN  = int(os.getenv("SURVEY_RATE_LIMIT_WIN",  "60"))
ALLOWED_ORIGINS = os.getenv("SURVEY_ALLOWED_ORIGINS",     "*").split(",")

DATA_DIR.mkdir(parents=True, exist_ok=True)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("umfrage")

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
    **{f"Q{i:03d}": "int1-7"  for i in [29, 30, 66, 132]},
    **{f"Q{i:03d}": "int0-10" for i in [104]},
    # list = Mehrfachauswahl (Q010 jetzt auch list)
    **{f"Q{i:03d}": "list"    for i in [10, 15, 22, 40, 63, 67, 92, 108, 136, 140, 146, 148]},
    **{f"Q{i:03d}": "str"     for i in [2,3,4,5,6,7,8,9,11,12,13,16,17,18,19,20,
                                          21,23,24,28,37,38,41,42,43,44,45,46,47,48,49,
                                          52,64,72,74,75,93,94,96,97,98,99,100,101,102,103,
                                          105,107,109,110,111,112,114,121,122,127,128,129,
                                          131,139,142,143,144,145,151,]},
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
        # Keine Angabe ist immer gültig
        if val == KA_VALUE:
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

# ── Monatlicher Unterordner ───────────────────────────────────
#
# Struktur: DATA_DIR/YYYY-MM/YYYYMMDDTHHMMSSZ_{safe_id}.json
#
# Vorteil:
#   - Zeitliche Filterung per Verzeichnis ohne Datei-Parsing
#   - Vergangene Monate per `chattr +a <monat-dir>` immutable setzbar
#   - `ls /var/data/umfrage/2025-04/ | wc -l` gibt April-Einreichungen

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
        raise HTTPException(429, "Zu viele Anfragen")

    if "application/json" not in request.headers.get("content-type", ""):
        raise HTTPException(415, "Content-Type muss application/json sein")

    cl = request.headers.get("content-length")
    if cl and int(cl) > MAX_BODY_BYTES:
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

    # [F] Schema-Hash prüfen
    client_hash = str(body.get("schema_hash", ""))
    if client_hash != SCHEMA_HASH:
        log.warning("schema-mismatch  ip=%s  got=%s", ip, client_hash[:16])
        raise HTTPException(400, "Schema-Version stimmt nicht überein – bitte Seite neu laden")

    # [F] Wert-Validierung
    responses = body.get("responses", {})
    if not isinstance(responses, dict):
        raise HTTPException(400, "responses muss ein Objekt sein")

    val_errors = validate_responses(responses)
    if val_errors:
        log.warning("validation  ip=%s  errors=%s", ip, val_errors[:3])
        raise HTTPException(422, f"Ungültige Werte: {val_errors[0]}")

    safe_id = sanitize_id(str(body.get("id", "")))
    if not safe_id:
        raise HTTPException(400, "Fehlende oder ungültige id")

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
        return JSONResponse({"status": "duplicate", "message": "Bereits eingereicht"})

    body["_received_at"] = ts_iso
    body["_month"]       = now_utc.strftime("%Y-%m")
    body.pop("schema_hash", None)

    try:
        fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(body, f, ensure_ascii=False, indent=2)
    except FileExistsError:
        log.info("duplicate-race  id=%s", safe_id)
        return JSONResponse({"status": "duplicate", "message": "Bereits eingereicht"})

    increment_file_count()
    log.info("ok  id=%s  month=%s  n=%d", safe_id, body["_month"], len(responses))
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
