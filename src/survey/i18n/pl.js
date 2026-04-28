// Polish (Polski) — UI strings + section titles
// ui:        UI strings (buttons, titles, notes). null → falls back to German.
// tooltips:  Per-question explanation text.       null → falls back to German.
// questions: Question text / option overrides.    null → uses German from SECTIONS.
// sections:  Section title / description.         null → uses German from SECTIONS.
export default {
  ui: {

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
  tooltips: null,
  questions: null,
  sections: {

    S01: { title: "Socjodemografia" },
    S02: { title: "Rodzina & Gospodarstwo domowe" },
    S03: { title: "Gospodarka & Finanse" },
    S04: { title: "Orientacja polityczna" },
    S05: { title: "Kompetencje partii", description: "Której partii ufasz najbardziej w następujących dziedzinach?" },
    S06: { title: "Zadowolenie & Zaufanie" },
    S07: { title: "Tematy & Postawy" },
    S08: { title: "Energia & Mobilność" },
    S09: { title: "Geopolityka", description: "Uwaga: pytania dotyczą danego rządu lub piastuna urzędu – nie kraju ani jego narodu." },
    S10: { title: "Religia & Światopogląd" },
    S11: { title: "Pochodzenie & Przeszłość" },
    S12: { title: "Doświadczenia prawne", description: "⚠️ Ta ankieta jest w pełni anonimowa. Nie są przechowywane żadne dane osobowe. 'Brak odpowiedzi' jest zawsze dopuszczalny." },
    S13: { title: "Zadowolenie z życia" },
    S14: { title: "Doświadczenia w Niemczech", description: "Ten dział jest skierowany do osób ze statusem uchodźcy lub osoby ubiegającej się o azyl. Wszelkie informacje są dobrowolne i w pełni anonimowe." },
    S15: { title: "Postawy & Samopostrzeganie" },
    S16: { title: "Opinie & Kontakt", description: "Czy masz uwagi lub sugestie dotyczące ulepszeń? Wszystkie wpisy są dobrowolne i anonimowe." },
    S17: { title: "Dyskryminacja & Równość", description: "Te pytania dotyczą osobistych doświadczeń i postaw społecznych. Wszystkie wpisy są dobrowolne i anonimowe." },
    S18: { title: "Polityka podatkowa", description: "Jakie jest Twoje stanowisko wobec następujących środków polityki podatkowej?" },
    S19: { title: "Uzależnienie & Używanie substancji", description: "Wszystkie wpisy są dobrowolne i anonimowe. 'Brak odpowiedzi' jest zawsze dopuszczalny." },
  
  },
};
