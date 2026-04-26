"""
OpenSurvey integrity tests.

Verifies that:
- umfrage_struktur.json is structurally valid
- question IDs, hashes, and types are consistent across
  umfrage_struktur.json, server.py, and umfrage.jsx
- all non-null UI translations expose the same key set as German (de)
- skip_if conditions reference valid question IDs and use valid operators
"""

import ast
import hashlib
import json
import re
from pathlib import Path

ROOT           = Path(__file__).parent.parent
STRUCTURE_JSON = ROOT / "src" / "survey" / "umfrage_struktur.json"
SERVER_PY      = ROOT / "src" / "server" / "server.py"
JSX_FILE       = ROOT / "src" / "survey" / "umfrage.jsx"

# Mapping from JSON question type → QUESTION_TYPES value expected in server.py
JSON_TO_SERVER_TYPE = {
    "radio":        "str",
    "check":        "list",
    "likert5":      "int1-5",
    "slider7":      "int1-7",
    "number":       "int",
    "text":         "str",
    "scale10":      "int0-10",
    "party_single": "str",
    "party_multi":  "list",
    "plz":          "str",
}

# Operators recognised by shouldSkip() in umfrage.jsx
VALID_OPERATORS = {"eq", "neq", "lt", "lte", "in", "notin", "contains", "notcontains"}

# Keys every non-null translation in the T object must provide (based on de baseline)
CANONICAL_TRANSLATION_KEYS = frozenset({
    "title", "subtitle", "back", "next", "submit", "noAnswer",
    "reset", "resetYes", "resetNo", "jsonBtn", "jsonTitle", "jsonHint",
    "modalTitle", "privacyNote", "dupWarning", "sending", "cancel",
    "answered", "thanksTitle", "thanksBody", "thanksNote", "viewAgain",
    "section", "langLabel",
})


# ── Helpers ───────────────────────────────────────────────────────────────

def load_structure():
    return json.loads(STRUCTURE_JSON.read_text(encoding="utf-8"))


def all_questions(structure):
    for section in structure["sections"]:
        yield from section["questions"]


