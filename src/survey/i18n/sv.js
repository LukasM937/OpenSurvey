// Swedish (Svenska) — section titles only; UI falls back to German
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
    S02: { title: "Familj & Hushåll" },
    S03: { title: "Ekonomi & Finans" },
    S04: { title: "Politisk orientering" },
    S05: { title: "Partikompetens", description: "Vilket parti litar du mest på att vara kompetent inom följande områden?" },
    S06: { title: "Tillfredsställelse & Tillit" },
    S07: { title: "Ämnen & Attityder" },
    S08: { title: "Energi & Mobilitet" },
    S09: { title: "Geopolitik", description: "Obs: frågorna avser den aktuella regeringen eller befattningshavaren – inte landet eller dess folk." },
    S10: { title: "Religion & Världsåskådning" },
    S11: { title: "Ursprung & Bakgrund" },
    S12: { title: "Juridiska erfarenheter", description: "⚠️ Denna undersökning är helt anonym. Inga personuppgifter lagras. 'Inget svar' är alltid giltigt." },
    S13: { title: "Livstillfredsställelse" },
    S14: { title: "Erfarenheter i Tyskland", description: "Det här avsnittet vänder sig till personer med flyktingstatus eller asylsökandestatus. All information är frivillig och helt anonym." },
    S15: { title: "Attityder & Självuppfattning" },
    S16: { title: "Feedback & Kontakt", description: "Har du kommentarer eller förbättringsförslag? Alla inmatningar är frivilliga och anonyma." },
    S17: { title: "Diskriminering & Jämlikhet", description: "Dessa frågor rör personliga erfarenheter och samhälleliga attityder. Alla inmatningar är frivilliga och anonyma." },
    S18: { title: "Skattepolitik", description: "Vad är din inställning till följande skattepolitiska åtgärder?" },
    S19: { title: "Beroende & Substansbruk", description: "Alla inmatningar är frivilliga och anonyma. 'Inget svar' är alltid giltigt." },
  
  },
};
