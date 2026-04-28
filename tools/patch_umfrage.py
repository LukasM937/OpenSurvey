#!/usr/bin/env python3
"""
Patch umfrage.jsx to:
1. Add i18n import statements after existing imports
2. Replace T / TOOLTIPS / QUESTION_TEXTS / SECTION_TEXTS literal blocks
   with a compact assembly from the imported language modules.
"""
import re
from pathlib import Path

JSX = Path("/home/user/OpenSurvey/src/survey/umfrage.jsx")
src = JSX.read_text("utf-8")

# ── 1. Insert i18n imports after the last top-level import ────
IMPORT_BLOCK = """import de from "./i18n/de.js";
import en from "./i18n/en.js";
import tr from "./i18n/tr.js";
import uk from "./i18n/uk.js";
import pl from "./i18n/pl.js";
import fr from "./i18n/fr.js";
import es from "./i18n/es.js";
import it from "./i18n/it.js";
import ar from "./i18n/ar.js";
import da from "./i18n/da.js";
import sv from "./i18n/sv.js";
"""

# Find the last `import ... from` line at the top
last_import = list(re.finditer(r'^import .+;\n', src, re.MULTILINE))[-1]
insert_pos = last_import.end()
src = src[:insert_pos] + "\n" + IMPORT_BLOCK + src[insert_pos:]
print("✓ Added i18n imports")

# ── 2. Find and replace the data blocks ───────────────────────
# The region to replace starts at the comment block before `const T`
# and ends just before `const translateQ`.

ASSEMBLY_BLOCK = """// ── i18n assembled from per-language modules in ./i18n/ ─────
// Add a new translation by creating src/survey/i18n/<code>.js
// with ui, tooltips, questions, and sections fields.
const _LANGS = { de, en, tr, uk, pl, fr, es, it, ar, da, sv };

const T = Object.fromEntries(
  LANGUAGES.map(({ code }) => [code, _LANGS[code]?.ui ?? null])
);

// Fallback auf Deutsch wenn Sprache noch nicht übersetzt ist
const useT = (lang) => T[lang] || T["de"];

const TOOLTIPS = Object.fromEntries(
  LANGUAGES
    .map(({ code }) => [code, _LANGS[code]?.tooltips ?? null])
    .filter(([, v]) => v !== null)
);

// Fallback: wenn Tooltip in gewählter Sprache fehlt, DE nehmen
const useTooltip = (lang, qid) =>
  (TOOLTIPS[lang]?.[qid]) ?? (TOOLTIPS["de"]?.[qid]) ?? null;

const QUESTION_TEXTS = Object.fromEntries(
  LANGUAGES
    .map(({ code }) => [code, _LANGS[code]?.questions])
    .filter(([, v]) => v !== null && v !== undefined)
);

const SECTION_TEXTS = Object.fromEntries(
  LANGUAGES
    .map(({ code }) => [code, _LANGS[code]?.sections])
    .filter(([, v]) => v !== null && v !== undefined)
);

"""

# Anchor: comment immediately before `const T =`
start_pattern = re.compile(
    r'// Nur UI-Strings.*?(?=const translateQ)',
    re.DOTALL
)
m = start_pattern.search(src)
assert m, "Could not locate T…SECTION_TEXTS region in umfrage.jsx"

src = src[:m.start()] + ASSEMBLY_BLOCK + src[m.end():]
print("✓ Replaced T / TOOLTIPS / QUESTION_TEXTS / SECTION_TEXTS with assembly block")

assert "const useT" in src, "useT is missing – check the replacement boundaries"
assert "const useTooltip" in src, "useTooltip is missing"
print("✓ useT and useTooltip helpers confirmed present")

JSX.write_text(src, "utf-8")
print(f"✓ Wrote updated umfrage.jsx ({len(src):,} chars)")