def extract_valid_question_ids() -> frozenset:
    """Parse VALID_QUESTION_IDS from server.py via AST (no imports needed).

    Handles both plain and annotated assignments:
      VALID_QUESTION_IDS = frozenset([...])
      VALID_QUESTION_IDS: frozenset[str] = frozenset([...])
    """
    tree = ast.parse(SERVER_PY.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        # ast.AnnAssign covers the "name: type = value" form
        if isinstance(node, ast.AnnAssign):
            target = node.target
            value  = node.value
        elif isinstance(node, ast.Assign):
            if len(node.targets) != 1:
                continue
            target = node.targets[0]
            value  = node.value
        else:
            continue

        if not (isinstance(target, ast.Name) and target.id == "VALID_QUESTION_IDS"):
            continue

        # frozenset([...])
        if isinstance(value, ast.Call) and value.args:
            lst = value.args[0]
            if isinstance(lst, ast.List):
                return frozenset(
                    elt.value
                    for elt in lst.elts
                    if isinstance(elt, ast.Constant)
                )
    raise RuntimeError("VALID_QUESTION_IDS not found in server.py")


def extract_question_types() -> dict:
    """
    Reconstruct QUESTION_TYPES from server.py using regex.
    Handles the multi-line **{f"Q{i:03d}": "type" for i in [...]} format.
    """
    src = SERVER_PY.read_text(encoding="utf-8")
    pattern = re.compile(
        r'\*\*\{f"Q\{i:03d\}"\s*:\s*"([^"]+)"\s+for\s+i\s+in\s+\[([^\]]+)\]\}',
        re.DOTALL,
    )
    result = {}
    for m in pattern.finditer(src):
        type_name = m.group(1)
        nums = [
            int(x.strip())
            for x in m.group(2).split(",")
            if x.strip().isdigit()
        ]
        for n in nums:
            result[f"Q{n:03d}"] = type_name
    return result


def compute_schema_hash(question_ids) -> str:
    canonical = json.dumps(sorted(question_ids), separators=(",", ":")).encode()
    return hashlib.sha256(canonical).hexdigest()


def extract_jsx_schema_hash() -> str:
    src = JSX_FILE.read_text(encoding="utf-8")
    m = re.search(r'const SCHEMA_HASH\s*=\s*"([0-9a-f]{64})"', src)
    assert m, "SCHEMA_HASH constant not found in umfrage.jsx"
    return m.group(1)


def extract_language_translation_keys() -> dict:
    """
    Returns {lang_code: set_of_keys | None} for every entry in LANGUAGES.
    None means the translation is explicitly null (falls back to German at runtime).
    """
    src = JSX_FILE.read_text(encoding="utf-8")

    langs_block = re.search(r'const LANGUAGES\s*=\s*\[(.+?)\]', src, re.DOTALL)
    assert langs_block, "LANGUAGES array not found in umfrage.jsx"
    all_langs = re.findall(r'"code"\s*:\s*"(\w+)"', langs_block.group(1))

    null_langs = set(re.findall(r'\b(\w{2,3})\s*:\s*null\b', src))

    result = {}
    for lang in all_langs:
        if lang in null_langs:
            result[lang] = None
            continue

        m = re.search(rf'(?m)^\s+{re.escape(lang)}\s*:\s*\{{', src)
        if not m:
            result[lang] = set()
            continue

        # Brace-count to find the matching closing brace
        start = m.end()
        depth, pos = 1, start
        while pos < len(src) and depth > 0:
            ch = src[pos]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
            pos += 1

        block = src[start : pos - 1]
        keys = set(re.findall(r"^\s+(\w+)\s*:", block, re.MULTILINE))
        result[lang] = keys

    return result


# ── Tests: JSON structure ─────────────────────────────────────────────────

def test_structure_json_valid():
    """JSON parses without error and has required top-level keys."""
    data = load_structure()
    for key in ("meta", "sections", "question_types"):
        assert key in data, f"Top-level key '{key}' missing from umfrage_struktur.json"
    assert isinstance(data["sections"], list) and data["sections"]


def test_question_count_matches_meta():
    """meta.total_questions equals the actual number of questions in all sections."""
    data = load_structure()
    actual   = sum(len(s["questions"]) for s in data["sections"])
    declared = data["meta"]["total_questions"]
    assert actual == declared, (
        f"meta.total_questions is {declared} but {actual} questions exist in sections"
    )


def test_question_ids_are_unique():
    """No two questions share the same ID."""
    data = load_structure()
    ids = [q["id"] for q in all_questions(data)]
    duplicates = {qid for qid in ids if ids.count(qid) > 1}
    assert not duplicates, f"Duplicate question IDs: {sorted(duplicates)}"


def test_question_ids_format():
    """Every question ID matches Q followed by exactly 3 digits."""
    data = load_structure()
    bad = [q["id"] for q in all_questions(data) if not re.fullmatch(r"Q\d{3}", q["id"])]
    assert not bad, f"Malformed question IDs: {bad}"


def test_section_ids_are_unique():
    """No two sections share the same ID."""
    data = load_structure()
    ids = [s["id"] for s in data["sections"]]
    duplicates = {sid for sid in ids if ids.count(sid) > 1}
    assert not duplicates, f"Duplicate section IDs: {sorted(duplicates)}"


def test_required_question_fields():
    """Every question has id, text, and type fields."""
    missing = [
        f"{q.get('id', '?')}: {[f for f in ('id', 'text', 'type') if f not in q]}"
        for q in all_questions(load_structure())
        if not all(f in q for f in ("id", "text", "type"))
    ]
    assert not missing, "Questions with missing required fields:\n  " + "\n  ".join(missing)


def test_question_type_values_are_known():
    """Every question's type is one of the documented types in question_types."""
    data  = load_structure()
    known = set(data["question_types"].keys())
    unknown = {(q["id"], q["type"]) for q in all_questions(data) if q["type"] not in known}
    assert not unknown, f"Unknown question types: {sorted(unknown)}"


# ── Tests: type-specific fields ───────────────────────────────────────────

def test_radio_and_check_have_opts():
    """radio and check questions must include an opts list."""
    data = load_structure()
    bad = [
        q["id"] for q in all_questions(data)
        if q["type"] in ("radio", "check") and "opts" not in q
    ]
    assert not bad, f"radio/check questions missing 'opts': {bad}"


def test_likert_and_slider_have_labels():
    """likert5 and slider7 questions must declare left and right anchor labels."""
    data = load_structure()
    bad = [
        q["id"] for q in all_questions(data)
        if q["type"] in ("likert5", "slider7") and ("left" not in q or "right" not in q)
    ]
    assert not bad, f"likert5/slider7 questions missing 'left'/'right': {bad}"


def test_number_questions_have_bounds():
    """number questions must declare min and max."""
    data = load_structure()
    bad = [
        q["id"] for q in all_questions(data)
        if q["type"] == "number" and ("min" not in q or "max" not in q)
    ]
    assert not bad, f"number questions missing 'min'/'max': {bad}"


def test_number_bounds_are_sane():
    """min must be strictly less than max for number questions."""
    data = load_structure()
    bad = [
        f"{q['id']}: min={q['min']} max={q['max']}"
        for q in all_questions(data)
        if q["type"] == "number" and q.get("min", 0) >= q.get("max", 1)
    ]
    assert not bad, f"number questions with invalid bounds: {bad}"


# ── Tests: skip logic ─────────────────────────────────────────────────────

def test_skip_if_operators_are_valid():
    """skip_if.op must be one of the operators recognised by shouldSkip()."""
    data = load_structure()
    bad = [
        (q["id"], q["skip_if"]["op"])
        for q in all_questions(data)
        if "skip_if" in q and q["skip_if"]["op"] not in VALID_OPERATORS
    ]
    assert not bad, f"Invalid skip_if operators: {bad}"


def test_skip_if_references_existing_question():
    """skip_if.q must refer to a question ID that exists in the survey."""
    data   = load_structure()
    all_ids = {q["id"] for q in all_questions(data)}
    bad = [
        (q["id"], q["skip_if"]["q"])
        for q in all_questions(data)
        if "skip_if" in q and q["skip_if"]["q"] not in all_ids
    ]
    assert not bad, f"skip_if references non-existent IDs: {bad}"


def test_skip_if_val_type_matches_operator():
    """in/notin expect a list val; all other operators expect a scalar."""
    data      = load_structure()
    list_ops  = {"in", "notin"}
    scalar_ops = VALID_OPERATORS - list_ops
    bad = []
    for q in all_questions(data):
        if "skip_if" not in q:
            continue
        op, val = q["skip_if"]["op"], q["skip_if"]["val"]
        if op in list_ops and not isinstance(val, list):
            bad.append(f"{q['id']}: op='{op}' but val is {type(val).__name__}")
        elif op in scalar_ops and isinstance(val, list):
            bad.append(f"{q['id']}: op='{op}' but val is a list")
    assert not bad, "skip_if val/operator type mismatches:\n  " + "\n  ".join(bad)


# ── Tests: server ↔ JSON consistency ─────────────────────────────────────

def test_valid_question_ids_match_json():
    """VALID_QUESTION_IDS in server.py must exactly match IDs in umfrage_struktur.json."""
    data       = load_structure()
    json_ids   = frozenset(q["id"] for q in all_questions(data))
    server_ids = extract_valid_question_ids()

    only_server = server_ids - json_ids
    only_json   = json_ids - server_ids
    assert not only_server, f"In server.py but not JSON: {sorted(only_server)}"
    assert not only_json,   f"In JSON but not server.py: {sorted(only_json)}"


def test_question_types_covers_all_valid_ids():
    """Every ID in VALID_QUESTION_IDS must have an entry in QUESTION_TYPES."""
    server_ids     = extract_valid_question_ids()
    question_types = extract_question_types()
    missing = server_ids - set(question_types)
    assert not missing, (
        f"IDs in VALID_QUESTION_IDS with no QUESTION_TYPES entry: {sorted(missing)}"
    )


def test_question_types_no_orphaned_ids():
    """QUESTION_TYPES must not reference IDs absent from VALID_QUESTION_IDS."""
    server_ids     = extract_valid_question_ids()
    question_types = extract_question_types()
    orphaned = set(question_types) - server_ids
    assert not orphaned, (
        f"QUESTION_TYPES references IDs not in VALID_QUESTION_IDS: {sorted(orphaned)}"
    )


def test_question_types_match_json_types():
    """
    The QUESTION_TYPES entry for each ID must be consistent with the type
    declared in umfrage_struktur.json (e.g. check → list, likert5 → int1-5).
    """
    data           = load_structure()
    question_types = extract_question_types()
    bad = []
    for q in all_questions(data):
        qid      = q["id"]
        expected = JSON_TO_SERVER_TYPE.get(q["type"])
        actual   = question_types.get(qid)
        if expected is None or actual is None:
            continue  # covered by other tests
        if actual != expected:
            bad.append(
                f"{qid}: JSON type '{q['type']}' → expect '{expected}', got '{actual}'"
            )
    assert not bad, "QUESTION_TYPES/JSON type mismatches:\n  " + "\n  ".join(bad)


# ── Tests: schema hash ────────────────────────────────────────────────────

def test_schema_hash_consistency():
    """SCHEMA_HASH in umfrage.jsx must equal SHA-256(sorted VALID_QUESTION_IDS JSON)."""
    server_ids = extract_valid_question_ids()
    expected   = compute_schema_hash(server_ids)
    jsx_hash   = extract_jsx_schema_hash()
    assert jsx_hash == expected, (
        f"SCHEMA_HASH mismatch:\n"
        f"  umfrage.jsx:        {jsx_hash}\n"
        f"  expected from server.py: {expected}"
    )


# ── Tests: translations ───────────────────────────────────────────────────

def test_translations_complete():
    """Every non-null translation must provide all keys that the German baseline has."""
    lang_keys = extract_language_translation_keys()
    failures  = []
    for lang, keys in lang_keys.items():
        if keys is None:
            continue  # intentional null — falls back to de at runtime
        missing = CANONICAL_TRANSLATION_KEYS - keys
        if missing:
            failures.append(f"  lang='{lang}' missing: {sorted(missing)}")
    assert not failures, "Incomplete UI translations:\n" + "\n".join(failures)


def test_no_extra_translation_keys():
    """Non-null translations must not introduce keys absent from the German baseline."""
    lang_keys = extract_language_translation_keys()
    failures  = []
    for lang, keys in lang_keys.items():
        if keys is None or lang == "de":
            continue
        extra = keys - CANONICAL_TRANSLATION_KEYS
        if extra:
            failures.append(f"  lang='{lang}' has unexpected keys: {sorted(extra)}")
    assert not failures, "Translations with unexpected extra keys:\n" + "\n".join(failures)
