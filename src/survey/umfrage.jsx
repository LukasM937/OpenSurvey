import { useEffect, useRef, useState } from "react";
import { FriendlyCaptchaSDK } from "@friendlycaptcha/sdk";

import de from "./i18n/de.js";
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

const _frcSdk = new FriendlyCaptchaSDK();

const KA = "__ka__";

// ↓ Server-Endpunkt hier eintragen
const SERVER_URL = "https://survey.muehrke.de/api/survey";

// ── Storage-Adapter ───────────────────────────────────────────
// window.storage ist die Claude-Artifact-API und nur innerhalb von claude.ai
// verfügbar. Im produktiven Vite-Build (survey.muehrke.de) fällt dieser Adapter
// automatisch auf localStorage zurück – gleiches Interface, kein Code-Unterschied.
const storage = (() => {
  if (typeof window !== "undefined" && window.storage && typeof window.storage.get === "function") {
    return window.storage;
  }
  // localStorage-Adapter mit identischem API
  return {
    get:    (key)        => Promise.resolve(localStorage.getItem(key) !== null ? { value: localStorage.getItem(key) } : null),
    set:    (key, value) => { try { localStorage.setItem(key, value); } catch {} return Promise.resolve({ key, value }); },
    delete: (key)        => { localStorage.removeItem(key); return Promise.resolve({ key, deleted: true }); },
  };
})();

// ── [F] Schema-Hash ───────────────────────────────────────────
// SHA-256 über sorted(alle Fragen-IDs) als kompaktes JSON-Array.
// Muss mit SCHEMA_HASH im server.py übereinstimmen.
// Neu berechnen wenn Fragen hinzugefügt/entfernt werden:
//   python3 -c "import hashlib,json; ids=sorted(['Q001',...,'Q108']); print(hashlib.sha256(json.dumps(ids,separators=(',',':')).encode()).hexdigest())"
const SCHEMA_HASH = "d2ef102181a6bb25bdf7afc97f571b30ecaa315053d16f35e378e1c57fa7ee1d";

// Normalisiert alle Felder vor dem Senden:
// - Übersprungene Fragen  → "__skipped__"  (wird server-seitig nicht als Antwort gezählt)
// - Nicht beantwortet    → "__ka__"
function normalizeResponses(responses, sections) {
  const skipped = getSkippedIds(responses);
  const out = { ...responses };
  for (const sec of sections) {
    for (const q of sec.questions) {
      if (skipped.has(q.id)) {
        out[q.id] = SKIP_SENTINEL;
      } else if (out[q.id] === undefined) {
        out[q.id] = KA;
      }
    }
  }
  return out;
}

// ── Skip-Logik ────────────────────────────────────────────────
//
// Unterstützte Operatoren:
//   eq    – depVal === val
//   neq   – depVal !== val
//   lt    – depVal < val  (numerisch)
//   lte   – depVal <= val (numerisch)
//   in    – val ist Array, depVal enthalten
//   notin – val ist Array, depVal nicht enthalten
//
// Regel: skip nur wenn Abhängigkeitsfrage explizit beantwortet wurde
// und die Bedingung zutrifft. KA oder undefined → immer anzeigen.

const SKIP_SENTINEL = "__skipped__";

function shouldSkip(q, resp, alreadySkipped = new Set()) {
  if (!q.skip_if) return false;
  const { q: depId, op, val } = q.skip_if;
  // Wenn die Abhängigkeitsfrage selbst übersprungen wurde → diese auch überspringen
  if (alreadySkipped.has(depId)) return true;
  const depVal = resp[depId];
  // Nicht beantwortet oder Keine Angabe → nie überspringen
  if (depVal === undefined || depVal === KA) return false;
  switch (op) {
    case "eq":          return depVal === val;
    case "neq":         return depVal !== val;
    case "lt":          return typeof depVal === "number" && depVal < val;
    case "lte":         return typeof depVal === "number" && depVal <= val;
    case "in":          return Array.isArray(val) && val.includes(depVal);
    case "notin":       return Array.isArray(val) && !val.includes(depVal);
    case "contains":    return Array.isArray(depVal) && depVal.includes(val);
    case "notcontains": return Array.isArray(depVal) && !depVal.includes(val);
    default:            return false;
  }
}

// Alle Fragen-IDs die aktuell übersprungen werden – iterativ berechnet
// damit Kaskaden (A→B→C) korrekt aufgelöst werden.
function getSkippedIds(resp) {
  const skipped = new Set();
  for (const sec of SECTIONS) {
    for (const q of sec.questions) {
      if (shouldSkip(q, resp, skipped)) skipped.add(q.id);
    }
  }
  return skipped;
}

