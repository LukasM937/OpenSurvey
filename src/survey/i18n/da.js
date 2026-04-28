// Danish (Dansk) — section titles only; UI falls back to German
// ui:        UI strings (buttons, titles, notes). null → falls back to German.
// tooltips:  Per-question explanation text.       null → falls back to German.
// questions: Question text / option overrides.    null → uses German from SECTIONS.
// sections:  Section title / description.         null → uses German from SECTIONS.
export default {
  ui: null,
  tooltips: null,
  questions: null,
  sections: {

    S01: { title: "Sociodemografi" },
    S02: { title: "Familie & Husstand" },
    S03: { title: "Økonomi & Finans" },
    S04: { title: "Politisk orientering" },
    S05: { title: "Partikompetence", description: "Hvilket parti stoler du mest på til at være kompetent på følgende områder?" },
    S06: { title: "Tilfredshed & Tillid" },
    S07: { title: "Emner & Holdninger" },
    S08: { title: "Energi & Mobilitet" },
    S09: { title: "Geopolitik", description: "Bemærk: spørgsmålene refererer til den pågældende regering eller embedsmand – ikke til landet eller dets folk." },
    S10: { title: "Religion & Verdenssyn" },
    S11: { title: "Oprindelse & Baggrund" },
    S12: { title: "Juridiske erfaringer", description: "⚠️ Denne undersøgelse er fuldstændig anonym. Der gemmes ingen personlige data. 'Intet svar' er altid gyldigt." },
    S13: { title: "Livstilfredshed" },
    S14: { title: "Erfaringer i Tyskland", description: "Dette afsnit henvender sig til personer med flygtningestatus eller asylansøgerstatus. Alle oplysninger er frivillige og fuldstændig anonyme." },
    S15: { title: "Holdninger & Selvopfattelse" },
    S16: { title: "Feedback & Kontakt", description: "Har du kommentarer eller forslag til forbedringer? Alle indtastninger er frivillige og anonyme." },
    S17: { title: "Diskrimination & Ligestilling", description: "Disse spørgsmål vedrører personlige erfaringer og samfundsmæssige holdninger. Alle indtastninger er frivillige og anonyme." },
    S18: { title: "Skattepolitik", description: "Hvad er din holdning til følgende skattepolitiske foranstaltninger?" },
    S19: { title: "Afhængighed & Stofbrug", description: "Alle indtastninger er frivillige og anonyme. 'Intet svar' er altid gyldigt." },
  
  },
};
