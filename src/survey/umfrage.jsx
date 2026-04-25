import { useEffect, useRef, useState } from "react";

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
const SCHEMA_HASH = "acffb1411db2fd29f364346686654a3357a3700d9b1229d96495b49678a4146f";

// Normalisiert alle Felder vor dem Senden:
// - Übersprungene Fragen  → "__skipped__"  (wird server-seitig nicht als Antwort gezählt)
// - Nicht beantwortet, numerisch → -1
// - Nicht beantwortet, andere → "__ka__"
const NUMERIC_TYPES = new Set(["number", "likert5", "slider7", "scale10"]);
function normalizeResponses(responses, sections) {
  const skipped = getSkippedIds(responses);
  const out = { ...responses };
  for (const sec of sections) {
    for (const q of sec.questions) {
      if (skipped.has(q.id)) {
        out[q.id] = SKIP_SENTINEL;
      } else if (out[q.id] === undefined) {
        out[q.id] = NUMERIC_TYPES.has(q.type) ? -1 : KA;
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

// Nur UI-Strings (Buttons, Labels, Datenschutz-Texte).
// Fragen-Texte bleiben vorerst auf Deutsch – vollständige Übersetzung
// aller 108 Fragen wäre als separates JSON-File zu pflegen.
const T = {
  de: {
    title:       "Deutsche Gesellschaftsstudie",
    subtitle:    "alle Angaben freiwillig",
    back:        "← Zurück",
    next:        "Weiter →",
    submit:      "Abschicken ✓",
    noAnswer:    "Keine Angabe",
    reset:       "✕ Reset",
    resetYes:    "Ja, löschen",
    resetNo:     "Nein",
    jsonBtn:     "↓ JSON",
    jsonTitle:   "JSON – Antworten",
    jsonHint:    "Alles markieren und kopieren (iOS: gedrückt halten → Alles auswählen → Kopieren)",
    modalTitle:  "Umfrage abschicken",
    privacyNote: "🔒 Ihre Antworten werden vollständig anonym übertragen. Keine IP-Adressen oder personenbezogene Daten werden gespeichert.",
    dupWarning:  "⚠️ Sie haben bereits eine Einreichung abgeschickt.",
    sending:     "Wird gesendet…",
    cancel:      "Abbrechen",
    answered:    (n, t) => `${n} von ${t} Fragen beantwortet`,
    thanksTitle: "Vielen Dank für Ihre Teilnahme!",
    thanksBody:  "Ihre Antworten wurden anonym übermittelt.",
    thanksNote:  "Es wurden keine personenbezogenen Daten gespeichert.",
    viewAgain:   "Antworten nochmals ansehen",
    section:     (i, n) => `Abschnitt ${i} / ${n}`,
    langLabel:   "Sprache / Language",
  },
  en: {
    title:       "German Social Survey",
    subtitle:    "all answers voluntary",
    back:        "← Back",
    next:        "Next →",
    submit:      "Submit ✓",
    noAnswer:    "No answer",
    reset:       "✕ Reset",
    resetYes:    "Yes, delete",
    resetNo:     "No",
    jsonBtn:     "↓ JSON",
    jsonTitle:   "JSON – Responses",
    jsonHint:    "Select all and copy (iOS: long press → Select All → Copy)",
    modalTitle:  "Submit Survey",
    privacyNote: "🔒 Your answers are transmitted completely anonymously. No IP addresses or personal data are stored.",
    dupWarning:  "⚠️ You have already submitted a response.",
    sending:     "Sending…",
    cancel:      "Cancel",
    answered:    (n, t) => `${n} of ${t} questions answered`,
    thanksTitle: "Thank you for participating!",
    thanksBody:  "Your answers were transmitted anonymously.",
    thanksNote:  "No personal data was stored.",
    viewAgain:   "Review answers",
    section:     (i, n) => `Section ${i} / ${n}`,
    langLabel:   "Sprache / Language",
  },
  tr: {
    title:       "Alman Toplum Araştırması",
    subtitle:    "tüm cevaplar gönüllüdür",
    back:        "← Geri",
    next:        "İleri →",
    submit:      "Gönder ✓",
    noAnswer:    "Cevap yok",
    reset:       "✕ Sıfırla",
    resetYes:    "Evet, sil",
    resetNo:     "Hayır",
    jsonBtn:     "↓ JSON",
    jsonTitle:   "JSON – Yanıtlar",
    jsonHint:    "Tümünü seç ve kopyala",
    modalTitle:  "Anketi Gönder",
    privacyNote: "🔒 Yanıtlarınız tamamen anonim olarak iletilmektedir.",
    dupWarning:  "⚠️ Daha önce bir gönderim yaptınız.",
    sending:     "Gönderiliyor…",
    cancel:      "İptal",
    answered:    (n, t) => `${n} / ${t} soru yanıtlandı`,
    thanksTitle: "Katılımınız için teşekkürler!",
    thanksBody:  "Yanıtlarınız anonim olarak iletildi.",
    thanksNote:  "Kişisel veri depolanmadı.",
    viewAgain:   "Yanıtlara tekrar bak",
    section:     (i, n) => `Bölüm ${i} / ${n}`,
    langLabel:   "Sprache / Language",
  },
  uk: {
    title:       "Соціальне опитування Німеччини",
    subtitle:    "всі відповіді добровільні",
    back:        "← Назад",
    next:        "Далі →",
    submit:      "Надіслати ✓",
    noAnswer:    "Без відповіді",
    reset:       "✕ Скинути",
    resetYes:    "Так, видалити",
    resetNo:     "Ні",
    jsonBtn:     "↓ JSON",
    jsonTitle:   "JSON – Відповіді",
    jsonHint:    "Виділити все та скопіювати",
    modalTitle:  "Надіслати опитування",
    privacyNote: "🔒 Ваші відповіді передаються повністю анонімно.",
    dupWarning:  "⚠️ Ви вже надіслали відповідь.",
    sending:     "Надсилання…",
    cancel:      "Скасувати",
    answered:    (n, t) => `${n} з ${t} питань відповіли`,
    thanksTitle: "Дякуємо за участь!",
    thanksBody:  "Ваші відповіді передані анонімно.",
    thanksNote:  "Особисті дані не збережені.",
    viewAgain:   "Переглянути відповіді",
    section:     (i, n) => `Розділ ${i} / ${n}`,
    langLabel:   "Sprache / Language",
  },
  pl: {
    title:       "Badanie Społeczne Niemiec",
    subtitle:    "wszystkie odpowiedzi dobrowolne",
    back:        "← Wstecz",
    next:        "Dalej →",
    submit:      "Wyślij ✓",
    noAnswer:    "Brak odpowiedzi",
    reset:       "✕ Resetuj",
    resetYes:    "Tak, usuń",
    resetNo:     "Nie",
    jsonBtn:     "↓ JSON",
    jsonTitle:   "JSON – Odpowiedzi",
    jsonHint:    "Zaznacz wszystko i skopiuj",
    modalTitle:  "Wyślij ankietę",
    privacyNote: "🔒 Twoje odpowiedzi są przesyłane całkowicie anonimowo.",
    dupWarning:  "⚠️ Już przesłałeś odpowiedź.",
    sending:     "Wysyłanie…",
    cancel:      "Anuluj",
    answered:    (n, t) => `${n} z ${t} pytań odpowiedział`,
    thanksTitle: "Dziękujemy za udział!",
    thanksBody:  "Twoje odpowiedzi zostały przesłane anonimowo.",
    thanksNote:  "Żadne dane osobowe nie zostały zapisane.",
    viewAgain:   "Przejrzyj odpowiedzi",
    section:     (i, n) => `Sekcja ${i} / ${n}`,
    langLabel:   "Sprache / Language",
  },
  // Weitere Sprachen analog ergänzen:
  fr: null, es: null, it: null, ar: null, da: null, sv: null,
};
// Fallback auf Deutsch wenn Sprache noch nicht übersetzt ist
const useT = (lang) => T[lang] || T["de"];

// ── Tooltips / Frageerklärungen ───────────────────────────────
// Zentral gespeichert für einfache Übersetzung.
// Struktur: TOOLTIPS[lang][questionId] = "Erklärungstext"
// Fehlende Sprachen fallen auf "de" zurück (gleicher Mechanismus wie T).

const TOOLTIPS = {
  de: {
    // S01 – Soziodemographie
    Q001: "Ihr Alter hilft dabei, Meinungen und Einstellungen nach Generationen zu vergleichen. Bitte geben Sie Ihr aktuelles Lebensalter in Jahren an.",
    Q002: "Gemeint ist Ihre persönliche Geschlechtsidentität – wie Sie sich selbst einordnen, unabhängig von biologischen Merkmalen oder rechtlichem Eintrag.",
    Q003: "Das bei Geburt zugewiesene Geschlecht (meist auf Grundlage körperlicher Merkmale) kann sich von der gelebten Identität unterscheiden. Beide Angaben helfen, Zusammenhänge zwischen Geschlecht und gesellschaftlichen Erfahrungen besser zu verstehen.",
    Q122: "Die romantische und sexuelle Orientierung beeinflusst viele Lebensbereiche und ist für Fragen zu Gleichstellung und gesellschaftlicher Teilhabe relevant. Alle Angaben sind selbstverständlich freiwillig.",
    Q004: "Bundeslandunterschiede sind in vielen politischen und sozialen Fragen relevant – etwa durch unterschiedliche Regierungsparteien, Wirtschaftsstrukturen oder historische Prägungen (Ost/West).",
    Q005: "Die Größe des Wohnorts beeinflusst Lebensverhältnisse, Infrastruktur, Mobilitätsoptionen und politische Einstellungen erheblich.",
    Q121: "Die Postleitzahl ermöglicht eine feinere geografische Analyse als das Bundesland allein – z.B. Unterschiede zwischen städtischen Bezirken oder Regionen innerhalb eines Bundeslandes. Die PLZ wird nur aggregiert ausgewertet.",
    Q006: "Wohn- und Arbeitsort können sich stark unterscheiden (Pendeln). Der Arbeitsort prägt den Alltag und beeinflusst ggf. politische Wahrnehmungen.",
    Q007: "Der Schulabschluss ist ein zentrales Merkmal sozialer Schicht und korreliert mit vielen politischen und wirtschaftlichen Einstellungen.",
    Q008: "Ein Hochschulabschluss wird separat erfasst, da er Bildungsunterschiede innerhalb derselben Schulabschlussgruppe aufzeigt.",
    Q009: "Handwerkliche und Berufsausbildungen werden häufig in Umfragen vernachlässigt, sind aber für das Verständnis von Arbeits- und Lebenswelten wichtig.",
    Q010: "Mehrfachauswahl möglich – viele Menschen haben mehrere Beschäftigungen gleichzeitig (z.B. Studium + Werkstudentenjob, Hauptberuf + Nebentätigkeit).",
    Q011: "Der Sektor beeinflusst Jobsicherheit, Einkommen, Tarifbindung und politische Einstellungen zur Rolle des Staates.",
    // S02 – Familie & Haushalt
    Q012: "Beziehungsstatus und Lebensform sind eng mit wirtschaftlicher Lage, Sorgearbeit und politischen Prioritäten verknüpft.",
    Q013: "Die Haushaltsform beeinflusst, wer Care-Arbeit leistet, wie Entscheidungen getroffen werden und welche sozialpolitischen Themen besonders relevant sind.",
    Q014: "Kinder im Haushalt verändern Alltagserfahrungen, Zeitbudgets und politische Themen (Bildung, Kinderbetreuung, Wohnungsmarkt) erheblich.",
    Q015: "Das Alter der Kinder bestimmt, welche konkreten Herausforderungen (Krippe, Schule, Ausbildung) aktuell relevant sind.",
    Q016: "Kinder außerhalb des Haushalts – z.B. nach Trennung – bedeuten oft Unterhaltspflichten und geteilte Erziehungsverantwortung.",
    Q017: "Pflegearbeit für Angehörige ist häufig unsichtbar, zeitintensiv und hat große wirtschaftliche Auswirkungen – besonders für Frauen.",
    Q018: "Die Verteilung von Haus- und Sorgearbeit ist eine zentrale Gleichstellungsfrage und beeinflusst Erwerbsmöglichkeiten und wirtschaftliche Selbstständigkeit.",
    // S03 – Wirtschaft & Finanzen
    Q019: "Das Haushaltseinkommen ermöglicht Aussagen über wirtschaftliche Lage und soziale Schicht. Gemeint ist das monatliche Nettoeinkommen aller Personen im Haushalt zusammen.",
    Q020: "Vermögen (nicht nur Einkommen) bestimmt wirtschaftliche Sicherheit und Handlungsspielräume erheblich. Grobe Schätzungen reichen völlig aus.",
    Q021: "Schulden jenseits von Hypotheken (z.B. Konsumkredite, Studienkredite) können finanzielle Handlungsspielräume stark einschränken.",
    Q022: "Staatliche Transfers zeigen, welche Bevölkerungsgruppen auf soziale Sicherungssysteme angewiesen sind – wichtig für sozialpolitische Analysen.",
    Q023: "Eigentum vs. Miete ist in Deutschland eine zentrale Vermögensfrage mit Auswirkungen auf finanzielle Sicherheit und politische Einstellungen.",
    Q024: "Eine hohe Mietbelastung (>30% des Einkommens) gilt als finanziell belastend und ist ein Indikator für Wohnungsnot.",
    Q025: "Der subjektive Vergleich zur eigenen Vergangenheit gibt Aufschluss über Wohlstandswahrnehmung – unabhängig vom absoluten Einkommensniveau.",
    Q026: "Zukunftserwartungen beeinflussen Konsum, Investitionen und politische Einstellungen stark.",
    Q027: "Intergenerationale Mobilität – ob man es besser hat als die Eltern – ist ein Kernmerkmal von Chancengleichheit.",
    Q028: "Gewerkschaftsmitgliedschaft ist ein Indikator für politisches Engagement und arbeitsrechtliche Einstellungen.",
    // S04 – Politische Orientierung
    Q029: "Diese Skala erfasst die wirtschafts- und gesellschaftspolitische Grundausrichtung: Wer eher Bewährtes bewahren möchte, steht links; wer Wandel und Erneuerung anstrebt, rechts. Die Mitte deutet auf ausgeglichene Haltung.",
    Q030: "Diese Achse misst die Haltung zur staatlichen Steuerung: Autoritär bedeutet Präferenz für einen starken Staat, klare Regeln und kollektive Ordnung. Libertär bedeutet Präferenz für individuelle Freiheit, weniger staatliche Einmischung.",
    Q031: "Diese und die folgenden Aussagen bilden eine wissenschaftliche Populismus-Skala (nach Akkerman/Mudde). Sie messen, wie stark die Überzeugung ist, dass 'das Volk' gegen 'die Elite' steht und direkter Volkseinfluss wichtiger ist als repräsentative Demokratie.",
    Q032: "Teil der Populismus-Skala. Misst die Präferenz für direkte Demokratie gegenüber repräsentativer Entscheidungsfindung.",
    Q033: "Teil der Populismus-Skala. Misst die Wahrnehmung einer fundamentalen Spaltung zwischen 'einfachen Menschen' und einer abgehobenen Elite.",
    Q034: "Teil der Populismus-Skala. Misst Misstrauen gegenüber Berufspolitiker:innen.",
    Q035: "Teil der Populismus-Skala. Misst die Wahrnehmung von Politik als tatenlosem Redetheater.",
    Q036: "Teil der Populismus-Skala. Misst, ob Kompromiss als Schwäche oder Verrat wahrgenommen wird – ein Kernelement populistischen Denkens.",
    Q037: "Ihre tatsächliche Wahlentscheidung bei der letzten Bundestagswahl (Zweitstimme) erlaubt den Vergleich mit aktuellen Wahlabsichten. 'Nicht gewählt' umfasst bewusste Wahlenthaltung.",
    Q038: "Die hypothetische Wahlabsicht zeigt aktuelle politische Stimmungen und mögliche Veränderungen gegenüber dem letzten Wahlergebnis.",
    Q039: "Wahlentscheidungssicherheit zeigt, wie groß der potenzielle Wechselwähler:innen-Pool ist.",
    Q040: "Koalitionspräferenzen zeigen, welche Parteikonstellationen in der Bevölkerung als wünschenswert gelten – unabhängig von den eigenen Wahlabsichten.",
    // S05 – Parteikompetenz
    Q041: "Welcher Partei traut die Bevölkerung am ehesten zu, wirtschaftliche Probleme zu lösen und Arbeitsplätze zu erhalten?",
    Q042: "Innere Sicherheit ist ein zentrales Wahlkampfthema – diese Frage zeigt, welcher Partei hier am meisten vertraut wird.",
    Q043: "Klimaschutz und Umweltpolitik gewinnen an Bedeutung. Die Parteikompetenz in diesem Bereich hat sich in den letzten Jahren stark verändert.",
    Q044: "Bildungspolitik liegt in Deutschland bei den Ländern – dennoch haben Parteien auf Bundesebene unterschiedliche Ansätze und Prioritäten.",
    Q045: "Migration und Integration ist eines der zentralen Wahlkampfthemen. Die Kompetenzzuschreibung hat sich über die letzten Wahlen stark verschoben.",
    Q046: "Soziale Gerechtigkeit und Umverteilung – welcher Partei wird hier am meisten zugetraut?",
    Q047: "Außen- und Verteidigungspolitik ist seit dem Ukraine-Krieg und der NATO-Debatte wieder stärker im Fokus.",
    Q048: "Digitalisierung und KI sind zentrale Zukunftsthemen – welche Partei gilt hier als kompetent?",
    Q049: "Gesundheitspolitik und Pflege betreffen fast alle Bevölkerungsgruppen, besonders durch den demografischen Wandel.",
    // S06 – Zufriedenheit & Vertrauen
    Q050: "Regierungszufriedenheit ist eine der meistgenutzten Kennzahlen der Politikforschung und erlaubt den Vergleich über Zeit und zwischen Regierungen.",
    Q051: "Wichtig: Diese Frage bezieht sich auf das Prinzip der Demokratie, nicht auf die aktuelle Regierung. Beide Werte zusammen zeigen, ob Unzufriedenheit systemisch oder nur regierungsbezogen ist.",
    Q052: "Eine offene Frage gibt Ihnen die Möglichkeit, konkrete Kritikpunkte zu benennen, die in den vordefinierten Fragen möglicherweise nicht abgebildet sind.",
    Q053: "Das Bundesverfassungsgericht ist die höchste rechtliche Institution. Vertrauen in diese Institution ist ein Indikator für das Vertrauen in den Rechtsstaat.",
    Q054: "Vertrauen in die Polizei ist zentral für die gesellschaftliche Akzeptanz staatlicher Sicherheitsorgane.",
    Q055: "Vertrauen in den Bundestag misst das Vertrauen in die demokratische Hauptinstitution.",
    Q056: "Vertrauen in öffentlich-rechtliche Medien ist in Deutschland besonders relevant, da ARD und ZDF durch Rundfunkbeiträge finanziert werden.",
    Q057: "Privatmedien werden durch Werbung und Eigentümerinteressen geprägt – das beeinflusst möglicherweise ihre Glaubwürdigkeit.",
    Q058: "Vertrauen in die Bundeswehr und ihre Führung ist besonders seit der Zeitenwende 2022 ein relevantes Thema.",
    Q059: "Vertrauen in die EU als Institution – unabhängig von der Einschätzung einzelner EU-Entscheidungen.",
    Q060: "Vertrauen in Religionsgemeinschaften kann Hinweise auf gesellschaftliche Bindungskraft und Glaubwürdigkeitsprobleme geben.",
    Q061: "Wissenschaftsvertrauen ist besonders seit der Pandemie ein vieldiskutiertes Thema.",
    Q062: "Generalisiertes interpersonales Vertrauen ('den meisten Menschen kann man vertrauen') ist ein Kernmerkmal des sozialen Zusammenhalts und aus Umfragen wie dem SOEP bekannt.",
    Q063: "Mediennutzungsverhalten erklärt viele Meinungsunterschiede. Besonders relevant: Welche Quellen nutzen Menschen als primäre politische Information?",
    // S07 – Themen & Einstellungen
    Q064: "Freitext-Antwort: Welche konkreten Themen beschäftigen Sie persönlich am stärksten? Es gibt keine vorgegebenen Kategorien.",
    Q065: "Das subjektive Sicherheitsgefühl kann deutlich vom statistischen Kriminalitätsniveau abweichen und wird stark durch Medienberichterstattung beeinflusst.",
    Q066: "Diese Skala erfasst die wirtschaftspolitische Grundhaltung: Soll der Staat Unterschiede aktiv ausgleichen (Umverteilung), oder sollen Einzelne für ihr Wohlergehen selbst verantwortlich sein (Eigenverantwortung)?",
    Q067: "Politisches Engagement über die Stimmabgabe hinaus zeigt gesellschaftliche Partizipation und zivilgesellschaftliches Engagement.",
    // S08 – Energie & Mobilität
    Q068: "Die Atomkraft-Debatte ist in Deutschland besonders intensiv. Diese Frage erfasst Ihre Position zu Weiterbetrieb bestehender Anlagen und möglichem Neubau.",
    Q069: "Erneuerbare Energien sind politisch weitgehend Konsens, aber der Ausbautempo und die Auswirkungen auf Landschaft und Energiepreise sind umstritten.",
    Q070: "Fossile Brennstoffe (Kohle, Öl, Gas) sind in der Debatte um Energiesicherheit vs. Klimaschutz zentral – besonders nach dem Ukraine-Krieg.",
    Q071: "Elektromobilität wird staatlich gefördert, ist aber in Bezug auf Reichweite, Ladeinfrastruktur und Kosten umstritten.",
    Q072: "Das aktuelle Heizsystem gibt Aufschluss über die persönliche Betroffenheit von Wärmewende-Maßnahmen.",
    Q073: "Das Heizungsgesetz (GEG 2024) ist eines der umstrittensten Vorhaben der letzten Jahre. Diese Frage erfasst Ihre grundsätzliche Haltung dazu.",
    Q074: "Deutschland ist eines der wenigen Länder ohne generelles Autobahntempolimit. Die Debatte berührt Fragen von Freiheit, Sicherheit und Klimaschutz.",
    Q075: "Die aktuelle Nutzung der Bahn gibt Kontext für die folgenden Fragen zu möglichen Veränderungen.",
    Q076: "Preis als Hindernis: Würde eine Verbilligung Ihr Reiseverhalten ändern?",
    Q077: "Das 9-Euro-Ticket (2022) und das Deutschlandticket zeigen: Kostenlosigkeit allein erhöht die Nutzung, löst aber Zuverlässigkeitsprobleme nicht.",
    Q078: "Zuverlässigkeit als Hindernis: Würde eine pünktlichere Bahn Ihr Verhalten ändern?",
    // S09 – Geopolitik
    Q079: "Bitte bewerten Sie die russische Regierung als politischen Akteur – nicht das russische Volk oder die russische Kultur.",
    Q080: "Putin als Person und politischer Entscheidungsträger – unabhängig von Ihrer Einschätzung Russlands als Land.",
    Q081: "Die US-Regierung als außenpolitischer Akteur – nicht die USA als Land oder Gesellschaft.",
    Q082: "Trump als Person und politischen Entscheidungsträger bewerten.",
    Q083: "Die israelische Regierung als politischen Akteur – nicht Israel als Land oder jüdische Menschen allgemein.",
    Q084: "Netanyahu als Person und Regierungschef – unabhängig von Ihrer Haltung zu Israel.",
    Q085: "Die Palästinensische Autonomiebehörde (PA) ist die offizielle Vertretung der Palästinenser:innen im Westjordanland.",
    Q086: "Hamas ist die Regierungspartei im Gazastreifen – bitte bewerten Sie sie als politisch-militärische Führung.",
    Q087: "Die chinesische Regierung als außenpolitischen und wirtschaftspolitischen Akteur.",
    Q088: "Xi Jinping als Person und Entscheidungsträger.",
    Q089: "Die taiwanesische Regierung als eigenständigen politischen Akteur im Kontext des Konflikts mit China.",
    Q090: "Die EU als politisches Projekt und Institution – unabhängig von einzelnen Entscheidungen.",
    Q091: "Die aktuelle EU-Kommission als konkretes Gremium mit bestimmten Personen und Politiken.",
    Q092: "Mehrfachauswahl möglich. Diese Frage erlaubt nuancierte Haltungen zum Ukraine-Krieg – Unterstützung für die Ukraine schließt z.B. Gesprächsbereitschaft nicht aus.",
    // S10 – Religion
    Q093: "Religiöse Zugehörigkeit beeinflusst viele Einstellungen zu Ethik, Familie und gesellschaftlichen Fragen.",
    Q094: "Die Häufigkeit religiöser Praxis (Gottesdienst, Gebet, etc.) zeigt, wie stark Religion den Alltag tatsächlich prägt.",
    Q095: "Unabhängig von der formalen Mitgliedschaft: Wie wichtig ist Religion als Orientierungsrahmen in Ihrem Leben?",
    // S11 – Herkunft & Hintergrund
    Q096: "Eigene Migrationserfahrung (nicht die der Eltern) beeinflusst Lebenserfahrungen und Perspektiven.",
    Q097: "Geburtsland der Mutter als Hinweis auf Migrationshintergrund der Familie – wichtig für die Einordnung von Integrationsverläufen.",
    Q098: "Geburtsland des Vaters – analog zur Mutter-Frage.",
    Q099: "Großelterngeneration väterlicherseits – ermöglicht die Einordnung von Migrations- und Integrationsverläufen über mehrere Generationen.",
    Q100: "Großelterngeneration mütterlicherseits – analog.",
    Q108: "Staatsangehörigkeit(en) – Mehrfachauswahl möglich (z.B. Doppelstaatsbürgerschaft).",
    Q109: "Wahlberechtigung für den Bundestag setzt die deutsche Staatsangehörigkeit voraus.",
    Q110: "Für die Europawahl sind auch EU-Bürger:innen in Deutschland wahlberechtigt – nicht nur Deutsche.",
    Q111: "Für Menschen ohne deutschen Pass: Planen Sie, die Einbürgerung zu beantragen? Dies gibt Aufschluss über Integrationsabsichten.",
    Q112: "Der Aufenthaltsstatus definiert rechtliche Rechte und Pflichten und ist ein zentrales Merkmal für die Lebenssituation von Menschen ohne deutschen Pass.",
    // S14 – Erfahrungen in Deutschland
    Q113: "Wie lange leben Sie bereits in Deutschland? Dies gibt Kontext für Sprachkenntnisse, Integration und Orientierung.",
    Q114: "Allein oder mit Familie geflüchtet – ein wichtiger Faktor für soziale Einbindung und Resilienz.",
    Q115: "Gesamtzufriedenheit mit Deutschland als Aufnahmeland – unabhängig von spezifischen Aspekten.",
    Q116: "Die Unterbringungssituation (Gemeinschaftsunterkunft, eigene Wohnung, etc.) hat großen Einfluss auf Wohlbefinden und Integration.",
    Q117: "Wie bewerten Sie die staatlichen Unterstützungsleistungen – Sozialleistungen, Beratung, Integrationshilfen?",
    Q118: "Das Asylverfahren ist oft lang und intransparent. Wie erleben Sie Dauer, Kommunikation und Fairness?",
    Q119: "Zugang zu Arbeit und Ausbildung ist einer der wichtigsten Faktoren für Integration und Selbstständigkeit.",
    Q120: "Sprachkurse sind zentral für Integration – wie beurteilen Sie Qualität und Verfügbarkeit?",
    // S12 – Rechtliche Erfahrungen
    Q101: "Diese Frage ist vollständig anonym. Sie hilft zu verstehen, ob Strafverfolgung sozial selektiv ist. 'Bagatelldelikt' umfasst z.B. Schwarzfahren oder geringfügige Ordnungswidrigkeiten.",
    Q102: "Wurden Sie wegen einer Straftat bei der Polizei angezeigt? Unabhängig davon, ob daraus eine Verurteilung folgte.",
    Q103: "Eine strafrechtliche Verurteilung durch ein Gericht – unabhängig von Strafart (Geldstrafe, Bewährung, Haft).",
    // S13 – Lebenszufriedenheit
    Q104: "Die SOEP-Standardfrage (Sozio-oekonomisches Panel) zur allgemeinen Lebenszufriedenheit. Ermöglicht Vergleiche mit repräsentativen Bevölkerungsumfragen.",
    Q105: "Einsamkeit ist ein wachsendes gesellschaftliches Thema mit erheblichen Auswirkungen auf Gesundheit und politische Einstellungen.",
    Q106: "Die Stärke sozialer Netzwerke ist ein zentraler Schutzfaktor für psychisches Wohlbefinden.",
    Q107: "Kontakt über politische 'Blasen' hinaus – ein Indikator für gesellschaftliche Kohäsion oder Polarisierung.",
    // S15 – Einstellungen & Selbstwahrnehmung
    Q123: "Politisches Selbstvertrauen beeinflusst Engagement und Partizipation. Unsicherheit bei politischen Themen ist weit verbreitet und kein Zeichen von Unwissen.",
    Q124: "Meinungsflexibilität ist ein Zeichen kritischen Denkens. Diese Frage misst wie offen Sie für neue Informationen sind.",
    Q125: "Die subjektive Wahrnehmung politischer Komplexität beeinflusst, wie Menschen politische Informationen verarbeiten und ob sie sich angesprochen fühlen.",
    Q126: "Social Media sind für viele Menschen eine wichtige Informationsquelle, gelten aber gleichzeitig als anfällig für Desinformation.",
    Q127: "Aktives Fact-Checking ist eine Schlüsselkompetenz für politische Meinungsbildung in der digitalen Öffentlichkeit.",
    Q128: "Politische Alltagsgespräche sind ein Indikator für politisches Engagement und gesellschaftliche Vernetzung.",
    Q129: "Das bewusste Meiden widersprüchlicher Informationen ('Confirmation Bias' / Echokammer-Verhalten) ist ein gut erforschtes Phänomen in der Politikpsychologie.",
    Q130: "Digitale Kompetenz bestimmt, wie gut Menschen Online-Informationen einschätzen und nutzen können.",
    Q131: "KI-Nutzung im Alltag verändert wie Menschen Informationen suchen, verarbeiten und Entscheidungen treffen.",
    Q132: "KI in politischen Prozessen (z.B. automatisierte Entscheidungen, Algorithmen in der Verwaltung) ist ein wachsendes gesellschaftspolitisches Thema.",
    Q133: "Diese klassische Werteskala misst die Grundorientierung zwischen kollektiver Sicherheit und individueller Freiheit – ein zentrales Spannungsfeld in der Politikphilosophie.",
    Q134: "Die Spannung zwischen Gleichheits- und Leistungsprinzip ist eine der fundamentalsten Wertedimensionen in der Gesellschaft.",
    Q137: "Diese Frage misst die Haltung zur Vermögensungleichheit und damit zur Legitimität von Wohlstandsunterschieden.",
    Q135: "Zukunftsoptimismus/-pessimismus für Deutschland ist ein wichtiger Indikator für gesellschaftliches Vertrauen und politische Stabilität.",
    Q136: "Bedrohungswahrnehmungen unterscheiden sich stark nach politischer Orientierung, Alter und sozialer Lage.",
    Q138: "Diese Frage dient der Qualitätsprüfung der Umfrage. Bitte wählen Sie bewusst die Option 'Stimme eher nicht zu' (Wert 2). Antworten die deutlich abweichen, deuten auf zufälliges Klicken hin.",
    Q139: "Beeinträchtigungen beeinflussen gesellschaftliche Teilhabe, politische Prioritäten und Erfahrungen mit staatlichen Systemen erheblich.",
    Q140: "Unterschiedliche Arten von Beeinträchtigungen bringen unterschiedliche Herausforderungen mit sich – diese Differenzierung ist für politische Analysen wichtig.",
    Q141: "Das Ausmaß der Auswirkungen einer Beeinträchtigung auf die gesellschaftliche Teilhabe variiert stark je nach Art, Unterstützung und gesellschaftlichen Rahmenbedingungen.",
    // S16 – Feedback
    Q142: "Ihr Feedback hilft, die Umfrage zu verbessern und für zukünftige Erhebungen zu optimieren.",
    Q143: "Fehlende Themen sind wichtige Hinweise für die Weiterentwicklung der Studie.",
    Q144: "Diese Information hilft zu verstehen, über welche Kanäle die Umfrage verbreitet wird – wichtig für die Einschätzung der Stichprobenverzerrung.",
    // S17 – Diskriminierung & Gleichstellung
    Q145: "Gemeint sind persönlich erlebte Situationen, in denen Sie unfair behandelt wurden – unabhängig davon ob dies rechtlich als Diskriminierung gilt.",
    Q146: "Mehrfachauswahl möglich. Die Frage zielt auf den tatsächlichen Grund der Benachteiligung aus Ihrer Wahrnehmung.",
    Q147: "Der Bereich der Diskriminierung gibt Aufschluss über strukturelle Muster – z.B. ob Benachteiligungen besonders im Arbeitsmarkt oder bei Behörden auftreten.",
    Q148: "Diskriminierung kann von Privatpersonen, aber auch von Institutionen ausgehen – beides ist gesellschaftlich relevant.",
    Q149: "Viele Diskriminierungserfahrungen werden nicht gemeldet. Das Verhältnis zwischen Erfahrung und Meldung gibt Aufschluss über Barrieren beim Zugang zum Rechtssystem.",
    Q150: "Die persönliche Betroffenheit zeigt wie tiefgreifend Diskriminierungserfahrungen das Leben beeinflussen können.",
    Q151: "Freiwillige Angabe ohne vorgegebene Kategorien – weil ethnische Identität komplex ist und nicht in Schubladen passt.",
    Q152: "Formuliert bewusst ohne Nennung konkreter Beziehungsformen um alle Konstellationen einzuschließen – gleichgeschlechtlich, trans, nicht-binär, etc.",
    Q153: "Formuliert ohne Geschlechterbezug um alle Beziehungsmodelle einzuschließen – unabhängig davon wer welche Rolle übernimmt.",
    Q154: "Diese Frage misst die Wahrnehmung strukturellen Rassismus – ein zentrales und in Deutschland kontrovers diskutiertes Thema.",
    Q155: "Misst die Wahrnehmung von Geschlechterdiskriminierung als strukturelles Problem, nicht als Einzelfall.",
    Q156: "Quoten und Fördermaßnahmen sind gesellschaftlich umstritten – diese Frage erfasst die Grundhaltung dazu.",
    Q157: "Diese Gegenfrage erlaubt es Menschen die Überdruss gegenüber der Gleichstellungsdebatte empfinden, das auszudrücken – wichtig für ein vollständiges Bild.",
  },
  en: {
    en: {
    // S01 – Sociodemographics
    Q001: "Your age helps compare opinions and attitudes across generations. Please state your current age in years.",
    Q002: "This refers to your personal gender identity – how you classify yourself, regardless of biological characteristics or legal registration.",
    Q003: "The sex assigned at birth (usually based on physical characteristics) may differ from lived identity. Both pieces of information help better understand connections between gender and social experiences.",
    Q122: "Romantic and sexual orientation influences many areas of life and is relevant for questions of equality and social participation. All information is, of course, voluntary.",
    Q004: "Differences between federal states are relevant in many political and social issues – for example due to different governing parties, economic structures, or historical influences (East/West).",
    Q005: "The size of the place of residence significantly influences living conditions, infrastructure, mobility options, and political attitudes.",
    Q121: "The postal code allows for a more detailed geographical analysis than federal state alone – e.g., differences between urban districts or regions within a state. The postal code is only evaluated in aggregated form.",
    Q006: "Place of residence and place of work can differ significantly (commuting). The workplace shapes daily life and may influence political perceptions.",
    Q007: "Educational attainment is a key indicator of social class and correlates with many political and economic attitudes.",
    Q008: "A university degree is recorded separately, as it highlights educational differences within the same school qualification group.",
    Q009: "Vocational and skilled trades training are often neglected in surveys but are important for understanding work and life realities.",
    Q010: "Multiple selections possible – many people have several occupations simultaneously (e.g., studying + working student job, main job + side job).",
    Q011: "The sector influences job security, income, collective agreements, and political attitudes toward the role of the state.",

    // S02 – Family & Household
    Q012: "Relationship status and living arrangements are closely linked to economic situation, care work, and political priorities.",
    Q013: "Household composition influences who performs care work, how decisions are made, and which social policy issues are most relevant.",
    Q014: "Children in the household significantly shape daily experiences, time budgets, and political topics (education, childcare, housing market).",
    Q015: "The age of the children determines which specific challenges (daycare, school, training) are currently relevant.",
    Q016: "Children outside the household – e.g., after separation – often involve maintenance obligations and shared parenting responsibilities.",
    Q017: "Care work for relatives is often invisible, time-intensive, and has major economic impacts – especially for women.",
    Q018: "The distribution of household and care work is a key equality issue and affects employment opportunities and economic independence.",

    // S03 – Economy & Finances
    Q019: "Household income allows conclusions about economic situation and social class. This refers to the total monthly net income of all people in the household.",
    Q020: "Wealth (not just income) significantly determines economic security and opportunities for action. Rough estimates are completely sufficient.",
    Q021: "Debt beyond mortgages (e.g., consumer loans, student loans) can severely limit financial flexibility.",
    Q022: "Government transfers show which population groups rely on social security systems – important for social policy analyses.",
    Q023: "Ownership vs. renting is a central wealth issue in Germany with implications for financial security and political attitudes.",
    Q024: "A high rent burden (>30% of income) is considered financially stressful and is an indicator of housing shortage.",
    Q025: "The subjective comparison to one's own past provides insight into perceived prosperity – independent of absolute income level.",
    Q026: "Expectations about the future strongly influence consumption, investments, and political attitudes.",
    Q027: "Intergenerational mobility – whether one is better off than their parents – is a core indicator of equal opportunity.",
    Q028: "Union membership is an indicator of political engagement and attitudes toward labor rights.",

    // S04 – Political Orientation
    Q029: "This scale captures the basic economic and social policy orientation: those who want to preserve what exists tend to the left; those who strive for change and renewal to the right. The center indicates a balanced position.",
    Q030: "This axis measures attitudes toward state control: authoritarian means a preference for a strong state, clear rules, and collective order. Libertarian means a preference for individual freedom and less state intervention.",
    Q031: "This and the following statements form a scientific populism scale (after Akkerman/Mudde). They measure how strongly one believes that 'the people' stand against 'the elite' and that direct public influence is more important than representative democracy.",
    Q032: "Part of the populism scale. Measures preference for direct democracy over representative decision-making.",
    Q033: "Part of the populism scale. Measures perception of a fundamental divide between 'ordinary people' and a detached elite.",
    Q034: "Part of the populism scale. Measures distrust toward professional politicians.",
    Q035: "Part of the populism scale. Measures perception of politics as ineffective talk.",
    Q036: "Part of the populism scale. Measures whether compromise is perceived as weakness or betrayal – a core element of populist thinking.",
    Q037: "Your actual voting decision in the last federal election (second vote) allows comparison with current voting intentions. 'Did not vote' includes deliberate abstention.",
    Q038: "Hypothetical voting intention shows current political sentiment and possible changes compared to the last election result.",
    Q039: "Certainty of voting decision indicates the size of the potential swing voter pool.",
    Q040: "Coalition preferences show which party constellations are considered desirable by the population – independent of personal voting intentions.",

    // S05 – Party Competence
    Q041: "Which party is most trusted to solve economic problems and preserve jobs?",
    Q042: "Internal security is a key campaign issue – this question shows which party is most trusted in this area.",
    Q043: "Climate protection and environmental policy are gaining importance. Party competence in this area has changed significantly in recent years.",
    Q044: "Education policy lies with the federal states in Germany – nevertheless, parties at the federal level have different approaches and priorities.",
    Q045: "Migration and integration are central campaign issues. Perceived competence has shifted significantly over recent elections.",
    Q046: "Social justice and redistribution – which party is most trusted here?",
    Q047: "Foreign and defense policy has regained focus since the Ukraine war and NATO debates.",
    Q048: "Digitalization and AI are key future topics – which party is considered competent here?",
    Q049: "Health policy and care affect almost all population groups, especially due to demographic change.",

    // S06 – Satisfaction & Trust
    Q050: "Government satisfaction is one of the most commonly used indicators in political research and allows comparisons over time and between governments.",
    Q051: "Important: This question refers to the principle of democracy, not the current government. Together, both values show whether dissatisfaction is systemic or government-related.",
    Q052: "An open question allows you to name specific criticisms that may not be covered by predefined questions.",
    Q053: "The Federal Constitutional Court is the highest legal institution. Trust in it is an indicator of trust in the rule of law.",
    Q054: "Trust in the police is central for societal acceptance of state security institutions.",
    Q055: "Trust in the Bundestag measures confidence in the main democratic institution.",
    Q056: "Trust in public broadcasters is particularly relevant in Germany, as ARD and ZDF are funded by broadcasting fees.",
    Q057: "Private media are shaped by advertising and ownership interests – this may influence their credibility.",
    Q058: "Trust in the Bundeswehr and its leadership has become particularly relevant since the 2022 turning point.",
    Q059: "Trust in the EU as an institution – independent of evaluation of individual decisions.",
    Q060: "Trust in religious communities can provide insight into social cohesion and credibility issues.",
    Q061: "Trust in science has been widely discussed, especially since the pandemic.",
    Q062: "Generalized interpersonal trust ('most people can be trusted') is a core feature of social cohesion and known from surveys like SOEP.",
    Q063: "Media usage behavior explains many differences in opinion. Particularly relevant: which sources people use as primary political information.",

    // S07 – Topics & Attitudes
    Q064: "Free text response: Which specific topics concern you most personally? There are no predefined categories.",
    Q065: "Subjective sense of security can differ significantly from statistical crime levels and is strongly influenced by media reporting.",
    Q066: "This scale captures economic policy orientation: should the state actively reduce inequalities (redistribution), or should individuals be responsible for their own well-being (personal responsibility)?",
    Q067: "Political engagement beyond voting indicates social participation and civic involvement.",

    // S08 – Energy & Mobility
    Q068: "The nuclear power debate is particularly intense in Germany. This question captures your position on continued operation of existing plants and possible new construction.",
    Q069: "Renewable energy is largely politically consensual, but the pace of expansion and effects on landscape and energy prices are disputed.",
    Q070: "Fossil fuels (coal, oil, gas) are central in the debate between energy security and climate protection – especially after the Ukraine war.",
    Q071: "Electric mobility is state-supported but controversial regarding range, charging infrastructure, and costs.",
    Q072: "The current heating system provides insight into personal exposure to heating transition policies.",
    Q073: "The Building Energy Act (GEG 2024) is one of the most controversial projects of recent years. This question captures your general stance.",
    Q074: "Germany is one of the few countries without a general highway speed limit. The debate touches on freedom, safety, and climate protection.",
    Q075: "Current train usage provides context for the following questions on potential changes.",
    Q076: "Price as a barrier: Would lower costs change your travel behavior?",
    Q077: "The €9 ticket (2022) and the Deutschlandticket show that free access increases usage but does not solve reliability issues.",
    Q078: "Reliability as a barrier: Would more punctual trains change your behavior?",
        // S09 – Geopolitics
    Q079: "Please evaluate the Russian government as a political actor – not the Russian people or culture.",
    Q080: "Evaluate Vladimir Putin as a person and political decision-maker – independent of your assessment of Russia as a country.",
    Q081: "The US government as a foreign policy actor – not the USA as a country or society.",
    Q082: "Evaluate Donald Trump as a person and political decision-maker.",
    Q083: "The Israeli government as a political actor – not Israel as a country or Jewish people in general.",
    Q084: "Evaluate Benjamin Netanyahu as a person and head of government – independent of your stance on Israel.",
    Q085: "The Palestinian Authority (PA) is the official representation of Palestinians in the West Bank.",
    Q086: "Hamas is the governing authority in the Gaza Strip – please evaluate it as a political-military leadership.",
    Q087: "The Chinese government as a foreign and economic policy actor.",
    Q088: "Xi Jinping as a person and decision-maker.",
    Q089: "The Taiwanese government as an independent political actor in the context of the conflict with China.",
    Q090: "The EU as a political project and institution – independent of individual decisions.",
    Q091: "The current European Commission as a concrete body with specific individuals and policies.",
    Q092: "Multiple selections possible. This question allows nuanced positions on the Ukraine war – for example, support for Ukraine does not exclude willingness to negotiate.",

    // S10 – Religion
    Q093: "Religious affiliation influences many attitudes toward ethics, family, and societal issues.",
    Q094: "The frequency of religious practice (services, prayer, etc.) shows how strongly religion actually shapes daily life.",
    Q095: "Independent of formal membership: how important is religion as a framework for orientation in your life?",

    // S11 – Origin & Background
    Q096: "Your own migration experience (not that of your parents) influences life experiences and perspectives.",
    Q097: "Mother’s country of birth as an indicator of family migration background – important for understanding integration trajectories.",
    Q098: "Father’s country of birth – analogous to the mother question.",
    Q099: "Grandparent generation on the father’s side – enables classification of migration and integration trajectories across multiple generations.",
    Q100: "Grandparent generation on the mother’s side – analogous.",
    Q108: "Citizenship(s) – multiple selections possible (e.g., dual citizenship).",
    Q109: "Eligibility to vote in federal elections requires German citizenship.",
    Q110: "For European elections, EU citizens in Germany are also eligible to vote – not only Germans.",
    Q111: "For people without a German passport: do you plan to apply for naturalization? This provides insight into integration intentions.",
    Q112: "Residence status defines legal rights and obligations and is a key characteristic of the life situation of people without a German passport.",
        // S14 – Experiences in Germany
    Q113: "How long have you been living in Germany? This provides context for language skills, integration, and orientation.",
    Q114: "Fled alone or with family – an important factor for social integration and resilience.",
    Q115: "Overall satisfaction with Germany as a host country – independent of specific aspects.",
    Q116: "The housing situation (shared accommodation, private apartment, etc.) has a major impact on well-being and integration.",
    Q117: "How do you evaluate government support services – social benefits, counseling, integration assistance?",
    Q118: "The asylum process is often long and opaque. How do you experience its duration, communication, and fairness?",
    Q119: "Access to work and education is one of the most important factors for integration and independence.",
    Q120: "Language courses are central to integration – how do you assess their quality and availability?",

    // S12 – Legal Experiences
    Q101: "This question is fully anonymous. It helps to understand whether law enforcement is socially selective. 'Minor offense' includes, for example, fare evasion or minor administrative violations.",
    Q102: "Have you ever been reported to the police for a criminal offense? Regardless of whether this led to a conviction.",
    Q103: "A criminal conviction by a court – regardless of type of penalty (fine, probation, imprisonment).",

    // S13 – Life Satisfaction
    Q104: "The standard SOEP (Socio-Economic Panel) question on general life satisfaction. Enables comparison with representative population surveys.",
    Q105: "Loneliness is a growing societal issue with significant impacts on health and political attitudes.",
    Q106: "The strength of social networks is a key protective factor for psychological well-being.",
    Q107: "Contact beyond political 'bubbles' – an indicator of social cohesion or polarization.",
        // S15 – Attitudes & Self-Perception
    Q123: "Political self-confidence influences engagement and participation. Uncertainty in political topics is widespread and not a sign of ignorance.",
    Q124: "Flexibility of opinion is a sign of critical thinking. This question measures how open you are to new information.",
    Q125: "The subjective perception of political complexity influences how people process political information and whether they feel addressed.",
    Q126: "Social media are an important source of information for many people but are also considered prone to misinformation.",
    Q127: "Active fact-checking is a key competence for political opinion formation in the digital public sphere.",
    Q128: "Everyday political conversations are an indicator of political engagement and social connectedness.",
    Q129: "The conscious avoidance of contradictory information ('confirmation bias' / echo chamber behavior) is a well-researched phenomenon in political psychology.",
    Q130: "Digital competence determines how well people can assess and use online information.",
    Q131: "AI usage in everyday life is changing how people search for information, process it, and make decisions.",
    Q132: "AI in political processes (e.g., automated decisions, algorithms in administration) is a growing socio-political issue.",
    Q133: "This classic value scale measures the fundamental orientation between collective security and individual freedom – a central tension in political philosophy.",
    Q134: "The tension between equality and meritocracy is one of the most fundamental value dimensions in society.",
    Q137: "This question measures attitudes toward wealth inequality and thus the perceived legitimacy of differences in wealth.",
    Q135: "Optimism/pessimism about Germany’s future is an important indicator of social trust and political stability.",
    Q136: "Perceptions of threat vary greatly depending on political orientation, age, and social situation.",
    Q138: "This question is used for survey quality control. Please deliberately select the option 'tend to disagree' (value 2). Answers that deviate significantly indicate random clicking.",
    Q139: "Impairments significantly influence social participation, political priorities, and experiences with state systems.",
    Q140: "Different types of impairments bring different challenges – this differentiation is important for political analysis.",
    Q141: "The extent to which an impairment affects social participation varies greatly depending on type, support, and societal conditions.",

    // S16 – Feedback
    Q142: "Your feedback helps improve the survey and optimize it for future studies.",
    Q143: "Missing topics provide important input for further development of the study.",
    Q144: "This information helps understand through which channels the survey is distributed – important for assessing sampling bias.",

    // S17 – Discrimination & Equality
    Q145: "This refers to personally experienced situations in which you were treated unfairly – regardless of whether this qualifies as legal discrimination.",
    Q146: "Multiple selections possible. This question targets the perceived reason for the disadvantage from your perspective.",
    Q147: "The area of discrimination provides insight into structural patterns – e.g., whether disadvantages occur particularly in the labor market or with authorities.",
    Q148: "Discrimination can come from private individuals as well as institutions – both are socially relevant.",
    Q149: "Many experiences of discrimination are not reported. The relationship between experience and reporting provides insight into barriers to accessing the legal system.",
    Q150: "Personal impact shows how profoundly discrimination experiences can affect one’s life.",
    Q151: "Voluntary entry without predefined categories – because ethnic identity is complex and does not fit into fixed boxes.",
    Q152: "Intentionally formulated without naming specific relationship types to include all constellations – same-sex, trans, non-binary, etc.",
    Q153: "Formulated without gender reference to include all relationship models – regardless of who takes on which role.",
    Q154: "This question measures perceptions of structural racism – a central and controversial topic in Germany.",
    Q155: "Measures perception of gender discrimination as a structural issue, not an individual case.",
    Q156: "Quotas and support measures are socially controversial – this question captures general attitudes toward them.",
    Q157: "This counter-question allows people who feel fatigue or frustration with equality debates to express that – important for a complete picture.",
}
    // Tooltip translations can be added here.
    // Falls leer → automatischer Fallback auf Deutsch (via useTooltip unten).
  },
};

// Fallback: wenn Tooltip in gewählter Sprache fehlt, DE nehmen
const useTooltip = (lang, qid) =>
  (TOOLTIPS[lang]?.[qid]) ?? (TOOLTIPS["de"]?.[qid]) ?? null;

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
            title={tipOpen ? "Erklärung schließen" : "Erklärung anzeigen"}
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
  ]},
  {id:"S03",title:"Wirtschaft & Finanzen",questions:[
    {id:"Q019",text:"Monatliches Haushaltsnettoeinkommen?",type:"radio",opts:["< 1.000 €","1.000–1.500 €","1.500–2.000 €","2.000–2.500 €","2.500–3.000 €","3.000–4.000 €","4.000–5.000 €","5.000–7.500 €","7.500–10.000 €","> 10.000 €"]},
    {id:"Q020",text:"Geschätztes Nettovermögen (Immobilien + Ersparnisse + Aktien – Schulden)?",type:"radio",opts:["Negativ","0–10.000 €","10.000–50.000 €","50.000–150.000 €","150.000–300.000 €","300.000–500.000 €","500.000 €–1 Mio.","1–2 Mio. €","> 2 Mio. €"]},
    {id:"Q021",text:"Schulden (ohne laufende Hypothek)?",type:"radio",opts:["Keine","< 5.000 €","5.000–20.000 €","20.000–50.000 €","> 50.000 €"]},
    {id:"Q022",text:"Staatliche Transferleistungen (Mehrfachauswahl)?",type:"check",opts:["Keine","Bürgergeld","Wohngeld","Kindergeld","BAföG","Elterngeld","Pflegegeld","Erwerbsminderungsrente","Sonstige"]},
    {id:"Q023",text:"Wohnsituation?",type:"radio",opts:["Miete","Eigentum (abbezahlt)","Eigentum (Kredit läuft)","Mietfrei (z.B. Familie)","Sonstiges"]},
    {id:"Q024",text:"Mietbelastung (% des HH-Einkommens)?",type:"radio",opts:["< 20 %","20–30 %","30–40 %","40–50 %","> 50 %","Eigentümer, keine Miete"],skip_if:{q:"Q023",op:"in",val:["Eigentum (abbezahlt)","Eigentum (Kredit läuft)"]}},
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
    case "party_single": return <PartyCombobox val={val} onChange={onChange} extras={q.extras||[]}/>;
    case "party_multi":  return <PartyMultiCombobox val={val} onChange={onChange}/>;
    case "plz":          return <PlzInput val={val} onChange={onChange}/>;
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
  }, [resp]);  // eslint-disable-line
  useEffect(() => {
    storage.set("survey_v1_resp", JSON.stringify(resp)).catch(() => {});
  }, [resp]);

  const answered   = Object.keys(resp).length;
  const pct        = Math.round(answered / TOTAL * 100);
  const sec        = SECTIONS[si];
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
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

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
              <script type="module"
                src="https://cdn.jsdelivr.net/npm/@friendlycaptcha/sdk/site.min.js"
                crossorigin="anonymous" defer></script>
              <div class="frc-captcha" data-sitekey="FCMS9RCA6232KR7L"></div>

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
                <button onClick={doSubmit} disabled={sending || (newsletterEmail.length > 0 && !emailValid)}
                  style={{ flex: 2, padding: "10px", border: "none", borderRadius: "8px",
                    background: sending ? "#94a3b8" : (newsletterEmail.length > 0 && !emailValid) ? "#e2e8f0" : "#3b82f6",
                    color: (newsletterEmail.length > 0 && !emailValid) ? "#94a3b8" : "#fff",
                    cursor: sending || (newsletterEmail.length > 0 && !emailValid) ? "not-allowed" : "pointer",
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
                {s.id}
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
            <span style={{ fontFamily: "monospace", fontSize: "12px", background: "#dbeafe", color: "#1d4ed8", padding: "2px 8px", borderRadius: "5px", fontWeight: "600" }}>{sec.id}</span>
            <h2 style={{ margin: 0, fontSize: "20px", fontWeight: "700", color: "#0f172a" }}>{sec.title}</h2>
            <span style={{ marginLeft: "auto", fontSize: "12px", color: "#94a3b8" }}>{secDone}/{secVisible.length}</span>
          </div>
          {sec.description && (
            <div style={{ fontSize: "13px", background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: "8px", padding: "10px 14px" }}>
              {sec.description}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
          {sec.questions.map(q => {
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
                {q.group_header && (
                  <div style={{ fontSize: "13px", fontWeight: "600", color: "#475569", background: "#f1f5f9", borderRadius: "8px", padding: "8px 12px", marginBottom: "8px", marginTop: "4px" }}>
                    {q.group_header}
                  </div>
                )}
                <QuestionCard
                  q={q}
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