const LANGUAGES = [
  { code: "de", label: "Deutsch" },
  { code: "en", label: "English" },
  { code: "tr", label: "Türkçe" },
  { code: "uk", label: "Українська" },
  { code: "pl", label: "Polski" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
  { code: "it", label: "Italiano" },
  { code: "ar", label: "العربية" },
  { code: "da", label: "Dansk" },
  { code: "sv", label: "Svenska" },
];

// ── i18n assembled from per-language modules in ./i18n/ ─────
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

const translateQ   = (lang, q)   => { const t = QUESTION_TEXTS[lang]?.[q.id];   return t ? { ...q, ...t } : q; };
const translateSec = (lang, sec) => { const t = SECTION_TEXTS[lang]?.[sec.id];  return t ? { ...sec, ...t } : sec; };

// QuestionCard – hält Tooltip-State lokal, rendert Button und Panel als Geschwister.
// Der Button sitzt in der Kopfzeile (flex), das Panel öffnet sich darunter in voller
// Kartenbreite, sodass der Fragetext nie zusammengeschoben wird.
function QuestionCard({ q, val, onChange, lang, answered }) {
  const [tipOpen, setTipOpen] = useState(false);
  const tipText = useTooltip(lang, q.id);

  return (
    <div style={{
      background: "#fff", borderRadius: "12px",
      border: `1px solid ${answered ? "#bfdbfe" : "#e2e8f0"}`,
      padding: "16px", boxShadow: "0 1px 2px rgba(0,0,0,.04)",
    }}>
      {/* ── Kopfzeile: ID · Fragetext · Info-Button ── */}
      <div style={{ display: "flex", alignItems: "flex-start", marginBottom: tipOpen ? "8px" : "12px" }}>
        <IdBadge id={q.id} />
        <span style={{ fontSize: "14px", fontWeight: "500", color: "#1e293b", lineHeight: "1.6", flex: 1, wordBreak: "break-word" }}>
          {q.text}
        </span>
        {tipText && (
          <button
            onClick={() => setTipOpen(o => !o)}
            aria-expanded={tipOpen}
            title={tipOpen ? (lang === "en" ? "Close explanation" : "Erklärung schließen") : (lang === "en" ? "Show explanation" : "Erklärung anzeigen")}
            style={{
              flexShrink: 0, marginLeft: "8px", marginTop: "1px",
              width: "22px", height: "22px", borderRadius: "50%",
              border: `1px solid ${tipOpen ? "#3b82f6" : "#cbd5e1"}`,
              background: tipOpen ? "#dbeafe" : "#f8fafc",
              color: tipOpen ? "#1d4ed8" : "#94a3b8",
              fontSize: "11px", fontWeight: "700", cursor: "pointer",
              padding: 0, lineHeight: 1,
              display: "inline-flex", alignItems: "center", justifyContent: "center",
              transition: "border-color .15s, background .15s",
            }}
          >
            i
          </button>
        )}
      </div>

      {/* ── Tooltip-Panel: volle Breite, unter Fragetext, über Antworten ── */}
      {tipText && (
        <div style={{
          overflow: "hidden",
          maxHeight: tipOpen ? "400px" : "0",
          opacity: tipOpen ? 1 : 0,
          marginBottom: tipOpen ? "12px" : "0",
          transition: "max-height .3s ease, opacity .2s ease, margin-bottom .3s ease",
        }}>
          <div style={{
            padding: "10px 13px",
            background: "#f0f9ff", border: "1px solid #bae6fd",
            borderRadius: "8px", fontSize: "12px", color: "#0c4a6e",
            lineHeight: "1.7", wordBreak: "break-word",
          }}>
            {tipText}
          </div>
        </div>
      )}

      {/* ── Antwort-Input ── */}
      <QInput q={q} val={val} onChange={onChange} />
    </div>
  );
}

const PARTIES = [
  {abbr:"CDU",         full:"Christlich Demokratische Union Deutschlands"},
  {abbr:"CSU",         full:"Christlich-Soziale Union in Bayern"},
  {abbr:"SPD",         full:"Sozialdemokratische Partei Deutschlands"},
  {abbr:"Grüne",       full:"Bündnis 90/Die Grünen"},
  {abbr:"FDP",         full:"Freie Demokratische Partei"},
  {abbr:"AfD",         full:"Alternative für Deutschland"},
  {abbr:"BSW",         full:"Bündnis Sahra Wagenknecht"},
  {abbr:"Linke",       full:"Die Linke"},
  {abbr:"Freie Wähler",full:"FREIE WÄHLER"},
  {abbr:"Volt",        full:"Volt Deutschland"},
  {abbr:"SSW",         full:"Südschleswigscher Wählerverband"},
  {abbr:"Piraten",     full:"Piratenpartei Deutschland"},
  {abbr:"ÖDP",         full:"Ökologisch-Demokratische Partei"},
  {abbr:"Tierschutzpartei",full:"Partei Mensch Umwelt Tierschutz"},
  {abbr:"Die PARTEI",  full:"Partei für Arbeit, Rechtsstaat, Tierschutz, Elitenförderung und basisdemokratische Initiative"},
  {abbr:"Humanisten",  full:"Die Humanisten"},
  {abbr:"WerteUnion",  full:"WerteUnion"},
  {abbr:"Bündnis Deutschland",full:"Bündnis Deutschland"},
  {abbr:"Die Basis",   full:"Basisdemokratische Partei Deutschland"},
  {abbr:"MLPD",        full:"Marxistisch-Leninistische Partei Deutschlands"},
  {abbr:"DKP",         full:"Deutsche Kommunistische Partei"},
  {abbr:"Die Heimat",  full:"Die Heimat (ehem. NPD)"},
  {abbr:"BIG",         full:"Bündnis für Innovation & Gerechtigkeit"},
  {abbr:"MERA25",      full:"MERA25 – Bewegung für Demokratie in Europa"},
  {abbr:"Bündnis C",   full:"Bündnis C – Christen für Deutschland"},
  {abbr:"DSU",         full:"Deutsche Soziale Union"},
  {abbr:"APPD",        full:"Anarchistische Pogo-Partei Deutschlands"},
  {abbr:"Gesundheitsforschung",full:"Partei für Gesundheitsforschung"},
  {abbr:"LIEBE",       full:"Partei LIEBE"},
];

const match = (p, q) => {
  const lq = q.toLowerCase();
  return p.abbr.toLowerCase().includes(lq) || p.full.toLowerCase().includes(lq);
};

// ── PartyCombobox (single) ────────────────────────────────────

function PartyCombobox({val, onChange, extras=[]}) {
  const [query, setQuery] = useState("");
  const [open, setOpen]   = useState(false);
  const [hov, setHov]     = useState(null);

  const filtered = query.length > 0 ? PARTIES.filter(p => match(p, query)) : PARTIES;
  const isKA     = val === KA;
  const display  = val && !isKA ? val : "";

  const select = v => { onChange(v); setQuery(""); setOpen(false); };

  const row = key => ({
    padding:"8px 12px", cursor:"pointer", fontSize:"13px",
    display:"flex", gap:"10px", alignItems:"baseline",
    background: hov===key ? "#f1f5f9" : "transparent"
  });

  return (
    <div style={{position:"relative"}}>
      <div style={{position:"relative"}}>
        <input type="text"
          value={open ? query : display}
          onChange={e => { setQuery(e.target.value); setOpen(true); onChange(undefined); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 180)}
          placeholder={isKA ? "— Keine Angabe —" : "Partei suchen oder tippen…"}
          style={{
            width:"100%", padding:"9px 36px 9px 12px",
            border:`1px solid ${val && !isKA ? "#93c5fd" : "#e2e8f0"}`,
            borderRadius:"8px", fontSize:"13px", outline:"none",
            boxSizing:"border-box", fontFamily:"inherit",
            background: isKA ? "#f8fafc" : "#fff",
            color: isKA ? "#94a3b8" : "#1e293b"
          }} />
        {val && !isKA && (
          <button onMouseDown={e => { e.preventDefault(); onChange(undefined); setQuery(""); }}
            style={{position:"absolute",right:"10px",top:"50%",transform:"translateY(-50%)",border:"none",background:"none",color:"#94a3b8",cursor:"pointer",fontSize:"14px",padding:0}}>
            ✕
          </button>
        )}
      </div>

      {open && (
        <div style={{position:"absolute",top:"calc(100% + 3px)",left:0,right:0,maxHeight:"220px",overflowY:"auto",background:"#fff",border:"1px solid #e2e8f0",borderRadius:"8px",boxShadow:"0 6px 20px rgba(0,0,0,.1)",zIndex:200}}>
          {filtered.length === 0 && (
            <div style={{padding:"10px 12px",fontSize:"13px",color:"#94a3b8",fontStyle:"italic"}}>
              Nicht in Liste – Freitexteingabe möglich (Enter bestätigt)
            </div>
          )}
          {filtered.map(p => (
            <div key={p.abbr}
              onMouseDown={e => { e.preventDefault(); select(p.abbr); }}
              onMouseEnter={() => setHov(p.abbr)} onMouseLeave={() => setHov(null)}
              style={row(p.abbr)}>
              <span style={{fontWeight:"700",color:"#1d4ed8",minWidth:"130px",flexShrink:0}}>{p.abbr}</span>
              <span style={{color:"#64748b",fontSize:"11px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.full}</span>
            </div>
          ))}
          {extras.length > 0 && (
            <div style={{borderTop:"1px solid #f1f5f9"}}>
              {extras.map(e => (
                <div key={e}
                  onMouseDown={ev => { ev.preventDefault(); select(e); }}
                  onMouseEnter={() => setHov(e)} onMouseLeave={() => setHov(null)}
                  style={{...row(e), color:"#64748b", fontStyle:"italic"}}>
                  {e}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <KABtn active={isKA} onClick={() => { onChange(KA); setOpen(false); setQuery(""); }} />
    </div>
  );
}

// ── PartyMultiCombobox (coalition builder) ────────────────────

const CHIP_COLORS = ["#dbeafe","#dcfce7","#fef3c7","#fce7f3","#ede9fe","#ffedd5","#f0f9ff","#fef9c3"];

function PartyMultiCombobox({val=[], onChange}) {
  const selected = Array.isArray(val) ? val.filter(v => v !== KA) : [];
  const isKA     = val === KA || (Array.isArray(val) && val.includes(KA));
  const [query, setQuery] = useState("");
  const [open, setOpen]   = useState(false);
  const [hov, setHov]     = useState(null);

  const filtered = (query.length > 0 ? PARTIES.filter(p => match(p, query)) : PARTIES)
    .filter(p => !selected.includes(p.abbr));

  const add = abbr => { onChange([...selected, abbr]); setQuery(""); };
  const remove = abbr => onChange(selected.filter(a => a !== abbr));

  return (
    <div>
      {selected.length > 0 && (
        <div style={{display:"flex",flexWrap:"wrap",gap:"5px",marginBottom:"10px"}}>
          {selected.map((abbr, i) => (
            <span key={abbr} style={{display:"inline-flex",alignItems:"center",gap:"4px",padding:"4px 10px",borderRadius:"99px",fontSize:"12px",fontWeight:"600",background:CHIP_COLORS[i%CHIP_COLORS.length],color:"#1e293b"}}>
              {abbr}
              <button onMouseDown={e => { e.preventDefault(); remove(abbr); }}
                style={{border:"none",background:"none",cursor:"pointer",padding:"0 1px",fontSize:"13px",color:"#64748b",lineHeight:1}}>×</button>
            </span>
          ))}
        </div>
      )}

      {!isKA && (
        <div style={{position:"relative"}}>
          <input type="text" value={query}
            onChange={e => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 180)}
            placeholder="Partei zur Koalition hinzufügen…"
            style={{width:"100%",padding:"9px 12px",border:"1px solid #e2e8f0",borderRadius:"8px",fontSize:"13px",outline:"none",boxSizing:"border-box",fontFamily:"inherit"}} />

          {open && (
            <div style={{position:"absolute",top:"calc(100% + 3px)",left:0,right:0,maxHeight:"180px",overflowY:"auto",background:"#fff",border:"1px solid #e2e8f0",borderRadius:"8px",boxShadow:"0 6px 20px rgba(0,0,0,.1)",zIndex:200}}>
              {filtered.length === 0
                ? <div style={{padding:"10px 12px",fontSize:"13px",color:"#94a3b8",fontStyle:"italic"}}>Alle passenden Parteien hinzugefügt</div>
                : filtered.map(p => (
                    <div key={p.abbr}
                      onMouseDown={e => { e.preventDefault(); add(p.abbr); }}
                      onMouseEnter={() => setHov(p.abbr)} onMouseLeave={() => setHov(null)}
                      style={{padding:"8px 12px",cursor:"pointer",fontSize:"13px",display:"flex",gap:"10px",alignItems:"baseline",background:hov===p.abbr?"#f1f5f9":"transparent"}}>
                      <span style={{fontWeight:"700",color:"#1d4ed8",minWidth:"130px",flexShrink:0}}>{p.abbr}</span>
                      <span style={{color:"#64748b",fontSize:"11px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.full}</span>
                    </div>
                  ))
              }
            </div>
          )}
        </div>
      )}

      <KABtn active={isKA} onClick={() => onChange(isKA ? [] : [KA])} />
    </div>
  );
}

// ── PoliticianCombobox ────────────────────────────────────────

const POLITICIANS = [
  // Bundesebene
  {name:"Friedrich Merz",        info:"CDU – Bundeskanzler"},
  {name:"Olaf Scholz",           info:"SPD – ehem. Bundeskanzler"},
  {name:"Robert Habeck",         info:"Grüne"},
  {name:"Annalena Baerbock",     info:"Grüne"},
  {name:"Christian Lindner",     info:"FDP"},
  {name:"Alice Weidel",          info:"AfD"},
  {name:"Tino Chrupalla",        info:"AfD"},
  {name:"Sahra Wagenknecht",     info:"BSW"},
  {name:"Karl Lauterbach",       info:"SPD"},
  {name:"Boris Pistorius",       info:"SPD"},
  {name:"Lars Klingbeil",        info:"SPD"},
  {name:"Saskia Esken",          info:"SPD"},
  {name:"Omid Nouripour",        info:"Grüne"},
  {name:"Ricarda Lang",          info:"Grüne"},
  {name:"Wolfgang Kubicki",      info:"FDP"},
  {name:"Marco Buschmann",       info:"FDP"},
  {name:"Dietmar Bartsch",       info:"Linke"},
  {name:"Janine Wissler",        info:"Linke"},
  {name:"Markus Söder",          info:"CSU – Bayern"},
  {name:"Hubert Aiwanger",       info:"Freie Wähler – Bayern"},
  // Landesebene
  {name:"Peter Tschentscher",    info:"SPD – Hamburg"},
  {name:"Kai Wegner",            info:"CDU – Berlin"},
  {name:"Hendrik Wüst",          info:"CDU – Nordrhein-Westfalen"},
  {name:"Boris Rhein",           info:"CDU – Hessen"},
  {name:"Winfried Kretschmann",  info:"Grüne – Baden-Württemberg"},
  {name:"Manuela Schwesig",      info:"SPD – Mecklenburg-Vorpommern"},
  {name:"Dietmar Woidke",        info:"SPD – Brandenburg"},
  {name:"Daniel Günther",        info:"CDU – Schleswig-Holstein"},
  {name:"Mario Voigt",           info:"CDU – Thüringen"},
  {name:"Peter Hauk",            info:"CDU – Baden-Württemberg"},
  {name:"Andreas Bovenschulte",  info:"SPD – Bremen"},
  {name:"Stephan Weil",          info:"SPD – Niedersachsen"},
  // International
  {name:"Donald Trump",          info:"USA – Präsident"},
  {name:"Kamala Harris",         info:"USA"},
  {name:"Bernie Sanders",        info:"USA"},
  {name:"Emmanuel Macron",       info:"Frankreich – Präsident"},
  {name:"Marine Le Pen",         info:"Frankreich"},
  {name:"Giorgia Meloni",        info:"Italien – Premierministerin"},
  {name:"Viktor Orbán",          info:"Ungarn – Premierminister"},
  {name:"Papst Franziskus",      info:"Vatikan"},
  {name:"Ursula von der Leyen",  info:"EU-Kommissionspräsidentin"},
  {name:"Volodymyr Zelensky",    info:"Ukraine – Präsident"},
  {name:"Vladimir Putin",        info:"Russland – Präsident"},
  {name:"Xi Jinping",            info:"China – Staatschef"},
  {name:"Benjamin Netanyahu",    info:"Israel – Premierminister"},
  {name:"Elon Musk",             info:"USA – Unternehmer"},
];

const matchPolitician = (p, q) => {
  const lq = q.toLowerCase();
  return p.name.toLowerCase().includes(lq) || p.info.toLowerCase().includes(lq);
};

function PoliticianCombobox({val, onChange}) {
  const [query, setQuery] = useState("");
  const [open, setOpen]   = useState(false);
  const [hov, setHov]     = useState(null);

  const filtered = query.length > 0 ? POLITICIANS.filter(p => matchPolitician(p, query)) : POLITICIANS;
  const isKA     = val === KA;
  const display  = val && !isKA ? val : "";

  const select = v => { onChange(v); setQuery(""); setOpen(false); };

  const row = key => ({
    padding:"8px 12px", cursor:"pointer", fontSize:"13px",
    display:"flex", gap:"10px", alignItems:"baseline",
    background: hov===key ? "#f1f5f9" : "transparent"
  });

  return (
    <div style={{position:"relative"}}>
      <div style={{position:"relative"}}>
        <input type="text"
          value={open ? query : display}
          onChange={e => { setQuery(e.target.value); setOpen(true); onChange(undefined); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 180)}
          onKeyDown={e => { if (e.key === "Enter" && query.trim()) { select(query.trim()); e.preventDefault(); } }}
          placeholder={isKA ? "— Keine Angabe —" : "Name suchen oder eingeben…"}
          style={{
            width:"100%", padding:"9px 36px 9px 12px",
            border:`1px solid ${val && !isKA ? "#93c5fd" : "#e2e8f0"}`,
            borderRadius:"8px", fontSize:"13px", outline:"none",
            boxSizing:"border-box", fontFamily:"inherit",
            background: isKA ? "#f8fafc" : "#fff",
            color: isKA ? "#94a3b8" : "#1e293b"
          }} />
        {val && !isKA && (
          <button onMouseDown={e => { e.preventDefault(); onChange(undefined); setQuery(""); }}
            style={{position:"absolute",right:"10px",top:"50%",transform:"translateY(-50%)",border:"none",background:"none",color:"#94a3b8",cursor:"pointer",fontSize:"14px",padding:0}}>
            ✕
          </button>
        )}
      </div>

      {open && (
        <div style={{position:"absolute",top:"calc(100% + 3px)",left:0,right:0,maxHeight:"220px",overflowY:"auto",background:"#fff",border:"1px solid #e2e8f0",borderRadius:"8px",boxShadow:"0 6px 20px rgba(0,0,0,.1)",zIndex:200}}>
          {filtered.length === 0 && (
            <div style={{padding:"10px 12px",fontSize:"13px",color:"#94a3b8",fontStyle:"italic"}}>
              Nicht in Liste – Freitexteingabe möglich (Enter bestätigt)
            </div>
          )}
          {filtered.map(p => (
            <div key={p.name}
              onMouseDown={e => { e.preventDefault(); select(p.name); }}
              onMouseEnter={() => setHov(p.name)} onMouseLeave={() => setHov(null)}
              style={row(p.name)}>
              <span style={{fontWeight:"600",color:"#1d4ed8",minWidth:"180px",flexShrink:0}}>{p.name}</span>
              <span style={{color:"#64748b",fontSize:"11px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.info}</span>
            </div>
          ))}
        </div>
      )}

      <KABtn active={isKA} onClick={() => { onChange(KA); setOpen(false); setQuery(""); }} />
    </div>
  );
}

// ── Survey sections data ──────────────────────────────────────

const SECTIONS = [
  {id:"S01",title:"Soziodemographie",questions:[
    {id:"Q001",text:"Wie alt sind Sie?",type:"number",unit:"Jahre",min:16,max:110},
    {id:"Q002",text:"Welchem Geschlecht fühlen Sie sich zugehörig?",type:"radio",opts:["Männlich","Weiblich","Divers","Nicht-binär","Genderfluid","Sonstiges"]},
    {id:"Q003",text:"Welches Geschlecht wurde Ihnen bei der Geburt zugewiesen?",type:"radio",opts:["Männlich","Weiblich","Divers/Inter"]},
    {id:"Q122",text:"Romantische / sexuelle Orientierung:",type:"radio",opts:["Heterosexuell / heteroromantisch","Homosexuell / homoromantisch (schwul/lesbisch)","Bisexuell / biromantisch","Pansexuell / panromantisch","Asexuell / aromantisch","Demisexuell / demiroromantisch","Queer (nicht näher spezifiziert)","Sonstiges"]},
    {id:"Q004",text:"In welchem Bundesland wohnen Sie?",type:"radio",opts:["Baden-Württemberg","Bayern","Berlin","Brandenburg","Bremen","Hamburg","Hessen","Mecklenburg-Vorpommern","Niedersachsen","Nordrhein-Westfalen","Rheinland-Pfalz","Saarland","Sachsen","Sachsen-Anhalt","Schleswig-Holstein","Thüringen","Außerhalb Deutschlands"]},
    {id:"Q005",text:"Wie groß ist Ihre Wohngemeinde?",type:"radio",opts:["< 5.000 (Dorf)","5.000–20.000 (Kleinstadt)","20.000–100.000 (Mittelstadt)","100.000–500.000 (Großstadt)","> 500.000 (Metropole)"]},
    {id:"Q121",text:"Postleitzahl Ihres Wohnorts:",type:"plz"},
    {id:"Q006",text:"Wie groß ist Ihr Arbeitsort?",type:"radio",opts:["< 5.000","5.000–20.000","20.000–100.000","100.000–500.000","> 500.000","Homeoffice / kein fester Ort","Nicht erwerbstätig"]},
    {id:"Q007",text:"Höchster Schulabschluss?",type:"radio",opts:["Kein Abschluss","Hauptschulabschluss","Mittlere Reife","Fachhochschulreife","Abitur","Noch in Schulausbildung"]},
    {id:"Q008",text:"Hochschulabschluss?",type:"radio",opts:["Nein","Bachelor","Master / Diplom / Magister","Promotion","Noch im Studium"]},
    {id:"Q009",text:"Berufs- oder Handwerksausbildung?",type:"radio",opts:["Nein","Ja, abgeschlossen","In Ausbildung","Meister / Techniker"]},
    {id:"Q010",text:"Berufsstatus (Mehrfachauswahl – alles Zutreffende):",type:"check",opts:["Vollzeit (Angestellt)","Teilzeit (Angestellt)","Werkstudent:in","Minijob / Nebenjob","Selbstständig","Beamt:in","Ausbildung / Studium","Arbeitssuchend","Elternzeit / Familienarbeit","Rentner:in / Pensioniert","Sonstiges"]},
    {id:"Q011",text:"Tätigkeitssektor?",type:"radio",opts:["Öffentlicher Dienst","Privater Sektor","Non-Profit / NGO","Selbstständig ohne AN","Nicht anwendbar"]},
  ]},
  {id:"S02",title:"Familie & Haushalt",questions:[
    {id:"Q012",text:"Beziehungsstatus?",type:"radio",opts:["Single","In Beziehung (nicht zusammenlebend)","Zusammenlebend (unverheiratet)","Verheiratet","Eingetragene Lebenspartnerschaft","Getrennt lebend","Geschieden","Verwitwet"]},
    {id:"Q013",text:"Haushaltsform?",type:"radio",opts:["Alleinlebend","Paar ohne Kinder","Kernfamilie","Patchworkfamilie","Mehrgenerationenhaushalt","Alleinerziehend","WG","Sonstiges"]},
    {id:"Q014",text:"Anzahl Kinder im Haushalt?",type:"number",unit:"Kinder",min:0,max:15},
    {id:"Q015",text:"Altersgruppen der Kinder im Haushalt:",type:"check",opts:["< 3 Jahre","3–6 Jahre","6–12 Jahre","12–18 Jahre","18+ (noch im HH)"],skip_if:{q:"Q014",op:"eq",val:0}},
    {id:"Q016",text:"Kinder außerhalb des Haushalts?",type:"radio",opts:["Nein","Ja, 1","Ja, 2","Ja, 3 oder mehr"]},
    {id:"Q017",text:"Pflegeaufgaben für Angehörige?",type:"radio",opts:["Nein","Ja, gelegentlich","Ja, regelmäßig","Ja, Hauptpflegeperson"]},
    {id:"Q018",text:"Anteil an Haus- und Sorgearbeit im Haushalt?",type:"radio",opts:["< 20 %","20–40 %","40–60 % (ca. gleich)","60–80 %","> 80 %","Alleinlebend / n.a."]},
    {id:"Q179",text:"Wie sehr machen Ihnen der Rückgang der Geburtenrate Sorgen?",type:"likert5",left:"Keine Sorgen",right:"Große Sorgen",group_header:"Geburtenrate:"},
    {id:"Q180",text:"Welche Maßnahmen halten Sie für sinnvoll, um die Geburtenrate zu verbessern? (Mehrfachauswahl)",type:"check",opts:["Bessere Kinderbetreuung (Kita-Ausbau, Kosten)","Höheres Elterngeld / Kindergeld","Flexiblere Arbeitszeiten für Eltern","Günstigerer Wohnraum für Familien","Gleichere Verteilung von Sorgearbeit zwischen den Geschlechtern","Kostenfreie Bildung (Schule, Hochschule)","Steuerliche Entlastung für Familien","Bessere Vereinbarkeit von Karriere und Familie","Keine – der Staat sollte sich nicht einmischen","Sonstiges"]},
    {id:"Q181",text:'„Eine ungleiche Verteilung von Familien- und Sorgearbeit zwischen Frauen und Männern ist eine wesentliche Ursache für die niedrige Geburtenrate."',type:"likert5",left:"Stimme gar nicht zu",right:"Stimme voll zu"},
  ]},
  {id:"S03",title:"Wirtschaft & Finanzen",questions:[
    {id:"Q019",text:"Monatliches Haushaltsnettoeinkommen?",type:"radio",opts:["< 1.000 €","1.000–1.500 €","1.500–2.000 €","2.000–2.500 €","2.500–3.000 €","3.000–4.000 €","4.000–5.000 €","5.000–7.500 €","7.500–10.000 €","> 10.000 €"]},
    {id:"Q020",text:"Geschätztes Nettovermögen (Immobilien + Ersparnisse + Aktien – Schulden)?",type:"radio",opts:["Negativ","0–10.000 €","10.000–50.000 €","50.000–150.000 €","150.000–300.000 €","300.000–500.000 €","500.000 €–1 Mio.","1–2 Mio. €","> 2 Mio. €"]},
    {id:"Q021",text:"Schulden (ohne laufende Hypothek)?",type:"radio",opts:["Keine","< 5.000 €","5.000–20.000 €","20.000–50.000 €","> 50.000 €"]},
    {id:"Q022",text:"Staatliche Transferleistungen (Mehrfachauswahl)?",type:"check",opts:["Keine","Bürgergeld","Wohngeld","Kindergeld","BAföG","Elterngeld","Pflegegeld","Erwerbsminderungsrente","Sonstige"]},
    {id:"Q023",text:"Wohnsituation?",type:"radio",opts:["Miete","Eigentum (abbezahlt)","Eigentum (Kredit läuft)","Mietfrei (z.B. Familie)","Obdachlos","Sonstiges"]},
    {id:"Q024",text:"Mietbelastung (% des HH-Einkommens)?",type:"radio",opts:["< 20 %","20–30 %","30–40 %","40–50 %","> 50 %","Eigentümer, keine Miete"],skip_if:{q:"Q023",op:"in",val:["Eigentum (abbezahlt)","Eigentum (Kredit läuft)","Obdachlos"]}},
    {id:"Q025",text:"Finanzielle Lage heute vs. vor 5 Jahren?",type:"likert5",left:"Stark verschlechtert",right:"Stark verbessert"},
    {id:"Q026",text:"Erwartung für die nächsten 5 Jahre?",type:"likert5",left:"Stark verschlechtern",right:"Stark verbessern"},
    {id:"Q027",text:"Im Vergleich zu Eltern im gleichen Alter?",type:"likert5",left:"Deutlich schlechter",right:"Deutlich besser"},
    {id:"Q028",text:"Gewerkschaftsmitglied?",type:"radio",opts:["Nein","Ja, aktiv","Ja, passiv"]},
  ]},
  {id:"S04",title:"Politische Orientierung",questions:[
    {id:"Q029",text:"Politische Grundhaltung:",type:"slider7",left:"Sehr konservativ",right:"Sehr progressiv",note:"Konservativ = Bewahrung; Progressiv = Wandel, Erneuerung"},
    {id:"Q030",text:"Haltung zu staatlicher Autorität:",type:"slider7",left:"Sehr autoritär",right:"Sehr libertär",note:"Autoritär = starker Staat, kollektive Werte; Libertär = individuelle Freiheit"},
    {id:"Q031",text:'„Politiker müssen immer den Willen des Volkes umsetzen."',type:"likert5",left:"Stimme gar nicht zu",right:"Stimme voll zu",group_header:"Populismus-Skala – Wie sehr stimmen Sie folgenden Aussagen zu?"},
    {id:"Q032",text:'„Das Volk, nicht Politiker, sollte die wichtigsten Entscheidungen treffen."',type:"likert5",left:"Stimme gar nicht zu",right:"Stimme voll zu"},
    {id:"Q033",text:'„Die Kluft zwischen normalen Bürgern und der Elite ist größer als zwischen den Bürgern selbst."',type:"likert5",left:"Stimme gar nicht zu",right:"Stimme voll zu"},
    {id:"Q034",text:'„Ich würde lieber von normalen Bürgern als von Berufspolitikern regiert werden."',type:"likert5",left:"Stimme gar nicht zu",right:"Stimme voll zu"},
    {id:"Q035",text:'„Gewählte Amtsträger reden zu viel und handeln zu wenig."',type:"likert5",left:"Stimme gar nicht zu",right:"Stimme voll zu"},
    {id:"Q036",text:'„Was man Kompromiss nennt, ist Verrat an den eigenen Prinzipien."',type:"likert5",left:"Stimme gar nicht zu",right:"Stimme voll zu"},
    {id:"Q037",text:"Bundestagswahl 2025 – Zweitstimme:",type:"party_single",extras:["Nicht gewählt","Nicht wahlberechtigt"],group_header:"Wahlverhalten:",skip_if:{q:"Q109",op:"eq",val:"Nein"}},
    {id:"Q038",text:"Wenn morgen Bundestagswahl: Wen würden Sie wählen?",type:"party_single",extras:["Würde nicht wählen","Ungültig wählen"]},
    {id:"Q039",text:"Wie sicher sind Sie bei dieser Wahlentscheidung?",type:"likert5",left:"Sehr unsicher",right:"Sehr sicher"},
    {id:"Q178",text:"Warum würden Sie diese Partei wählen?",type:"text",skip_if:{q:"Q038",op:"in",val:["Würde nicht wählen","Ungültig wählen"]}},
    {id:"Q040",text:"Koalitionspräferenz – welche Parteien sollten regieren?",type:"party_multi"},
  ]},
  {id:"S05",title:"Parteikompetenz",description:"Welcher Partei trauen Sie bei den folgenden Themen am meisten Kompetenz zu?",questions:[
    {id:"Q041",text:"Wirtschaft & Arbeitsmarkt",type:"party_single",extras:["Keiner","Weiß nicht"]},
    {id:"Q042",text:"Innere Sicherheit & Kriminalität",type:"party_single",extras:["Keiner","Weiß nicht"]},
    {id:"Q043",text:"Klimaschutz & Umwelt",type:"party_single",extras:["Keiner","Weiß nicht"]},
    {id:"Q044",text:"Bildung & Schule",type:"party_single",extras:["Keiner","Weiß nicht"]},
    {id:"Q045",text:"Migration & Integration",type:"party_single",extras:["Keiner","Weiß nicht"]},
    {id:"Q046",text:"Soziale Gerechtigkeit & Sozialpolitik",type:"party_single",extras:["Keiner","Weiß nicht"]},
    {id:"Q047",text:"Außen- & Verteidigungspolitik",type:"party_single",extras:["Keiner","Weiß nicht"]},
    {id:"Q048",text:"Digitalisierung & Technologie",type:"party_single",extras:["Keiner","Weiß nicht"]},
    {id:"Q049",text:"Gesundheit & Pflege",type:"party_single",extras:["Keiner","Weiß nicht"]},
  ]},
  {id:"S06",title:"Zufriedenheit & Vertrauen",questions:[
    {id:"Q050",text:"Zufriedenheit mit der aktuellen Bundesregierung:",type:"likert5",left:"Sehr unzufrieden",right:"Sehr zufrieden"},
    {id:"Q051",text:"Zufriedenheit mit der Demokratie als politischem System:",type:"likert5",left:"Sehr unzufrieden",right:"Sehr zufrieden"},
    {id:"Q052",text:"Was stört Sie am meisten an der aktuellen Politik?",type:"text"},
    {id:"Q053",text:"Bundesverfassungsgericht",type:"likert5",left:"Kein Vertrauen",right:"Volles Vertrauen",group_header:"Institutionenvertrauen – Wie viel Vertrauen haben Sie in folgende Institutionen?"},
    {id:"Q054",text:"Polizei",type:"likert5",left:"Kein Vertrauen",right:"Volles Vertrauen"},
    {id:"Q055",text:"Bundestag",type:"likert5",left:"Kein Vertrauen",right:"Volles Vertrauen"},
    {id:"Q056",text:"Öffentlich-rechtliche Medien (ARD, ZDF, ...)",type:"likert5",left:"Kein Vertrauen",right:"Volles Vertrauen"},
    {id:"Q057",text:"Privatmedien (Tageszeitungen, privates TV)",type:"likert5",left:"Kein Vertrauen",right:"Volles Vertrauen"},
    {id:"Q058",text:"Bundeswehr",type:"likert5",left:"Kein Vertrauen",right:"Volles Vertrauen"},
    {id:"Q059",text:"Europäische Union",type:"likert5",left:"Kein Vertrauen",right:"Volles Vertrauen"},
    {id:"Q060",text:"Kirchen / Religionsgemeinschaften",type:"likert5",left:"Kein Vertrauen",right:"Volles Vertrauen"},
    {id:"Q061",text:"Wissenschaft / Universitäten",type:"likert5",left:"Kein Vertrauen",right:"Volles Vertrauen"},
    {id:"Q062",text:'„Den meisten Menschen kann man vertrauen."',type:"likert5",left:"Stimme gar nicht zu",right:"Stimme voll zu",group_header:"Interpersonales Vertrauen:"},
    {id:"Q063",text:"Hauptinformationsquellen für Politik (Mehrfachauswahl):",type:"check",opts:["Öff.-rechtl. TV/Radio","Privates TV/Radio","Überreg. Tageszeitungen","Regionale Tageszeitungen","Nachrichtenmagazine","Social Media (TikTok, Instagram)","X / Twitter","YouTube / Podcasts","Freunde / Familie","Sonstiges"]},
  ]},
  {id:"S07",title:"Themen & Einstellungen",questions:[
    {id:"Q064",text:"Die drei wichtigsten Probleme in Deutschland, die Sie beschäftigen:",type:"text"},
    {id:"Q065",text:"Sicherheitsgefühl im Wohnumfeld:",type:"likert5",left:"Sehr unsicher",right:"Sehr sicher"},
    {id:"Q066",text:"Haltung zu staatlicher Umverteilung vs. Eigenverantwortung:",type:"slider7",left:"Maximale Umverteilung",right:"Maximale Eigenverantwortung"},
    {id:"Q067",text:"Politisches Engagement in den letzten 2 Jahren (Mehrfachauswahl):",type:"check",opts:["Gewählt","Demonstriert","Petition unterzeichnet","Partei/Verein beigetreten","Politiker:in kontaktiert","Online-Aktivismus","Keines davon"]},
  ]},
  {id:"S08",title:"Energie & Mobilität",questions:[
    {id:"Q068",text:"Position zu Atomkraft (Weiterbetrieb / Neubau):",type:"likert5",left:"Klar dagegen",right:"Klar dafür"},
    {id:"Q069",text:"Position zu erneuerbaren Energien (Ausbau Wind/Solar):",type:"likert5",left:"Klar dagegen",right:"Klar dafür"},
    {id:"Q070",text:"Position zu fossilen Brennstoffen (Beibehaltung in der Energieversorgung):",type:"likert5",left:"Klar dagegen",right:"Klar dafür"},
    {id:"Q071",text:"Position zu Elektromobilität (Förderung, Ladeinfrastruktur):",type:"likert5",left:"Klar dagegen",right:"Klar dafür"},
    {id:"Q072",text:"Aktuelles Heizsystem im Haushalt:",type:"radio",opts:["Erdgas","Heizöl","Fernwärme","Wärmepumpe","Holz / Pellets","Nachtspeicher / Direktstrom","Sonstiges","Weiß nicht"]},
    {id:"Q073",text:"Position zur Pflicht, beim Heizungsaustausch auf klimafreundliche Systeme umzustellen:",type:"likert5",left:"Klar dagegen",right:"Klar dafür"},
    {id:"Q074",text:"Position zu einem generellen Tempolimit auf Autobahnen:",type:"radio",opts:["Dagegen (kein Tempolimit)","Dafür (100 km/h)","Dafür (120 km/h)","Dafür (130 km/h)","Unentschieden"]},
    {id:"Q075",text:"Wie oft nutzen Sie Bahn / ÖPNV statt Auto?",type:"radio",opts:["Kein Auto, fahre ohnehin Bahn","Selten Bahn","Manchmal Bahn","Oft Bahn","Fast immer Bahn","Kein Auto, nutze kaum ÖPNV"]},
    {id:"Q076",text:"Würden Sie mehr Bahn fahren, wenn Tickets deutlich günstiger wären?",type:"likert5",left:"Sicher nicht",right:"Sicher ja"},
    {id:"Q077",text:"Würden Sie mehr Bahn fahren, wenn Tickets kostenlos wären?",type:"likert5",left:"Sicher nicht",right:"Sicher ja"},
    {id:"Q078",text:"Würden Sie mehr Bahn fahren, wenn die Bahn deutlich zuverlässiger wäre?",type:"likert5",left:"Sicher nicht",right:"Sicher ja"},
  ]},
  {id:"S09",title:"Geopolitik",description:"Hinweis: Die Fragen beziehen sich auf die jeweilige Regierung bzw. Amtsperson – nicht auf das Land oder seine Bevölkerung.",questions:[
    {id:"Q079",text:"Russische Regierung",type:"likert5",left:"Sehr negativ",right:"Sehr positiv",group_header:"Bitte bewerten Sie folgende Regierungen / Staatsoberhäupter:"},
    {id:"Q080",text:"Wladimir Putin",type:"likert5",left:"Sehr negativ",right:"Sehr positiv"},
    {id:"Q081",text:"US-amerikanische Regierung",type:"likert5",left:"Sehr negativ",right:"Sehr positiv"},
    {id:"Q082",text:"Donald Trump",type:"likert5",left:"Sehr negativ",right:"Sehr positiv"},
    {id:"Q083",text:"Israelische Regierung",type:"likert5",left:"Sehr negativ",right:"Sehr positiv"},
    {id:"Q084",text:"Benjamin Netanyahu",type:"likert5",left:"Sehr negativ",right:"Sehr positiv"},
    {id:"Q085",text:"Palästinensische Autonomiebehörde (PA)",type:"likert5",left:"Sehr negativ",right:"Sehr positiv"},
    {id:"Q086",text:"Hamas (politisch-militärische Führung Gaza)",type:"likert5",left:"Sehr negativ",right:"Sehr positiv"},
    {id:"Q087",text:"Chinesische Regierung",type:"likert5",left:"Sehr negativ",right:"Sehr positiv"},
    {id:"Q088",text:"Xi Jinping",type:"likert5",left:"Sehr negativ",right:"Sehr positiv"},
    {id:"Q089",text:"Taiwanesische Regierung",type:"likert5",left:"Sehr negativ",right:"Sehr positiv"},
    {id:"Q090",text:"Europäische Union als politisches Projekt",type:"likert5",left:"Sehr negativ",right:"Sehr positiv"},
    {id:"Q091",text:"EU-Kommission (aktuelle Führung)",type:"likert5",left:"Sehr negativ",right:"Sehr positiv"},
    {id:"Q092",text:"Position zum Ukraine-Krieg (Mehrfachauswahl):",type:"check",opts:["DE sollte weiter Waffen liefern","DE sollte keine Waffen liefern","Sofortige Verhandlungen (auch mit Gebietsabgaben)","Erst Verhandlungen nach russ. Rückzug","DE engagiert sich zu stark","DE sollte sich stärker engagieren","Weiß nicht / unentschieden"]},
  ]},
  {id:"S10",title:"Religion & Weltanschauung",questions:[
    {id:"Q093",text:"Religiöse Zugehörigkeit:",type:"radio",opts:["Keine (konfessionslos/atheistisch)","Römisch-katholisch","Evangelisch (EKD)","Andere christliche Gemeinschaft","Islamisch (sunnitisch)","Islamisch (schiitisch/andere)","Jüdisch","Buddhistisch","Hinduistisch","Sonstige"]},
    {id:"Q094",text:"Häufigkeit religiöser Praxis:",type:"radio",opts:["Nie","Selten (einige Male im Jahr)","Gelegentlich (monatlich)","Regelmäßig (wöchentlich)","Sehr regelmäßig (mehrmals/Woche)"],skip_if:{q:"Q093",op:"eq",val:"Keine (konfessionslos/atheistisch)"}},
    {id:"Q095",text:"Bedeutung von Religion in Ihrem Leben:",type:"likert5",left:"Gar nicht wichtig",right:"Sehr wichtig",skip_if:{q:"Q093",op:"eq",val:"Keine (konfessionslos/atheistisch)"}},
  ]},
  {id:"S11",title:"Herkunft & Hintergrund",questions:[
    {id:"Q096",text:"Eigene Migrationserfahrung:",type:"radio",opts:["In DE geboren und aufgewachsen","Als Kind (< 18) zugezogen","Als Erwachsener zugezogen","In DE geboren, im Ausland aufgewachsen"]},
    {id:"Q097",text:"Geburtsland Mutter:",type:"radio",opts:["Deutschland","Anderes EU-Land","Europ. Nicht-EU-Land (inkl. Türkei)","Naher Osten / Nordafrika","Sub-Sahara-Afrika","Süd-/Zentralasien","Ostasien / Südostasien","Amerika (Nord/Süd)","Sonstiges"]},
    {id:"Q098",text:"Geburtsland Vater:",type:"radio",opts:["Deutschland","Anderes EU-Land","Europ. Nicht-EU-Land (inkl. Türkei)","Naher Osten / Nordafrika","Sub-Sahara-Afrika","Süd-/Zentralasien","Ostasien / Südostasien","Amerika (Nord/Süd)","Sonstiges"]},
    {id:"Q099",text:"Großeltern väterlicherseits – Migrationshintergrund?",type:"radio",opts:["Nein, beide in DE geboren","Einer von beiden zugezogen","Beide zugezogen","Weiß nicht"]},
    {id:"Q100",text:"Großeltern mütterlicherseits – Migrationshintergrund?",type:"radio",opts:["Nein, beide in DE geboren","Einer von beiden zugezogen","Beide zugezogen","Weiß nicht"]},
    {id:"Q108",text:"Staatsangehörigkeit(en) (Mehrfachauswahl):",type:"check",opts:["Deutsch","Österreichisch","Schweizerisch","Türkisch","Polnisch","Russisch","Ukrainisch","Syrisch","Irakisch","Andere EU-Staatsangehörigkeit","Andere Nicht-EU-Staatsangehörigkeit"]},
    {id:"Q109",text:"Sind Sie für die Bundestagswahl wahlberechtigt?",type:"radio",opts:["Ja","Nein","Noch nicht (Einbürgerung läuft / zu jung)"],skip_if:{q:"Q108",op:"contains",val:"Deutsch"}},
    {id:"Q110",text:"Sind Sie für die Europawahl wahlberechtigt?",type:"radio",opts:["Ja","Nein"],skip_if:{q:"Q108",op:"contains",val:"Deutsch"}},
    {id:"Q111",text:"Streben Sie die deutsche Staatsbürgerschaft an?",type:"radio",opts:["Ja, aktiv (Antrag gestellt / in Vorbereitung)","Ja, langfristig geplant","Nein"],skip_if:{q:"Q108",op:"contains",val:"Deutsch"}},
    {id:"Q112",text:"Aufenthaltsstatus in Deutschland:",type:"radio",opts:["Niederlassungserlaubnis / Daueraufenthaltsrecht","Befristete Aufenthaltserlaubnis (Arbeit)","Befristete Aufenthaltserlaubnis (Studium / Ausbildung)","Befristete Aufenthaltserlaubnis (Familie)","Blaue Karte EU","Asylantrag gestellt (laufend)","Anerkannter Flüchtling (GFK / §3 AsylG)","Subsidiärer Schutz (§4 AsylG)","Duldung","Sonstiges"],skip_if:{q:"Q108",op:"contains",val:"Deutsch"}},
  ]},
  {
    id:"S14", title:"Erfahrungen in Deutschland",
    description:"Dieser Abschnitt richtet sich an Personen mit Geflüchteten- oder Asylstatus. Alle Angaben sind freiwillig und vollständig anonym.",
    questions:[
      {id:"Q113",text:"Wie lange leben Sie bereits in Deutschland?",type:"number",unit:"Jahre",min:0,max:80,skip_if:{q:"Q112",op:"notin",val:["Asylantrag gestellt (laufend)","Anerkannter Flüchtling (GFK / §3 AsylG)","Subsidiärer Schutz (§4 AsylG)","Duldung"]}},
      {id:"Q114",text:"Sind Sie allein oder mit Familie geflüchtet?",type:"radio",opts:["Allein","Mit Partner:in","Mit Kindern (ohne Partner:in)","Mit Kernfamilie (Partner:in + Kinder)","Mit Eltern / Geschwistern","Sonstiges"],skip_if:{q:"Q112",op:"notin",val:["Asylantrag gestellt (laufend)","Anerkannter Flüchtling (GFK / §3 AsylG)","Subsidiärer Schutz (§4 AsylG)","Duldung"]}},
      {id:"Q115",text:"Zufriedenheit mit Deutschland als Aufnahmeland (allgemein):",type:"likert5",left:"Sehr unzufrieden",right:"Sehr zufrieden",skip_if:{q:"Q112",op:"notin",val:["Asylantrag gestellt (laufend)","Anerkannter Flüchtling (GFK / §3 AsylG)","Subsidiärer Schutz (§4 AsylG)","Duldung"]}},
      {id:"Q116",text:"Zufriedenheit mit der Unterbringung (Wohnsituation):",type:"likert5",left:"Sehr unzufrieden",right:"Sehr zufrieden",skip_if:{q:"Q112",op:"notin",val:["Asylantrag gestellt (laufend)","Anerkannter Flüchtling (GFK / §3 AsylG)","Subsidiärer Schutz (§4 AsylG)","Duldung"]}},
      {id:"Q117",text:"Zufriedenheit mit den staatlichen Unterstützungsleistungen:",type:"likert5",left:"Sehr unzufrieden",right:"Sehr zufrieden",skip_if:{q:"Q112",op:"notin",val:["Asylantrag gestellt (laufend)","Anerkannter Flüchtling (GFK / §3 AsylG)","Subsidiärer Schutz (§4 AsylG)","Duldung"]}},
      {id:"Q118",text:"Zufriedenheit mit dem Asylverfahren (Dauer, Transparenz, Fairness):",type:"likert5",left:"Sehr unzufrieden",right:"Sehr zufrieden",skip_if:{q:"Q112",op:"notin",val:["Asylantrag gestellt (laufend)","Anerkannter Flüchtling (GFK / §3 AsylG)","Subsidiärer Schutz (§4 AsylG)","Duldung"]}},
      {id:"Q119",text:"Zufriedenheit mit Zugang zu Arbeit und Ausbildung:",type:"likert5",left:"Sehr unzufrieden",right:"Sehr zufrieden",skip_if:{q:"Q112",op:"notin",val:["Asylantrag gestellt (laufend)","Anerkannter Flüchtling (GFK / §3 AsylG)","Subsidiärer Schutz (§4 AsylG)","Duldung"]}},
      {id:"Q120",text:"Zufriedenheit mit Deutschkursen und sprachlicher Integration:",type:"likert5",left:"Sehr unzufrieden",right:"Sehr zufrieden",skip_if:{q:"Q112",op:"notin",val:["Asylantrag gestellt (laufend)","Anerkannter Flüchtling (GFK / §3 AsylG)","Subsidiärer Schutz (§4 AsylG)","Duldung"]}},
    ]
  },
  {id:"S12",title:"Rechtliche Erfahrungen",description:"⚠️ Diese Umfrage ist vollständig anonym. Keine personenbezogenen Daten werden gespeichert. 'Keine Angabe' ist jederzeit gültig.",questions:[
    {id:"Q101",text:"Haben Sie jemals eine Straftat / ein Delikt begangen (unabhängig von Verfolgung)?",type:"radio",opts:["Nein","Ja, Bagatelldelikt (z.B. Schwarzfahren)","Ja, mittelschweres Vergehen","Ja, schweres Vergehen"]},
    {id:"Q102",text:"Wurden Sie wegen einer Straftat angezeigt?",type:"radio",opts:["Nein","Ja, einmal","Ja, mehrfach"],skip_if:{q:"Q101",op:"eq",val:"Nein"}},
    {id:"Q103",text:"Wurden Sie wegen einer Straftat verurteilt?",type:"radio",opts:["Nein","Ja, einmal","Ja, mehrfach"],skip_if:{q:"Q101",op:"eq",val:"Nein"}},
  ]},
  {id:"S13",title:"Lebenszufriedenheit",questions:[
    {id:"Q104",text:"Wie zufrieden sind Sie insgesamt mit Ihrem Leben? (0 = gar nicht, 10 = vollkommen)",type:"scale10"},
    {id:"Q105",text:"Wie oft fühlen Sie sich einsam?",type:"radio",opts:["Nie","Selten","Manchmal","Oft","Fast immer"]},
    {id:"Q106",text:"Stärke Ihres sozialen Netzwerks:",type:"likert5",left:"Sehr schwach / isoliert",right:"Sehr stark / gut vernetzt"},
    {id:"Q107",text:"Kontakt zu Menschen mit anderen politischen Überzeugungen im Alltag:",type:"radio",opts:["Nie","Selten","Manchmal","Oft","Täglich"]},
  ]},
  {id:"S19",title:"Sucht & Substanzkonsum",
   description:"Alle Angaben sind freiwillig und anonym. 'Keine Angabe' ist jederzeit gültig.",
   questions:[
    {id:"Q164",text:"Welche der folgenden Substanzen konsumieren Sie regelmäßig? (Mehrfachauswahl)",type:"check",opts:["Zucker / Süßigkeiten / Softdrinks","Koffein (Kaffee, Energydrinks, Tee)","Nasenspray (schleimhautabschwellend, z.B. Xylometazolin)","Nikotin (Zigaretten, E-Zigarette, Snus, Kautabak)","Alkohol","Cannabis (seit 2024 in Deutschland teilweise legalisiert)","Rezeptfreie Schlaf- oder Beruhigungsmittel","Keines davon"]},
    {id:"Q165",text:"Wie oft trinken Sie Alkohol?",type:"radio",opts:["Nie","Selten (einige Male pro Jahr)","Gelegentlich (1–3x pro Monat)","Wöchentlich (1–3x pro Woche)","Mehrmals pro Woche","Täglich"]},
    {id:"Q166",text:"Wie viele Standardgläser Alkohol trinken Sie dabei üblicherweise pro Anlass?",type:"radio",opts:["1–2 Gläser","3–4 Gläser","5–6 Gläser","7 oder mehr Gläser"],skip_if:{q:"Q165",op:"eq",val:"Nie"}},
    {id:"Q167",text:"Wie oft konsumieren Sie Koffein (Kaffee, Energydrinks, Tee, etc.)?",type:"radio",opts:["Nie","Selten / unregelmäßig","1x täglich","2–3x täglich","Mehr als 3x täglich"]},
    {id:"Q168",text:"Nutzen Sie abschwellende Nasensprays regelmäßig (z.B. Xylometazolin)?",type:"radio",opts:["Nein","Ja, gelegentlich (situationsbedingt)","Ja, regelmäßig (mehrmals pro Woche oder täglich)","Ja, ich verspüre eine Abhängigkeit davon"]},
    {id:"Q169",text:"Rauchen Sie oder konsumieren Sie Nikotinprodukte?",type:"radio",opts:["Nein, nie geraucht","Nein, aber früher (aufgehört)","Ja, gelegentlich (weniger als täglich)","Ja, täglich"]},
    {id:"Q170",text:"Haben Sie schon einmal illegale Substanzen konsumiert?",type:"radio",opts:["Nein, nie","Ja, einmalig / experimentell","Ja, in der Vergangenheit (aktuell nicht mehr)","Ja, gelegentlich (aktuell)","Ja, regelmäßig (aktuell)"]},
    {id:"Q171",text:"Welche illegalen Substanzen haben Sie konsumiert? (Mehrfachauswahl)",type:"check",opts:["Ecstasy / MDMA","Kokain / Crack","Amphetamine / Speed","Methamphetamin (Crystal Meth)","LSD / Psychedelika (Pilze, Mescalin)","Heroin / Opiate","Ketamin","Neue psychoaktive Substanzen (NPS / Legal Highs)","Sonstiges"],skip_if:{q:"Q170",op:"eq",val:"Nein, nie"}},
    {id:"Q172",text:"Wie häufig konsumieren Sie derzeit illegale Substanzen?",type:"radio",opts:["Gar nicht (nur früher)","Selten (wenige Male pro Jahr)","Gelegentlich (monatlich)","Regelmäßig (wöchentlich)","Häufig (mehrmals pro Woche oder täglich)"],skip_if:{q:"Q170",op:"eq",val:"Nein, nie"}},
    {id:"Q173",text:"Konsum und Besitz illegaler Drogen für den Eigenbedarf sollte entkriminalisiert werden.",type:"likert5",left:"Stimme gar nicht zu",right:"Stimme voll zu",group_header:"Drogenpolitik:"},
    {id:"Q174",text:"Alle Drogen sollten vollständig legalisiert und staatlich reguliert werden.",type:"likert5",left:"Stimme gar nicht zu",right:"Stimme voll zu"},
    {id:"Q175",text:"Es sollte mehr staatlich betreute Drogenkonsumräume und Ausgabestellen (z.B. Methadon-Programme) geben.",type:"likert5",left:"Stimme gar nicht zu",right:"Stimme voll zu"},
    {id:"Q176",text:"Es sollte offizielle Drogentestangebote geben (Drug Checking), wie z.B. in der Schweiz.",type:"likert5",left:"Stimme gar nicht zu",right:"Stimme voll zu"},
    {id:"Q177",text:"Auf suchtgefährdende Substanzen (Zucker, Alkohol, Tabak, Cannabis, ...) sollte eine Suchtsteuer erhoben werden.",type:"likert5",left:"Stimme gar nicht zu",right:"Stimme voll zu"},
  ]},
  {id:"S15",title:"Einstellungen & Selbstwahrnehmung",questions:[
    {id:"Q123",text:"Wie sicher sind Sie sich generell bei politischen Themen?",type:"likert5",left:"Sehr unsicher",right:"Sehr sicher"},
    {id:"Q124",text:"Wie oft ändern Sie Ihre politische Meinung nach neuen Informationen?",type:"radio",opts:["Nie","Selten","Gelegentlich","Häufig","Sehr häufig"]},
    {id:"Q125",text:"Wie komplex empfinden Sie politische Themen im Allgemeinen?",type:"likert5",left:"Sehr einfach",right:"Sehr komplex"},
    {id:"Q126",text:"Wie vertrauenswürdig sind Social Media als politische Informationsquelle?",type:"likert5",left:"Gar nicht vertrauenswürdig",right:"Sehr vertrauenswürdig"},
    {id:"Q127",text:"Wie oft überprüfen Sie politische Informationen aktiv (z.B. per Gegenlesen)?",type:"radio",opts:["Nie","Selten","Manchmal","Häufig","Fast immer"]},
    {id:"Q128",text:"Wie oft sprechen Sie aktiv über Politik im Alltag?",type:"radio",opts:["Nie","Selten (wenige Male im Jahr)","Gelegentlich (monatlich)","Häufig (wöchentlich)","Sehr häufig (täglich)"]},
    {id:"Q129",text:"Haben Sie schon einmal bewusst Informationen gemieden, die Ihrer Meinung widersprechen?",type:"radio",opts:["Nein, nie","Selten","Manchmal","Häufig","Ja, regelmäßig"]},
    {id:"Q130",text:"Wie schätzen Sie Ihre digitale Kompetenz ein?",type:"likert5",left:"Sehr gering",right:"Sehr hoch",group_header:"Digitale Kompetenz & KI:"},
    {id:"Q131",text:"Nutzen Sie KI-Systeme regelmäßig (z.B. Chatbots, Sprachassistenten)?",type:"radio",opts:["Nein, nie","Selten (wenige Male)","Gelegentlich (monatlich)","Häufig (wöchentlich)","Täglich"]},
    {id:"Q132",text:"Haltung zu KI in politischen Entscheidungsprozessen:",type:"likert5",left:"Klar dagegen",right:"Klar dafür"},
    {id:"Q133",text:"Was ist Ihnen wichtiger?",type:"slider7",left:"Sicherheit & Stabilität",right:"Freiheit & Selbstbestimmung",group_header:"Grundlegende Werte:"},
    {id:"Q134",text:"Sollte Gleichheit wichtiger sein als individuelle Leistung?",type:"likert5",left:"Leistung klar wichtiger",right:"Gleichheit klar wichtiger"},
    {id:"Q137",text:"Ist es fair, wenn manche Menschen deutlich mehr besitzen als andere?",type:"likert5",left:"Völlig unfair",right:"Völlig fair"},
    {id:"Q135",text:"Blick in die Zukunft Deutschlands:",type:"likert5",left:"Sehr pessimistisch",right:"Sehr optimistisch",group_header:"Zukunft & Bedrohungen:"},
    {id:"Q136",text:"Welche Bedrohung empfinden Sie als größte für Deutschland? (Mehrfachauswahl)",type:"check",opts:["Klimawandel","Migration / Überfremdung","Wirtschaftlicher Abstieg","Politischer Extremismus","Kriminalität","Staatsverschuldung","Verlust nationaler Souveränität","Krieg / geopolitische Instabilität","Soziale Spaltung","KI & Digitalisierung","Sonstiges"]},
    {id:"Q138",text:'Bitte wählen Sie hier „Stimme eher nicht zu" (Qualitätsprüfung).',type:"likert5",left:"Stimme gar nicht zu",right:"Stimme voll zu",group_header:"Qualitätsprüfung:"},
    {id:"Q139",text:"Haben Sie eine Beeinträchtigung?",type:"radio",opts:["Nein","Ja, leicht (z.B. Legasthenie, leichte Sehschwäche)","Ja, mittel (z.B. chronische Erkrankung, Teilbehinderung)","Ja, schwer (z.B. Schwerbehinderung)"],group_header:"Beeinträchtigung:"},
    {id:"Q140",text:"Art der Beeinträchtigung (Mehrfachauswahl):",type:"check",opts:["Physisch / körperlich","Psychisch / emotional","Kognitiv / Lernbeeinträchtigung","Sensorisch (Sehen / Hören)","Sonstiges"],skip_if:{q:"Q139",op:"eq",val:"Nein"}},
    {id:"Q141",text:"Beeinflusst Ihre Beeinträchtigung Ihre Teilhabe am gesellschaftlichen Leben?",type:"likert5",left:"Gar nicht",right:"Sehr stark",skip_if:{q:"Q139",op:"eq",val:"Nein"}},
  ]},
  {id:"S17",title:"Diskriminierung & Gleichstellung",
   description:"Diese Fragen beziehen sich auf persönliche Erfahrungen sowie gesellschaftliche Einstellungen. Alle Angaben sind freiwillig und anonym.",
   questions:[
    {id:"Q145",text:"Haben Sie in Deutschland jemals persönlich eine Benachteiligung oder Diskriminierung erlebt?",type:"radio",opts:["Nein","Ja, einmal","Ja, mehrfach","Ja, regelmäßig"]},
    {id:"Q146",text:"Aufgrund welcher Merkmale wurden Sie benachteiligt? (Mehrfachauswahl)",type:"check",opts:["Geschlecht / Geschlechtsidentität","Ethnische Herkunft / Hautfarbe","Nationalität / Migrationshintergrund","Religion / Weltanschauung","Sexuelle Orientierung","Alter (zu jung oder zu alt)","Beeinträchtigung / Behinderung","Soziale Herkunft / Klasse","Sprache / Akzent","Äußeres Erscheinungsbild","Sonstiges"],skip_if:{q:"Q145",op:"eq",val:"Nein"}},
    {id:"Q147",text:"In welchem Bereich wurde die Diskriminierung hauptsächlich erfahren? (Mehrfachauswahl)",type:"check",opts:["Arbeit / Bewerbung","Schule / Ausbildung / Studium","Behörden / Ämter","Wohnen / Wohnungssuche","Gesundheitsversorgung","Gastronomie / Handel / Dienstleistungen","Polizei / Justiz","Öffentlicher Raum / Alltag","Online / Social Media","Sonstiges"],skip_if:{q:"Q145",op:"eq",val:"Nein"}},
    {id:"Q148",text:"Wurde die Diskriminierung von wem ausgeübt? (Mehrfachauswahl)",type:"check",opts:["Privatpersonen / Einzelne","Arbeitgeber:in / Vorgesetzte","Behörden / staatliche Stellen","Polizei","Unternehmen / Dienstleister","Online / anonym","Sonstiges"],skip_if:{q:"Q145",op:"eq",val:"Nein"}},
    {id:"Q149",text:"Haben Sie die Diskriminierung gemeldet oder angezeigt?",type:"radio",opts:["Nein, nicht gemeldet","Ja, intern (z.B. HR, Schulleitung)","Ja, bei einer Beratungsstelle","Ja, bei der Polizei / Staatsanwaltschaft","Ja, bei einer Antidiskriminierungsstelle"],skip_if:{q:"Q145",op:"eq",val:"Nein"}},
    {id:"Q150",text:"Wie sehr hat die Erfahrung Ihr Leben beeinflusst?",type:"likert5",left:"Kaum / gar nicht",right:"Sehr stark",skip_if:{q:"Q145",op:"eq",val:"Nein"}},
    {id:"Q151",text:"Ethnische Selbstidentifikation (optional, Freitext):",type:"text",group_header:"Identität:"},
    {id:"Q152",text:"\"Alle Beziehungsformen – unabhängig von Geschlecht, Identität oder Orientierung – sollten rechtlich gleichgestellt sein.\"",type:"likert5",left:"Stimme gar nicht zu",right:"Stimme voll zu",group_header:"Gleichstellungseinstellungen:"},
    {id:"Q153",text:"\"Erwerbs- und Sorgearbeit sollten in Beziehungen unabhängig von Geschlecht oder Rolle gleichmäßig verteilt sein.\"",type:"likert5",left:"Stimme gar nicht zu",right:"Stimme voll zu"},
    {id:"Q154",text:"\"Menschen werden in Deutschland aufgrund ihrer Herkunft oder ethnischen Zugehörigkeit systematisch benachteiligt.\"",type:"likert5",left:"Stimme gar nicht zu",right:"Stimme voll zu"},
    {id:"Q155",text:"\"Menschen werden in Deutschland aufgrund ihres Geschlechts oder ihrer Geschlechtsidentität systematisch benachteiligt.\"",type:"likert5",left:"Stimme gar nicht zu",right:"Stimme voll zu"},
    {id:"Q156",text:"\"Gezielte Fördermaßnahmen (z.B. Quoten) sind ein geeignetes Mittel um strukturelle Benachteiligungen auszugleichen.\"",type:"likert5",left:"Stimme gar nicht zu",right:"Stimme voll zu"},
    {id:"Q157",text:"\"Die gesellschaftliche Debatte über Diskriminierung und Gleichstellung ist übertrieben.\"",type:"likert5",left:"Stimme gar nicht zu",right:"Stimme voll zu"},
  ]},
  {id:"S18",title:"Steuerpolitik",description:"Wie stehen Sie zu folgenden steuerpolitischen Maßnahmen?",questions:[
    {id:"Q158",text:"Sollte stärker gegen Steuervermeidung und organisierten Steuerbetrug vorgegangen werden?",type:"likert5",left:"Klar dagegen",right:"Klar dafür",group_header:"Steuerdurchsetzung:"},
    {id:"Q159",text:"Sollte die Steuerfahndung besser aufgestellt werden?",type:"likert5",left:"Klar dagegen",right:"Klar dafür"},
    {id:"Q160",text:"Sollten gesetzliche Schlupflöcher, die Steuervermeidung und Steuerbetrug ermöglichen, geschlossen werden?",type:"likert5",left:"Klar dagegen",right:"Klar dafür"},
    {id:"Q161",text:"Sollte eine gerechte Erbschaftssteuer eingeführt werden? (ab 2 Mio. €)",type:"likert5",left:"Klar dagegen",right:"Klar dafür",group_header:"Steuerreform:"},
    {id:"Q162",text:"Sollte eine gerechte Vermögenssteuer eingeführt werden? (ab 2 Mio. €)",type:"likert5",left:"Klar dagegen",right:"Klar dafür"},
    {id:"Q163",text:"Sollte eine Finanztransaktionsteuer eingeführt werden?",type:"likert5",left:"Klar dagegen",right:"Klar dafür"},
  ]},
  {id:"S20",title:"Politikerpräferenzen",
   description:"Wen finden Sie am sympathischsten – und wen am wenigsten? Freitexteingabe ist möglich, falls ein Name nicht in der Liste erscheint.",
   questions:[
    {id:"Q182",text:"Beliebteste:r Politiker:in auf lokaler Ebene (Gemeinde, Stadt, Kreis):",type:"text",group_header:"Lokal:"},
    {id:"Q183",text:"Unbeliebteste:r Politiker:in auf lokaler Ebene:",type:"text"},
    {id:"Q184",text:"Beliebteste:r Politiker:in auf Landesebene:",type:"politician_single",group_header:"Landesebene:"},
    {id:"Q185",text:"Unbeliebteste:r Politiker:in auf Landesebene:",type:"politician_single"},
    {id:"Q186",text:"Beliebteste:r Politiker:in auf Bundesebene:",type:"politician_single",group_header:"Bundesebene:"},
    {id:"Q187",text:"Unbeliebteste:r Politiker:in auf Bundesebene:",type:"politician_single"},
    {id:"Q188",text:"Beliebteste:r Politiker:in international:",type:"politician_single",group_header:"International:"},
    {id:"Q189",text:"Unbeliebteste:r Politiker:in international:",type:"politician_single"},
  ]},
  {id:"S16",title:"Feedback & Kontakt",
   description:"Haben Sie Anmerkungen oder Verbesserungsvorschläge? Alle Angaben freiwillig und anonym.",
   questions:[
    {id:"Q142",text:"Allgemeines Feedback (Inhalt, Fragen, Verständlichkeit):",type:"text"},
    {id:"Q143",text:"Fehlen Ihrer Meinung nach wichtige Themen?",type:"text"},
    {id:"Q144",text:"Wie haben Sie von dieser Umfrage erfahren?",type:"radio",opts:["Reddit","Persönliche Empfehlung","Social Media (Instagram, TikTok, X, ...)","Mastodon / Fediverse","Nachrichtenartikel / Blog","Sonstiges"]},
  ]},
];

const TOTAL = SECTIONS.reduce((a,s) => a + s.questions.length, 0);

// ── Base input components ─────────────────────────────────────

function IdBadge({id}) {
  return <span style={{fontFamily:"monospace",fontSize:"11px",background:"#f1f5f9",color:"#94a3b8",padding:"1px 6px",borderRadius:"4px",marginRight:"6px",flexShrink:0}}>{id}</span>;
}
function KABtn({active, onClick, label="Keine Angabe"}) {
  return <button onClick={onClick} style={{marginTop:"8px",padding:"4px 12px",fontSize:"12px",border:`1px solid ${active?"#94a3b8":"#e2e8f0"}`,borderRadius:"6px",background:active?"#f1f5f9":"transparent",color:active?"#475569":"#cbd5e1",cursor:"pointer"}}>{label}</button>;
}
const bs = (active, accent="#3b82f6") => ({flex:"1",height:"44px",borderRadius:"8px",border:`2px solid ${active?accent:"#e2e8f0"}`,background:active?accent:"#fff",color:active?"#fff":"#64748b",fontWeight:"600",fontSize:"13px",cursor:"pointer"});

function Radio({q,val,onChange}) {
  return <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
    {q.opts.map(o=><label key={o} style={{display:"flex",alignItems:"center",gap:"10px",padding:"9px 12px",borderRadius:"8px",border:`1px solid ${val===o?"#93c5fd":"#e2e8f0"}`,background:val===o?"#eff6ff":"#fff",cursor:"pointer",fontSize:"13px"}}>
      <input type="radio" style={{accentColor:"#3b82f6"}} checked={val===o} onChange={()=>onChange(o)}/>{o}</label>)}
    <KABtn active={val===KA} onClick={()=>onChange(KA)}/>
  </div>;
}
function Check({q,val=[],onChange}) {
  const t=o=>{if(o===KA){onChange([KA]);return;}const nv=Array.isArray(val)?val:[];onChange(nv.includes(o)?nv.filter(v=>v!==o):[...nv.filter(v=>v!==KA),o]);};
  const ia=o=>Array.isArray(val)&&val.includes(o);
  return <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
    {q.opts.map(o=><label key={o} style={{display:"flex",alignItems:"center",gap:"10px",padding:"9px 12px",borderRadius:"8px",border:`1px solid ${ia(o)?"#93c5fd":"#e2e8f0"}`,background:ia(o)?"#eff6ff":"#fff",cursor:"pointer",fontSize:"13px"}}>
      <input type="checkbox" style={{accentColor:"#3b82f6"}} checked={ia(o)} onChange={()=>t(o)}/>{o}</label>)}
    <KABtn active={val===KA||(Array.isArray(val)&&val.includes(KA))} onClick={()=>onChange([KA])}/>
  </div>;
}
function Likert5({q,val,onChange}) {
  return <div>
    <div style={{display:"flex",gap:"6px",marginBottom:"4px"}}>{[1,2,3,4,5].map(n=><button key={n} style={bs(val===n)} onClick={()=>onChange(n)}>{n}</button>)}</div>
    <div style={{display:"flex",justifyContent:"space-between",fontSize:"11px",color:"#94a3b8"}}><span>{q.left}</span><span>{q.right}</span></div>
    <KABtn active={val===KA} onClick={()=>onChange(KA)}/>
  </div>;
}
function Slider7({q,val,onChange}) {
  return <div>
    <div style={{display:"flex",gap:"4px",marginBottom:"4px"}}>{[1,2,3,4,5,6,7].map(n=><button key={n} style={bs(val===n,"#6366f1")} onClick={()=>onChange(n)}>{n}</button>)}</div>
    <div style={{display:"flex",justifyContent:"space-between",fontSize:"11px",color:"#94a3b8"}}><span>{q.left}</span><span>{q.right}</span></div>
    {q.note&&<p style={{fontSize:"11px",color:"#94a3b8",fontStyle:"italic",margin:"2px 0 0"}}>{q.note}</p>}
    <KABtn active={val===KA} onClick={()=>onChange(KA)}/>
  </div>;
}
function NumInput({q,val,onChange}) {
  return <div style={{display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap"}}>
    <input type="number" min={q.min} max={q.max} value={val===KA||val===undefined?'':val} onChange={e=>onChange(e.target.value===''?undefined:parseInt(e.target.value))} style={{width:"100px",padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:"8px",fontSize:"14px",outline:"none"}} placeholder="..."/>
    {q.unit&&<span style={{fontSize:"13px",color:"#64748b"}}>{q.unit}</span>}
    <KABtn active={val===KA} onClick={()=>onChange(KA)}/>
  </div>;
}
function TxtInput({val,onChange}) {
  return <div>
    <textarea rows={3} value={val===KA?'':(val||'')} onChange={e=>onChange(e.target.value||undefined)} style={{width:"100%",padding:"10px 12px",border:"1px solid #e2e8f0",borderRadius:"8px",fontSize:"13px",resize:"vertical",outline:"none",boxSizing:"border-box",fontFamily:"inherit"}} placeholder="Ihre Antwort (optional)..."/>
    <KABtn active={val===KA} onClick={()=>onChange(KA)}/>
  </div>;
}
function Scale10({val,onChange}) {
  return <div>
    <div style={{display:"flex",gap:"3px",marginBottom:"4px"}}>{[0,1,2,3,4,5,6,7,8,9,10].map(n=><button key={n} style={{...bs(val===n,"#10b981"),fontSize:"12px",height:"40px"}} onClick={()=>onChange(n)}>{n}</button>)}</div>
    <div style={{display:"flex",justifyContent:"space-between",fontSize:"11px",color:"#94a3b8"}}><span>0 = Gar nicht</span><span>10 = Vollkommen</span></div>
    <KABtn active={val===KA} onClick={()=>onChange(KA)}/>
  </div>;
}

function PlzInput({val, onChange}) {
  const isKA  = val === KA;
  const raw   = isKA || val === undefined ? "" : String(val);
  const valid = /^\d{5}$/.test(raw);
  const color = raw.length === 0 ? "#e2e8f0"
              : valid            ? "#86efac"
              :                    "#fca5a5";
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
        <input
          type="text" inputMode="numeric" pattern="\d{5}"
          maxLength={5}
          value={raw}
          onChange={e => {
            const v = e.target.value.replace(/\D/g,"").slice(0,5);
            onChange(v === "" ? undefined : v);
          }}
          placeholder="z.B. 20095"
          style={{width:"110px",padding:"9px 12px",border:`1px solid ${color}`,borderRadius:"8px",fontSize:"16px",outline:"none",letterSpacing:"3px",fontFamily:"monospace"}}
        />
        {raw.length > 0 && raw.length < 5 && (
          <span style={{fontSize:"12px",color:"#f97316"}}>{5 - raw.length} Ziffern fehlen</span>
        )}
        {valid && <span style={{fontSize:"14px",color:"#16a34a"}}>✓</span>}
      </div>
      <KABtn active={isKA} onClick={() => onChange(KA)} />
    </div>
  );
}

function QInput({q,val,onChange}) {
  switch(q.type) {
    case "radio":        return <Radio q={q} val={val} onChange={onChange}/>;
    case "check":        return <Check q={q} val={val} onChange={onChange}/>;
    case "likert5":      return <Likert5 q={q} val={val} onChange={onChange}/>;
    case "slider7":      return <Slider7 q={q} val={val} onChange={onChange}/>;
    case "number":       return <NumInput q={q} val={val} onChange={onChange}/>;
    case "text":         return <TxtInput val={val} onChange={onChange}/>;
    case "scale10":      return <Scale10 val={val} onChange={onChange}/>;
    case "party_single":     return <PartyCombobox val={val} onChange={onChange} extras={q.extras||[]}/>;
    case "party_multi":      return <PartyMultiCombobox val={val} onChange={onChange}/>;
    case "politician_single":return <PoliticianCombobox val={val} onChange={onChange}/>;
    case "plz":              return <PlzInput val={val} onChange={onChange}/>;
    default: return null;
  }
}

// ── App ───────────────────────────────────────────────────────

export default function App() {
  const [si, setSi]             = useState(0);
  const [resp, setResp]         = useState({});
  const [lang, setLang]         = useState("de");
  const t = useT(lang);
  const [surveyId, setSurveyId] = useState(() => {
    // crypto.randomUUID() = 128-Bit CSPRNG (sicherer als Math.random())
    try { return crypto.randomUUID(); } catch { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
  });
  const [submitted, setSubmitted] = useState(false);
  const [modal, setModal]       = useState(false);
  const [sending, setSending]   = useState(false);
  const [sendError, setSendError] = useState(null);
  const [showJSON, setShowJSON]   = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const scrollRef    = useRef(null);
  const startedAtRef = useRef(null);   // Timestamp erste Antwort (ms)
  const [shareDuration, setShareDuration] = useState(false);
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [newsletterConsent, setNewsletterConsent] = useState(false);
  const [captchaToken, setCaptchaToken] = useState(null);
  const captchaRef = useRef(null);
  const captchaWidgetRef = useRef(null);

  // Create widget when modal opens; destroy on close.
  // SDK is bundled (no CDN), so _frcSdk is always available synchronously.
  useEffect(() => {
    if (!modal || !captchaRef.current) return;
    setCaptchaToken(null);
    const el = captchaRef.current;
    const widget = _frcSdk.createWidget({
      element: el,
      sitekey: "FCMS9RCA6232KR7L",
      startMode: "auto",
    });
    captchaWidgetRef.current = widget;
    // FriendlyCaptcha SDK v2 uses dot-prefixed placeholders (.UNVERIFIED etc.)
    // during solving; only accept a response once it is a real signed token.
    const accept = (response) => {
      if (response && !response.startsWith(".")) setCaptchaToken(response);
    };
    // Poll every 300 ms so we catch completion even if the event doesn't fire.
    const timer = setInterval(() => accept(widget.getResponse?.()), 300);
    // Also listen for events on both the widget object and the DOM element.
    const onComplete = (e) => accept(e.detail?.response ?? widget.getResponse?.());
    widget.addEventListener("frc:widget.complete", onComplete);
    el.addEventListener("frc:widget.complete", onComplete);
    return () => {
      clearInterval(timer);
      captchaWidgetRef.current = null;
      el.removeEventListener("frc:widget.complete", onComplete);
      widget.destroy();
    };
  }, [modal]);

  // ── Load saved state (non-blocking, fires in background) ──
  useEffect(() => {
    (async () => {
      try { const r = await storage.get("survey_v1_resp"); if (r?.value) setResp(JSON.parse(r.value)); } catch {}
      try { const r = await storage.get("survey_v1_id");   if (r?.value) setSurveyId(r.value); else storage.set("survey_v1_id", surveyId).catch(()=>{}); } catch {}
      try { const r = await storage.get("survey_v1_sub");  if (r?.value === "1") setSubmitted(true); } catch {}
    })();
  }, []); // eslint-disable-line

  // ── Skipped-Antworten automatisch löschen ────────────────────
  // Wenn eine Abhängigkeit sich ändert und eine Frage übersprungen wird,
  // wird eine vorhandene Antwort entfernt (kein Stale-State im Export).
  useEffect(() => {
    const skipped = getSkippedIds(resp);
    const stale = [...skipped].filter(id => resp[id] !== undefined);
    if (stale.length === 0) return;
    setResp(p => {
      const next = { ...p };
      stale.forEach(id => delete next[id]);
      return next;
    });
  }, [resp]);
  useEffect(() => {
    storage.set("survey_v1_resp", JSON.stringify(resp)).catch(() => {});
  }, [resp]);

  const answered   = Object.keys(resp).length;
  const pct        = Math.round(answered / TOTAL * 100);
  const sec        = SECTIONS[si];
  const tSec       = translateSec(lang, sec);
  const skippedIds = getSkippedIds(resp);
  const secVisible = sec.questions.filter(q => !skippedIds.has(q.id));
  const secDone    = secVisible.filter(q => resp[q.id] !== undefined).length;

  // Sektionen die mindestens eine sichtbare Frage haben
  const visibleSecIdxs = SECTIONS
    .map((s, i) => i)
    .filter(i => SECTIONS[i].questions.some(q => !skippedIds.has(q.id)));

  // Position des aktuellen si in den sichtbaren Sektionen
  const viPos = visibleSecIdxs.indexOf(si);

  const setR = (id, v) => {
    if (startedAtRef.current === null && v !== undefined) {
      startedAtRef.current = Date.now();
    }
    setResp(p => v === undefined ? (({ [id]: _, ...r }) => r)(p) : { ...p, [id]: v });
  };

  // ── Navigation – springt nur zu sichtbaren Sektionen ──
  const go = d => {
    const nextPos = Math.max(0, Math.min(visibleSecIdxs.length - 1, viPos + d));
    setSi(visibleSecIdxs[nextPos]);
    setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, 30);
  };

  const jumpTo = i => {
    setSi(i);
    setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, 30);
  };

  // ── JSON export – show in modal (works everywhere incl. iOS) ──
  const exportJSON = () => setShowJSON(true);

  // ── Server submit ──
  const doSubmit = async () => {
    // Only use the token set by the polling/event handler (guaranteed to be a real signed token).
    const token = captchaToken;
    if (!token) {
      setSendError("Bitte löse zuerst das Captcha.");
      return;
    }
    setSending(true);
    setSendError(null);
    const durationSec = (startedAtRef.current !== null && shareDuration)
      ? Math.round((Date.now() - startedAtRef.current) / 1000)
      : 0;
    try {
      const normalized = normalizeResponses(resp, SECTIONS);
      const res = await fetch(SERVER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id:           surveyId,
          schema_hash:  SCHEMA_HASH,
          submitted_at: new Date().toISOString(),
          version:      "1.0.0",
          lang,
          answered,
          total:        TOTAL,
          duration_seconds: durationSec,
          responses:    normalized,
          "frc-captcha-response": token,
        }),
      });
      if (!res.ok) {
        // If the server rejected the captcha token, reset the widget so the user
        // can solve a fresh challenge instead of retrying with an already-consumed token.
        if (res.status === 400) {
          try {
            const errBody = await res.json();
            if ((errBody?.detail ?? "").toLowerCase().includes("captcha")) {
              setCaptchaToken(null);
              captchaWidgetRef.current?.reset?.();
            }
          } catch {} // ignore parse errors – throw below handles it
        }
        throw new Error(`HTTP ${res.status}`);
      }

      // Newsletter: separat senden, komplett entkoppelt von Umfragedaten
      // Keine Survey-ID wird mitgeschickt → Anonymität bleibt gewahrt
      if (newsletterConsent && newsletterEmail.includes("@")) {
        fetch(`${SERVER_URL.replace("/api/survey", "/api/newsletter")}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email:      newsletterEmail.trim().toLowerCase(),
            consent_at: new Date().toISOString(),
            lang,
            // Absichtlich kein survey_id – würde Anonymität brechen
          }),
        }).catch(() => {}); // Newsletter-Fehler soll Submit nicht blockieren
      }

      storage.set("survey_v1_sub", "1").catch(() => {});
      setSubmitted(true);
      setModal(false);
    } catch (e) {
      setSendError(`Fehler beim Senden: ${e.message}`);
    } finally {
      setSending(false);
    }
  };

  // ── Success screen ──
  if (submitted && !modal) return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg, #f0fdf4 0%, #eff6ff 100%)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", padding: "24px" }}>
      <div style={{ maxWidth: "480px", width: "100%", textAlign: "center" }}>
        {/* Checkmark */}
        <div style={{ width: "72px", height: "72px", borderRadius: "50%", background: "#dcfce7", border: "2px solid #86efac", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: "32px", marginBottom: "20px" }}>
          ✓
        </div>

        <h1 style={{ fontSize: "24px", color: "#14532d", margin: "0 0 10px", fontWeight: "700" }}>
          Vielen Dank für deinen Beitrag!
        </h1>
        <p style={{ color: "#166534", lineHeight: 1.7, margin: "0 0 6px", fontSize: "15px" }}>
          Jede Teilnahme hilft dabei, ein realistischeres Bild der Gesellschaft zu zeichnen.
        </p>
        <p style={{ color: "#4d7c5f", lineHeight: 1.6, margin: "0 0 20px", fontSize: "13px" }}>
          Deine Antworten wurden anonym übermittelt – ohne IP-Adresse, ohne Tracking.
        </p>

        {/* Teilen-Hinweis */}
        <div style={{ background: "#fff", border: "1px solid #bbf7d0", borderRadius: "12px", padding: "16px 18px", marginBottom: "20px", textAlign: "left" }}>
          <p style={{ margin: "0 0 8px", fontSize: "13px", fontWeight: "600", color: "#14532d" }}>
            🙏 Weitersagen macht den Unterschied
          </p>
          <p style={{ margin: 0, fontSize: "12px", color: "#4d7c5f", lineHeight: 1.6 }}>
            Die Aussagekraft der Studie wächst mit der Vielfalt der Teilnehmenden.
            Besonders wertvoll sind Menschen, die nicht typischerweise an Online-Umfragen teilnehmen.
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" }}>
          <button onClick={() => setSubmitted(false)}
            style={{ padding: "9px 18px", border: "1px solid #bbf7d0", borderRadius: "8px", background: "#fff", color: "#166534", cursor: "pointer", fontSize: "13px" }}>
            Antworten ansehen
          </button>
        </div>

        <p style={{ marginTop: "24px", fontSize: "11px", color: "#86a394" }}>
          survey.muehrke.de · Anonym · Open Source
        </p>
      </div>
    </div>
  );

  // ── Main survey ──
  return (
    <div ref={scrollRef} style={{ height: "100vh", overflowY: "auto", background: "#f8fafc", fontFamily: "system-ui,-apple-system,sans-serif" }}>

      {/* JSON modal */}
      {showJSON && (() => {
        const json = JSON.stringify({ meta: { exported: new Date().toISOString(), id: surveyId, answered, total: TOTAL }, responses: resp }, null, 2);
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 300, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "16px" }}>
            <div style={{ background: "#fff", borderRadius: "16px", padding: "20px", width: "100%", maxWidth: "680px", maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,.25)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                <span style={{ fontWeight: "700", fontSize: "15px", color: "#0f172a" }}>JSON – Antworten</span>
                <button onClick={() => setShowJSON(false)} style={{ border: "none", background: "none", fontSize: "20px", color: "#94a3b8", cursor: "pointer", padding: "0 4px" }}>✕</button>
              </div>
              <p style={{ fontSize: "12px", color: "#94a3b8", margin: "0 0 10px" }}>Alles markieren und kopieren (iOS: gedrückt halten → Alles auswählen → Kopieren)</p>
              <textarea readOnly value={json}
                onFocus={e => e.target.select()}
                style={{ flex: 1, minHeight: "240px", padding: "10px", border: "1px solid #e2e8f0", borderRadius: "8px", fontSize: "11px", fontFamily: "monospace", resize: "none", outline: "none", color: "#334155", background: "#f8fafc" }} />
            </div>
          </div>
        );
      })()}

      {/* Submit modal */}
      {modal && (() => {
        const durationSec = startedAtRef.current !== null
          ? Math.round((Date.now() - startedAtRef.current) / 1000) : 0;
        const durationMin = Math.floor(durationSec / 60);
        const durationLabel = durationSec < 60
          ? `${durationSec} Sekunden`
          : durationMin === 1 ? `1 Minute` : `${durationMin} Minuten`;
        const emailValid = newsletterEmail.includes("@") && newsletterEmail.includes(".");
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" }}>
            <div style={{ background: "#fff", borderRadius: "16px", padding: "22px", maxWidth: "420px", width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.25)", maxHeight: "90vh", overflowY: "auto" }}>

              <h2 style={{ margin: "0 0 14px", fontSize: "18px", color: "#0f172a" }}>{t.modalTitle}</h2>

              {/* Datenschutz */}
              <div style={{ fontSize: "12px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "10px 13px", color: "#166534", lineHeight: 1.6, marginBottom: "12px" }}>
                {t.privacyNote}
              </div>

              {/* Fortschritt */}
              <div style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "14px" }}>
                {t.answered(answered, TOTAL)}
              </div>

              {/* Duplikat-Warnung */}
              {submitted && (
                <div style={{ fontSize: "12px", color: "#d97706", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "6px", padding: "8px 12px", marginBottom: "12px" }}>
                  {t.dupWarning}
                </div>
              )}
              <div ref={captchaRef} style={{ marginBottom: "12px" }}></div>

              {/* ── Ausfülldauer ── */}
              {durationSec > 10 && (
                <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "12px 14px", marginBottom: "12px" }}>
                  <label style={{ display: "flex", alignItems: "flex-start", gap: "10px", cursor: "pointer" }}>
                    <input type="checkbox" checked={shareDuration} onChange={e => setShareDuration(e.target.checked)}
                      style={{ accentColor: "#3b82f6", marginTop: "2px", flexShrink: 0 }} />
                    <span style={{ fontSize: "12px", color: "#475569", lineHeight: 1.6 }}>
                      Du hast <strong style={{ color: "#1e293b" }}>{durationLabel}</strong> gebraucht –
                      darf ich das teilen um die Zeitschätzung für andere zu verbessern?{" "}
                      <span style={{ color: "#94a3b8" }}>(freiwillig, geht anonym mit)</span>
                    </span>
                  </label>
                </div>
              )}

              {/* ── Newsletter opt-in ── */}
              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "10px", padding: "12px 14px", marginBottom: "14px" }}>
                <p style={{ margin: "0 0 8px", fontSize: "12px", fontWeight: "600", color: "#374151" }}>
                  📬 Auf dem Laufenden bleiben <span style={{ fontWeight: "400", color: "#94a3b8" }}>(optional)</span>
                </p>
                <p style={{ margin: "0 0 10px", fontSize: "11px", color: "#64748b", lineHeight: 1.5 }}>
                  Wenn die Ergebnisse ausgewertet sind, schicke ich eine kurze Nachricht –
                  ca. 1–2 Mails pro Jahr, kein Spam, jederzeit abbestellbar.
                  Die E-Mail wird <strong>komplett getrennt</strong> von den Umfragedaten gespeichert.
                </p>
                <input type="email" value={newsletterEmail}
                  onChange={e => setNewsletterEmail(e.target.value)}
                  placeholder="deine@email.de"
                  style={{ width: "100%", padding: "8px 11px", border: `1px solid ${newsletterEmail && !emailValid ? "#fca5a5" : "#e2e8f0"}`, borderRadius: "7px", fontSize: "13px", outline: "none", boxSizing: "border-box", marginBottom: "8px", fontFamily: "inherit" }} />
                {newsletterEmail.length > 0 && (
                  <label style={{ display: "flex", alignItems: "flex-start", gap: "8px", cursor: "pointer" }}>
                    <input type="checkbox" checked={newsletterConsent} onChange={e => setNewsletterConsent(e.target.checked)}
                      style={{ accentColor: "#3b82f6", marginTop: "2px", flexShrink: 0 }} />
                    <span style={{ fontSize: "11px", color: "#64748b", lineHeight: 1.5 }}>
                      Ich stimme zu, dass meine E-Mail-Adresse für Benachrichtigungen zu dieser Studie
                      gespeichert wird und kann diese Einwilligung jederzeit widerrufen.
                    </span>
                  </label>
                )}
              </div>

              {/* Fehler */}
              {sendError && (
                <div style={{ fontSize: "13px", color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "10px", marginBottom: "12px" }}>
                  {sendError}
                </div>
              )}

              {/* Buttons */}
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={() => { setModal(false); setSendError(null); }}
                  style={{ flex: 1, padding: "10px", border: "1px solid #e2e8f0", borderRadius: "8px", background: "#fff", cursor: "pointer", fontSize: "13px", color: "#374151" }}>
                  {t.cancel}
                </button>
                <button onClick={doSubmit} disabled={sending || !captchaToken || (newsletterEmail.length > 0 && !emailValid)}
                  style={{ flex: 2, padding: "10px", border: "none", borderRadius: "8px",
                    background: sending ? "#94a3b8" : (!captchaToken || (newsletterEmail.length > 0 && !emailValid)) ? "#e2e8f0" : "#3b82f6",
                    color: (!captchaToken || (newsletterEmail.length > 0 && !emailValid)) ? "#94a3b8" : "#fff",
                    cursor: sending || !captchaToken || (newsletterEmail.length > 0 && !emailValid) ? "not-allowed" : "pointer",
                    fontSize: "13px", fontWeight: "600" }}>
                  {sending ? t.sending : t.submit}
                </button>
              </div>
              {newsletterEmail.length > 0 && !emailValid && (
                <p style={{ margin: "6px 0 0", fontSize: "11px", color: "#ef4444", textAlign: "center" }}>Bitte eine gültige E-Mail-Adresse eingeben</p>
              )}
            </div>
          </div>
        );
      })()}

      {/* Sticky header */}
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: "#fff", borderBottom: "1px solid #e2e8f0", boxShadow: "0 1px 3px rgba(0,0,0,.05)" }}>
        <div style={{ maxWidth: "720px", margin: "0 auto", padding: "12px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: "16px", color: "#0f172a" }}>{t.title}</div>
              <div style={{ fontSize: "11px", color: "#94a3b8" }}>v1.0 · {TOTAL} Fragen · {t.subtitle}</div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "4px" }}>
              <div style={{ fontSize: "20px", fontWeight: 700, color: "#3b82f6" }}>{pct}%</div>
              <div style={{ fontSize: "11px", color: "#94a3b8" }}>{answered}/{TOTAL}</div>
              <select value={lang} onChange={e => setLang(e.target.value)}
                style={{ fontSize: "11px", border: "1px solid #e2e8f0", borderRadius: "5px", padding: "2px 4px", color: "#475569", background: "#fff", cursor: "pointer" }}>
                {LANGUAGES.map(l => (
                  <option key={l.code} value={l.code}>{l.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={{ background: "#e2e8f0", borderRadius: "99px", height: "6px", overflow: "hidden" }}>
            <div style={{ background: "#3b82f6", height: "100%", width: `${pct}%`, borderRadius: "99px", transition: "width .3s" }} />
          </div>
        </div>
      </div>

      {/* Section tabs – nur Sektionen mit sichtbaren Fragen */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", overflowX: "auto" }}>
        <div style={{ maxWidth: "720px", margin: "0 auto", padding: "8px 16px", display: "flex", gap: "4px", whiteSpace: "nowrap" }}>
          {visibleSecIdxs.map(i => {
            const s    = SECTIONS[i];
            const vis  = s.questions.filter(q => !skippedIds.has(q.id));
            const done = vis.filter(q => resp[q.id] !== undefined).length;
            const full = done === vis.length;
            return (
              <button key={s.id} onClick={() => jumpTo(i)}
                style={{ padding: "5px 10px", borderRadius: "6px", border: "none", fontSize: "11px", fontWeight: "600", cursor: "pointer", background: i === si ? "#3b82f6" : full ? "#f0fdf4" : "#f8fafc", color: i === si ? "#fff" : full ? "#16a34a" : "#64748b" }}>
                {translateSec(lang, s).title}
                {done > 0 && !full && <span style={{ opacity: .6, marginLeft: "3px" }}>{done}/{vis.length}</span>}
                {full && <span style={{ marginLeft: "3px" }}>✓</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "24px 16px" }}>
        <div style={{ marginBottom: "20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
            <span style={{ fontFamily: "monospace", fontSize: "12px", background: "#dbeafe", color: "#1d4ed8", padding: "2px 8px", borderRadius: "5px", fontWeight: "600" }}>{parseInt(sec.id.slice(1))}</span>
            <h2 style={{ margin: 0, fontSize: "20px", fontWeight: "700", color: "#0f172a" }}>{tSec.title}</h2>
            <span style={{ marginLeft: "auto", fontSize: "12px", color: "#94a3b8" }}>{secDone}/{secVisible.length}</span>
          </div>
          {tSec.description && (
            <div style={{ fontSize: "13px", background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: "8px", padding: "10px 14px" }}>
              {tSec.description}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {sec.questions.map(q => {
            const tq = translateQ(lang, q);
            const skipped = skippedIds.has(q.id);
            return (
              <div key={q.id} style={{
                overflow: skipped ? "hidden" : "visible",
                maxHeight: skipped ? "0" : "2000px",
                opacity: skipped ? 0 : 1,
                marginBottom: skipped ? "-16px" : "0",
                transition: "max-height .35s ease, opacity .25s ease, margin-bottom .35s ease",
                pointerEvents: skipped ? "none" : "auto",
              }}>
                {tq.group_header && (
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "#475569", background: "#f1f5f9", borderRadius: "8px", padding: "8px 12px", marginBottom: "8px", marginTop: "4px" }}>
                    {tq.group_header}
                  </div>
                )}
                <QuestionCard
                  q={tq}
                  val={resp[q.id]}
                  onChange={v => setR(q.id, v)}
                  lang={lang}
                  answered={resp[q.id] !== undefined}
                />
              </div>
            );
          })}
        </div>

        {/* Navigation */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "32px", paddingTop: "20px", borderTop: "1px solid #e2e8f0", gap: "8px" }}>
          <button onClick={() => go(-1)} disabled={viPos === 0}
            style={{ padding: "9px 18px", fontSize: "13px", fontWeight: "600", border: "1px solid #e2e8f0", borderRadius: "8px", background: "#fff", cursor: viPos === 0 ? "not-allowed" : "pointer", opacity: viPos === 0 ? 0.4 : 1, color: "#374151" }}>
            {t.back}
          </button>

          <div style={{ display: "flex", gap: "6px" }}>
            <button onClick={exportJSON}
              style={{ padding: "9px 12px", fontSize: "12px", fontWeight: "600", border: "1px solid #e2e8f0", borderRadius: "8px", background: "#fff", color: "#64748b", cursor: "pointer" }}>
              {t.jsonBtn}
            </button>
            {resetConfirm ? (
              <>
                <button onClick={() => { setResp({}); setResetConfirm(false); }}
                  style={{ padding: "9px 12px", fontSize: "12px", fontWeight: "600", border: "none", borderRadius: "8px", background: "#ef4444", color: "#fff", cursor: "pointer" }}>
                  {t.resetYes}
                </button>
                <button onClick={() => setResetConfirm(false)}
                  style={{ padding: "9px 12px", fontSize: "12px", fontWeight: "600", border: "1px solid #e2e8f0", borderRadius: "8px", background: "#fff", color: "#64748b", cursor: "pointer" }}>
                  {t.resetNo}
                </button>
              </>
            ) : (
              <button onClick={() => setResetConfirm(true)}
                style={{ padding: "9px 12px", fontSize: "12px", fontWeight: "600", border: "1px solid #fecaca", borderRadius: "8px", background: "#fff", color: "#ef4444", cursor: "pointer" }}>
                {t.reset}
              </button>
            )}
          </div>

          {viPos < visibleSecIdxs.length - 1 ? (
            <button onClick={() => go(1)}
              style={{ padding: "9px 18px", fontSize: "13px", fontWeight: "600", border: "none", borderRadius: "8px", background: "#3b82f6", color: "#fff", cursor: "pointer" }}>
              {t.next}
            </button>
          ) : (
            <button onClick={() => setModal(true)}
              style={{ padding: "9px 18px", fontSize: "13px", fontWeight: "700", border: "none", borderRadius: "8px", background: "#10b981", color: "#fff", cursor: "pointer" }}>
              {t.submit}
            </button>
          )}
        </div>

        <p style={{ textAlign: "center", fontSize: "11px", color: "#cbd5e1", marginTop: "16px" }}>
          {t.section(viPos + 1, visibleSecIdxs.length)}
        </p>
      </div>
    </div>
  );
}
