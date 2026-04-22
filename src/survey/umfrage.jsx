import { useEffect, useRef, useState } from "react";

const KA = "__ka__";

// ↓ Server-Endpunkt hier eintragen
const SERVER_URL = "https://api.muehrke.de/api/survey";

// ── [F] Schema-Hash ───────────────────────────────────────────
// SHA-256 über sorted(alle Fragen-IDs) als kompaktes JSON-Array.
// Muss mit SCHEMA_HASH im server.py übereinstimmen.
// Neu berechnen wenn Fragen hinzugefügt/entfernt werden:
//   python3 -c "import hashlib,json; ids=sorted(['Q001',...,'Q108']); print(hashlib.sha256(json.dumps(ids,separators=(',',':')).encode()).hexdigest())"
const SCHEMA_HASH = "b659a728a1147f0f2ea35727ac21fab2046f92c36be751eb594e5f6ad762615f";

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

function shouldSkip(q, resp) {
  if (!q.skip_if) return false;
  const { q: depId, op, val } = q.skip_if;
  const depVal = resp[depId];
  // Nicht beantwortet oder Keine Angabe → nie überspringen
  if (depVal === undefined || depVal === KA) return false;
  switch (op) {
    case "eq":    return depVal === val;
    case "neq":   return depVal !== val;
    case "lt":          return typeof depVal === "number" && depVal < val;
    case "lte":         return typeof depVal === "number" && depVal <= val;
    case "in":          return Array.isArray(val) && val.includes(depVal);
    case "notin":       return Array.isArray(val) && !val.includes(depVal);
    // Für Check-Felder (Array-Antworten):
    case "contains":    return Array.isArray(depVal) && depVal.includes(val);
    case "notcontains": return Array.isArray(depVal) && !depVal.includes(val);
    default:      return false;
  }
}

