// Note: the original umfrage.jsx had a duplicate 'es:' key in SECTION_TEXTS.
// This file uses the second (title-case) block, which is what the runtime used.
// Spanish (Español) — UI strings + section titles; question texts are stubs
// ui:        UI strings (buttons, titles, notes). null → falls back to German.
// tooltips:  Per-question explanation text.       null → falls back to German.
// questions: Question text / option overrides.    null → uses German from SECTIONS.
// sections:  Section title / description.         null → uses German from SECTIONS.
export default {
  ui: {

    title:       "Estudio Social Alemán",
    subtitle:    "todas las respuestas son voluntarias",
    back:        "← Atrás",
    next:        "Siguiente →",
    submit:      "Enviar ✓",
    noAnswer:    "Sin respuesta",
    reset:       "✕ Reiniciar",
    resetYes:    "Sí, eliminar",
    resetNo:     "No",
    jsonBtn:     "↓ JSON",
    jsonTitle:   "JSON – Respuestas",
    jsonHint:    "Seleccionar todo y copiar",
    modalTitle:  "Enviar encuesta",
    privacyNote: "🔒 Sus respuestas se transmiten de forma completamente anónima. No se almacenan direcciones IP ni datos personales.",
    dupWarning:  "⚠️ Ya ha enviado una respuesta.",
    sending:     "Enviando…",
    cancel:      "Cancelar",
    answered:    (n, t) => `${n} de ${t} preguntas respondidas`,
    thanksTitle: "¡Gracias por su participación!",
    thanksBody:  "Sus respuestas se transmitieron de forma anónima.",
    thanksNote:  "No se almacenaron datos personales.",
    viewAgain:   "Revisar respuestas",
    section:     (i, n) => `Sección ${i} / ${n}`,
    langLabel:   "Sprache / Language",
  
  },
  tooltips: null,
  questions: {},
  sections: {

    S01: { title: "Sociodemografía" },
    S02: { title: "Familia y Hogar" },
    S03: { title: "Economía y Finanzas" },
    S04: { title: "Orientación Política" },
    S05: { title: "Competencia de Partidos", description: "¿En qué partido confía más para ser competente en las siguientes áreas?" },
    S06: { title: "Satisfacción y Confianza" },
    S07: { title: "Temas y Actitudes" },
    S08: { title: "Energía y Movilidad" },
    S09: { title: "Geopolítica", description: "Nota: Las preguntas se refieren al gobierno o titular del cargo respectivo, no al país ni a su pueblo." },
    S10: { title: "Religión y Cosmovisión" },
    S11: { title: "Origen y Antecedentes" },
    S12: { title: "Experiencias Legales", description: "⚠️ Esta encuesta es completamente anónima. No se almacenan datos personales. «Sin respuesta» siempre es válido." },
    S13: { title: "Satisfacción con la Vida" },
    S14: { title: "Experiencias en Alemania", description: "Esta sección está dirigida a personas con estatus de refugiado o solicitante de asilo. Toda la información es voluntaria y completamente anónima." },
    S15: { title: "Actitudes y Autopercepción" },
    S16: { title: "Comentarios y Contacto", description: "¿Tiene algún comentario o sugerencia de mejora? Todas las entradas son voluntarias y anónimas." },
    S17: { title: "Discriminación e Igualdad", description: "Estas preguntas se refieren a experiencias personales y actitudes sociales. Todas las entradas son voluntarias y anónimas." },
    S18: { title: "Política Fiscal", description: "¿Cuál es su postura ante las siguientes medidas de política fiscal?" },
    S19: { title: "Adicción y Consumo de Sustancias", description: "Todas las entradas son voluntarias y anónimas. «Sin respuesta» siempre es válido." },
  
  },
};
