// French (Français) — section titles only; UI falls back to German
// ui:        UI strings (buttons, titles, notes). null → falls back to German.
// tooltips:  Per-question explanation text.       null → falls back to German.
// questions: Question text / option overrides.    null → uses German from SECTIONS.
// sections:  Section title / description.         null → uses German from SECTIONS.
export default {
  ui: null,
  tooltips: null,
  questions: null,
  sections: {

    S01: { title: "Sociodémographie" },
    S02: { title: "Famille & Ménage" },
    S03: { title: "Économie & Finances" },
    S04: { title: "Orientation politique" },
    S05: { title: "Compétence des partis", description: "À quel parti faites-vous le plus confiance pour être compétent dans les domaines suivants ?" },
    S06: { title: "Satisfaction & Confiance" },
    S07: { title: "Sujets & Attitudes" },
    S08: { title: "Énergie & Mobilité" },
    S09: { title: "Géopolitique", description: "Remarque : les questions se réfèrent au gouvernement ou au titulaire du poste concerné – pas au pays ni à sa population." },
    S10: { title: "Religion & Vision du monde" },
    S11: { title: "Origine & Contexte" },
    S12: { title: "Expériences juridiques", description: "⚠️ Ce sondage est entièrement anonyme. Aucune donnée personnelle n'est stockée. « Pas de réponse » est toujours valide." },
    S13: { title: "Satisfaction de vie" },
    S14: { title: "Expériences en Allemagne", description: "Cette section s'adresse aux personnes ayant le statut de réfugié ou de demandeur d'asile. Toutes les informations sont volontaires et entièrement anonymes." },
    S15: { title: "Attitudes & Auto-perception" },
    S16: { title: "Commentaires & Contact", description: "Avez-vous des commentaires ou des suggestions d'amélioration ? Toutes les entrées sont volontaires et anonymes." },
    S17: { title: "Discrimination & Égalité", description: "Ces questions portent sur des expériences personnelles et des attitudes sociétales. Toutes les entrées sont volontaires et anonymes." },
    S18: { title: "Politique fiscale", description: "Quelle est votre position sur les mesures de politique fiscale suivantes ?" },
    S19: { title: "Dépendances & Consommation de substances", description: "Toutes les entrées sont volontaires et anonymes. « Pas de réponse » est toujours valide." },
  
  },
};
