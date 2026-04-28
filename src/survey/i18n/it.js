// Italian (Italiano) — section titles only; UI falls back to German
// ui:        UI strings (buttons, titles, notes). null → falls back to German.
// tooltips:  Per-question explanation text.       null → falls back to German.
// questions: Question text / option overrides.    null → uses German from SECTIONS.
// sections:  Section title / description.         null → uses German from SECTIONS.
export default {
  ui: null,
  tooltips: null,
  questions: null,
  sections: {

    S01: { title: "Sociodemografia" },
    S02: { title: "Famiglia & Nucleo familiare" },
    S03: { title: "Economia & Finanze" },
    S04: { title: "Orientamento politico" },
    S05: { title: "Competenza dei partiti", description: "Di quale partito si fida di più in termini di competenza nei seguenti settori?" },
    S06: { title: "Soddisfazione & Fiducia" },
    S07: { title: "Temi & Atteggiamenti" },
    S08: { title: "Energia & Mobilità" },
    S09: { title: "Geopolitica", description: "Nota: le domande si riferiscono al rispettivo governo o titolare della carica – non al paese né al suo popolo." },
    S10: { title: "Religione & Visione del mondo" },
    S11: { title: "Origine & Background" },
    S12: { title: "Esperienze legali", description: "⚠️ Questo sondaggio è completamente anonimo. Non vengono memorizzati dati personali. 'Nessuna risposta' è sempre valido." },
    S13: { title: "Soddisfazione di vita" },
    S14: { title: "Esperienze in Germania", description: "Questa sezione è rivolta a persone con status di rifugiato o richiedente asilo. Tutte le informazioni sono volontarie e completamente anonime." },
    S15: { title: "Atteggiamenti & Auto-percezione" },
    S16: { title: "Feedback & Contatto", description: "Ha commenti o suggerimenti per migliorare? Tutti i dati inseriti sono volontari e anonimi." },
    S17: { title: "Discriminazione & Uguaglianza", description: "Queste domande riguardano esperienze personali e atteggiamenti sociali. Tutti i dati inseriti sono volontari e anonimi." },
    S18: { title: "Politica fiscale", description: "Qual è la sua posizione sulle seguenti misure di politica fiscale?" },
    S19: { title: "Dipendenza & Uso di sostanze", description: "Tutti i dati inseriti sono volontari e anonimi. 'Nessuna risposta' è sempre valido." },
  
  },
};
