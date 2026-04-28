#!/usr/bin/env python3
"""
One-time migration: extract language data from umfrage.jsx into
individual src/survey/i18n/<lang>.js files.

Run from the repository root:
  python3 tools/migrate_i18n.py
"""
import re
from pathlib import Path

ROOT = Path("/home/user/OpenSurvey")
JSX = ROOT / "src" / "survey" / "umfrage.jsx"
I18N = ROOT / "src" / "survey" / "i18n"
I18N.mkdir(parents=True, exist_ok=True)

src = JSX.read_text("utf-8")


def extract_inner(text, start_pattern):
    """Return inner content of the first `{ ... }` block matched by start_pattern."""
    m = re.search(start_pattern, text)
    if not m:
        return None
    pos = m.end()
    depth = 1
    while pos < len(text) and depth > 0:
        c = text[pos]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        pos += 1
    return text[m.end() : pos - 1]


def extract_inner_last(text, start_pattern):
    """Return inner content of the LAST `{ ... }` block matched by start_pattern."""
    matches = list(re.finditer(start_pattern, text))
    if not matches:
        return None
    m = matches[-1]
    pos = m.end()
    depth = 1
    while pos < len(text) and depth > 0:
        c = text[pos]
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
        pos += 1
    return text[m.end() : pos - 1]


def get_block(container_inner, lang, last=False):
    """Extract inner content of `lang: { ... }` from within container_inner."""
    pattern = rf"(?m)^\s+{re.escape(lang)}\s*:\s*\{{"
    if last:
        return extract_inner_last(container_inner, pattern)
    return extract_inner(container_inner, pattern)


# ── Extract top-level object contents ─────────────────────────
t_inner = extract_inner(src, r"const T\s*=\s*\{")
tooltips_inner = extract_inner(src, r"const TOOLTIPS\s*=\s*\{")
qt_inner = extract_inner(src, r"const QUESTION_TEXTS\s*=\s*\{")
st_inner = extract_inner(src, r"const SECTION_TEXTS\s*=\s*\{")

assert t_inner, "Could not extract T object"
assert tooltips_inner, "Could not extract TOOLTIPS object"
assert qt_inner, "Could not extract QUESTION_TEXTS object"
assert st_inner, "Could not extract SECTION_TEXTS object"

# Languages with null UI strings (e.g. `fr: null, it: null, ...`)
null_ui = set(re.findall(r"\b(\w{2,3})\s*:\s*null\b", t_inner))
print(f"Null-UI languages detected: {sorted(null_ui)}")

LANGUAGES = ["de", "en", "tr", "uk", "pl", "ar", "es", "fr", "it", "da", "sv"]

LANG_NAMES = {
    "de": "German (Deutsch) — base language; question/section text lives in umfrage_struktur.json",
    "en": "English — complete: UI strings, tooltips, question texts, section titles",
    "tr": "Turkish (Türkçe) — UI strings + section titles",
    "uk": "Ukrainian (Українська) — UI strings + section titles",
    "pl": "Polish (Polski) — UI strings + section titles",
    "ar": "Arabic (العربية) — UI strings + section titles; question texts are stubs",
    "es": "Spanish (Español) — UI strings + section titles; question texts are stubs",
    "fr": "French (Français) — section titles only; UI falls back to German",
    "it": "Italian (Italiano) — section titles only; UI falls back to German",
    "da": "Danish (Dansk) — section titles only; UI falls back to German",
    "sv": "Swedish (Svenska) — section titles only; UI falls back to German",
}

for lang in LANGUAGES:
    # ── UI strings ─────────────────────────────────────────────
    if lang in null_ui:
        ui_js = "null"
    else:
        inner = get_block(t_inner, lang)
        ui_js = "null" if inner is None else "{\n" + inner + "\n  }"

    # ── Tooltips ───────────────────────────────────────────────
    inner = get_block(tooltips_inner, lang)
    tips_js = "null" if (inner is None or not inner.strip()) else "{\n" + inner + "\n  }"

    # ── Question texts ─────────────────────────────────────────
    inner = get_block(qt_inner, lang)
    if inner is None:
        q_js = "null"
    elif inner.strip() == "":
        q_js = "{}"
    else:
        q_js = "{\n" + inner + "\n  }"

    # ── Section texts (use last block for 'es' to fix duplicate-key bug) ──
    inner = get_block(st_inner, lang, last=(lang == "es"))
    sec_js = "null" if (inner is None or not inner.strip()) else "{\n" + inner + "\n  }"

    # ── Compose file ───────────────────────────────────────────
    es_note = (
        "// Note: the original umfrage.jsx had a duplicate 'es:' key in SECTION_TEXTS.\n"
        "// This file uses the second (title-case) block, which is what the runtime used.\n"
        if lang == "es"
        else ""
    )
    content = (
        f"{es_note}"
        f"// {LANG_NAMES[lang]}\n"
        "// ui:        UI strings (buttons, titles, notes). null → falls back to German.\n"
        "// tooltips:  Per-question explanation text.       null → falls back to German.\n"
        "// questions: Question text / option overrides.    null → uses German from SECTIONS.\n"
        "// sections:  Section title / description.         null → uses German from SECTIONS.\n"
        "export default {\n"
        f"  ui: {ui_js},\n"
        f"  tooltips: {tips_js},\n"
        f"  questions: {q_js},\n"
        f"  sections: {sec_js},\n"
        "};\n"
    )

    out = I18N / f"{lang}.js"
    out.write_text(content, "utf-8")
    print(f"  ✓ {lang}.js  ({out.stat().st_size:,} bytes)")

print("\nAll i18n files written.")