// Alle Fragen-IDs die aktuell übersprungen werden (über alle Sektionen)
function getSkippedIds(resp) {
  const skipped = new Set();
  for (const sec of SECTIONS) {
    for (const q of sec.questions) {
      if (shouldSkip(q, resp)) skipped.add(q.id);
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
  },
  en: {
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
  const scrollRef = useRef(null); // owns the scroll container

  // ── Load saved state (non-blocking, fires in background) ──
  useEffect(() => {
    (async () => {
      try { const r = await window.storage.get("survey_v1_resp"); if (r?.value) setResp(JSON.parse(r.value)); } catch {}
      try { const r = await window.storage.get("survey_v1_id");   if (r?.value) setSurveyId(r.value); else window.storage.set("survey_v1_id", surveyId).catch(()=>{}); } catch {}
      try { const r = await window.storage.get("survey_v1_sub");  if (r?.value === "1") setSubmitted(true); } catch {}
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
    window.storage.set("survey_v1_resp", JSON.stringify(resp)).catch(() => {});
  }, [resp]);

  const answered   = Object.keys(resp).length;
  const pct        = Math.round(answered / TOTAL * 100);
  const sec        = SECTIONS[si];
  const skippedIds = getSkippedIds(resp);
  const secVisible = sec.questions.filter(q => !skippedIds.has(q.id));
  const secDone    = secVisible.filter(q => resp[q.id] !== undefined).length;

  const setR = (id, v) => setResp(p => v === undefined ? (({ [id]: _, ...r }) => r)(p) : { ...p, [id]: v });

  // ── Navigation with scroll-to-top ──
  const go = d => {
    setSi(p => Math.max(0, Math.min(SECTIONS.length - 1, p + d)));
    setTimeout(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, 30);
  };

  const jumpTo = i => {
    setSi(i);
    setTimeout(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, 30);
  };

  // ── JSON export – show in modal (works everywhere incl. iOS) ──
  const exportJSON = () => setShowJSON(true);

  // ── Server submit ──
  const doSubmit = async () => {
    setSending(true);
    setSendError(null);
    try {
      const normalized = normalizeResponses(resp, SECTIONS);
      const res = await fetch(SERVER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: surveyId,
          schema_hash: SCHEMA_HASH,
          submitted_at: new Date().toISOString(),
          version: "1.0.0",
          lang,
          answered,
          total: TOTAL,
          responses: normalized,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      window.storage.set("survey_v1_sub", "1").catch(() => {});
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
    <div style={{ minHeight: "100vh", background: "#f0fdf4", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "system-ui", padding: "24px" }}>
      <div style={{ maxWidth: "460px", textAlign: "center" }}>
        <div style={{ fontSize: "56px", marginBottom: "16px" }}>✓</div>
        <h1 style={{ fontSize: "22px", color: "#166534", margin: "0 0 12px" }}>{t.thanksTitle}</h1>
        <p style={{ color: "#4d7c5f", lineHeight: 1.6, margin: "0 0 8px", fontSize: "14px" }}>
          {t.thanksBody}
        </p>
        <p style={{ color: "#86a394", fontSize: "12px", margin: "0 0 28px" }}>
          {t.thanksNote}
        </p>
        <button onClick={() => setSubmitted(false)}
          style={{ padding: "9px 20px", border: "1px solid #bbf7d0", borderRadius: "8px", background: "#fff", color: "#166534", cursor: "pointer", fontSize: "13px" }}>
          {t.viewAgain}
        </button>
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
      {modal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <div style={{ background: "#fff", borderRadius: "16px", padding: "24px", maxWidth: "400px", width: "100%", boxShadow: "0 20px 60px rgba(0,0,0,.25)" }}>
            <h2 style={{ margin: "0 0 16px", fontSize: "18px", color: "#0f172a" }}>{t.modalTitle}</h2>
            <div style={{ fontSize: "13px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "8px", padding: "12px 14px", color: "#166534", lineHeight: 1.6, marginBottom: "14px" }}>
              {t.privacyNote}
            </div>
            <div style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "18px" }}>
              {t.answered(answered, TOTAL)}
            </div>
            {submitted && (
              <div style={{ fontSize: "12px", color: "#d97706", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: "6px", padding: "8px 12px", marginBottom: "14px" }}>
                {t.dupWarning}
              </div>
            )}
            {sendError && (
              <div style={{ fontSize: "13px", color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: "8px", padding: "10px", marginBottom: "14px" }}>
                {sendError}
              </div>
            )}
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={() => { setModal(false); setSendError(null); }}
                style={{ flex: 1, padding: "10px", border: "1px solid #e2e8f0", borderRadius: "8px", background: "#fff", cursor: "pointer", fontSize: "14px", color: "#374151" }}>
                {t.cancel}
              </button>
              <button onClick={doSubmit} disabled={sending}
                style={{ flex: 2, padding: "10px", border: "none", borderRadius: "8px", background: sending ? "#94a3b8" : "#3b82f6", color: "#fff", cursor: sending ? "not-allowed" : "pointer", fontSize: "14px", fontWeight: "600" }}>
                {sending ? t.sending : t.submit}
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Section tabs */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e2e8f0", overflowX: "auto" }}>
        <div style={{ maxWidth: "720px", margin: "0 auto", padding: "8px 16px", display: "flex", gap: "4px", whiteSpace: "nowrap" }}>
          {SECTIONS.map((s, i) => {
            const vis  = s.questions.filter(q => !skippedIds.has(q.id));
            const done = vis.filter(q => resp[q.id] !== undefined).length;
            const full = vis.length > 0 && done === vis.length;
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
                overflow: "hidden",
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
          <button onClick={() => go(-1)} disabled={si === 0}
            style={{ padding: "9px 18px", fontSize: "13px", fontWeight: "600", border: "1px solid #e2e8f0", borderRadius: "8px", background: "#fff", cursor: si === 0 ? "not-allowed" : "pointer", opacity: si === 0 ? 0.4 : 1, color: "#374151" }}>
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

          {si < SECTIONS.length - 1 ? (
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
          {t.section(si + 1, SECTIONS.length)}
        </p>
      </div>
    </div>
  );
}
