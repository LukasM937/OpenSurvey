# Projekt-Roadmap – Deutsche Gesellschaftsstudie

Stand: April 2026  
Domain: survey.muehrke.de  
Stack: React (Vite / claude.ai Artifact) · FastAPI · Apache · systemd

---

## Aktueller Stand (v1.1)

- [x] 157 Fragen in 17 Sektionen
- [x] Skip-Logik (6 Operatoren, ~20 Regeln)
- [x] i18n-Framework (DE vollständig, EN/TR/UK/PL partiell)
- [x] Parteien-Autocomplete (29 Parteien)
- [x] Server: FastAPI, gehärtet, monatliche Unterordner
- [x] Schema-Hash-Validierung (Client ↔ Server)
- [x] Anonyme Einreichung (kein IP-Logging)
- [x] Grafana-kompatibler /health-Endpoint
- [x] Newsletter: RSA-4096 + AES-256-GCM hybrid encryption
- [x] Projektstruktur: src/ + deploy/ getrennt
- [x] Storage-Adapter (claude.ai Artifact + localStorage)
- [x] Apache vHost + TLS-Config (deploy/)
- [x] Systemd-Unit mit Hardening
- [x] Aggregator mit k-Anonymitäts-Export
- [x] Admin-Dashboard (Token-geschützt, nur lokal / Tailscale)
- [x] Öffentliche Ergebnisseite (/results)

---

## Geplante Features

### A – Übersetzungen (Priorität: mittel)

Alle 157 Fragen-Texte in:
- Englisch (EN) — Framework vorhanden
- Türkisch (TR) — Framework vorhanden
- Ukrainisch (UK) — Framework vorhanden
- Polnisch (PL) — Framework vorhanden
- Arabisch (AR)
- Französisch (FR)

**Ansatz:**
- Separates `translations.json` neben `umfrage.jsx`
- DeepL API für Erstentwürfe, manuelle Korrektur
- Community-Review via GitHub Pull Requests

---

### B – Datenveröffentlichung (Priorität: nach Sammlung)

Ab ca. 500 Einreichungen erste Veröffentlichung.

**Plattform:** Zenodo (CERN, kostenlos, DOI-Vergabe → zitierbar)

**Format:**
- Aggregierter Datensatz als JSON (k-anonymisiert via /admin/api/export)
- Rohdaten als CSV (ohne Freitextfelder, ohne PLZ)
- Codebuch (Fragen-IDs → Beschreibungen)
- Lizenz: CC BY 4.0

**Was veröffentlicht wird:**
- Alle Multiple-Choice- und Skalen-Antworten
- `_received_at` auf Monat+Jahr gerundet
- Sprache, Version

**Was nicht veröffentlicht wird:**
- Freitextfelder (Q052, Q064) — Re-Identifikationsrisiko
- PLZ (Q121) — nur auf Bundesland-Ebene aggregiert
- Session-IDs

**K-Anonymitäts-Regel (implementiert in aggregator.py):**
- Bundesland-Auflösung nur wenn ≥ 50 Einreichungen aus diesem Bundesland
- Supprimierte Bundesländer fließen in Gesamtstatistik ein, erscheinen aber nicht einzeln

---

### C – Reichweite / Distribution (Priorität: laufend)

**Phase 1 – Soft Launch**
- [ ] Eigenes Netzwerk, Kolleg:innen
- [ ] Ausfüllzeit messen (Ziel: < 12 Minuten)
- [ ] Bugs und UX-Probleme sammeln

**Phase 2 – Reddit**
- [ ] r/de, r/Germany, r/politik, r/fragreddit
- [ ] r/datenschutz (passt zum Open-Source-Ansatz)
- [ ] Bundesland-Subreddits für regionale Streuung

**Phase 3 – Diversifizierung**
- [ ] Facebook-Gruppen (Eltern, Rentner:innen, Berufsgruppen)
- [ ] Mastodon / Fediverse
- [ ] Lokale Zeitungen / Stadtportale

**Phase 4 – Medien (ab ~300 Einreichungen)**
- [ ] netzpolitik.org
- [ ] Lokale Hamburger Medien (Abendblatt, taz Hamburg)

---

### Reddit Post-Template

```
Titel: [Umfrage] Deutsche Gesellschaftsstudie –
       Demografie, Wahlverhalten, Einstellungen (anonym, Open Source)

Hallo r/de,

ich betreibe aus privatem Interesse eine Umfrage zu Demografie,
Wahlverhalten, politischen Einstellungen und Lebensverhältnissen
in Deutschland.

Zur Umfrage: survey.muehrke.de
Dauer: ca. 10–12 Minuten
Sprachen: Deutsch, Englisch, Türkisch, Ukrainisch, Polnisch

Datenschutz:
- Vollständig anonym – keine IP-Adressen, kein Tracking
- Quellcode öffentlich auf GitHub
- Alle Daten werden nach Abschluss anonym veröffentlicht (Zenodo)

Würde mich über rege Beteiligung freuen – und besonders über
Weiterleitung an Menschen die normalerweise nicht auf Reddit sind.
```

---

## Technische Schulden / bekannte Einschränkungen

- Freitextfelder (Q052, Q064) nicht volltextindiziert
- Rate Limiting ist In-Memory → bei Neustart zurückgesetzt
- Keine automatische chattr-Rotation (läuft per Cron, manuell einzurichten)
- Stichprobe ist nicht repräsentativ (Self-Selection Bias)
- Parteilisten-Aktualität muss manuell gepflegt werden
- Ergebnisseite zeigt CDN-Charts (Chart.js) — offline nicht nutzbar

---

## Antwort-Kodierung

| Wert | Bedeutung |
|------|-----------|
| `1`–`5` / `1`–`7` / `0`–`10` | Skala beantwortet |
| `"CDU"` / `"Ja"` / … | Radio/Party beantwortet |
| `["Opt1","Opt2"]` | Mehrfachauswahl |
| `-1` | Numerisch, nicht beantwortet |
| `"__ka__"` | „Keine Angabe" gewählt |
| `"__skipped__"` | Durch Skip-Logik ausgeblendet |
