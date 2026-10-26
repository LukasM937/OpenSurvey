// Generates src/server/allowed_options.json: for every closed question (radio/check)
// a map  submitted string -> canonical German option  over all languages.
// The UI stores the *displayed* (translated) option string, so the server must
// accept every translation (allowlist) and fold it onto the German option
// (otherwise "Bavaria" and "Bayern" would be counted as different regions).
// Translations are matched to the schema options by position.
//
//   node tools/gen_allowed_options.mjs          # (re)write the JSON
//   node tools/gen_allowed_options.mjs --check  # exit 1 if the file is stale

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(join(root, "src/survey/umfrage_struktur.json"), "utf-8"));
const i18nDir = join(root, "src/survey/i18n");
const out = join(root, "src/server/allowed_options.json");

const langs = [];
for (const f of readdirSync(i18nDir).filter((n) => n.endsWith(".js")).sort()) {
  langs.push((await import(pathToFileURL(join(i18nDir, f)).href)).default);
}

const allowed = {};
for (const sec of schema.sections) {
  for (const q of sec.questions) {
    if (q.type !== "radio" && q.type !== "check") continue;
    const map = Object.fromEntries(q.opts.map((o) => [o, o]));
    for (const l of langs) {
      const tr = l.questions?.[q.id]?.opts ?? [];
      if (tr.length && tr.length !== q.opts.length) {
        throw new Error(`${q.id}: translation has ${tr.length} options, schema ${q.opts.length}`);
      }
      tr.forEach((o, i) => {
        if (map[o] !== undefined && map[o] !== q.opts[i]) {
          throw new Error(`${q.id}: option "${o}" maps to both "${map[o]}" and "${q.opts[i]}"`);
        }
        map[o] = q.opts[i];
      });
    }
    allowed[q.id] = Object.fromEntries(Object.entries(map).sort());
  }
}

const json = JSON.stringify(Object.fromEntries(Object.entries(allowed).sort()), null, 1) + "\n";
if (process.argv.includes("--check")) {
  let cur = "";
  try { cur = readFileSync(out, "utf-8"); } catch {}
  if (cur !== json) { console.error("allowed_options.json is stale – run tools/gen_allowed_options.mjs"); process.exit(1); }
} else {
  writeFileSync(out, json);
  console.log(`wrote ${out} (${Object.keys(allowed).length} questions)`);
}
