// Arabic (العربية) — UI strings + section titles; question texts are stubs
// ui:        UI strings (buttons, titles, notes). null → falls back to German.
// tooltips:  Per-question explanation text.       null → falls back to German.
// questions: Question text / option overrides.    null → uses German from SECTIONS.
// sections:  Section title / description.         null → uses German from SECTIONS.
export default {
  ui: {

    title:       "الدراسة الاجتماعية الألمانية",
    subtitle:    "جميع الإجابات طوعية",
    back:        "→ رجوع",
    next:        "→ التالي",
    submit:      "إرسال ✓",
    noAnswer:    "لا إجابة",
    reset:       "✕ إعادة تعيين",
    resetYes:    "نعم، احذف",
    resetNo:     "لا",
    jsonBtn:     "↓ JSON",
    jsonTitle:   "JSON – الإجابات",
    jsonHint:    "حدد الكل وانسخ",
    modalTitle:  "إرسال الاستبيان",
    privacyNote: "🔒 يتم إرسال إجاباتك بشكل مجهول تمامًا. لا يتم تخزين عناوين IP أو البيانات الشخصية.",
    dupWarning:  "⚠️ لقد أرسلت إجابة بالفعل.",
    sending:     "جارٍ الإرسال…",
    cancel:      "إلغاء",
    answered:    (n, t) => `${n} من ${t} أسئلة تمت الإجابة عليها`,
    thanksTitle: "شكرًا لمشاركتك!",
    thanksBody:  "تم إرسال إجاباتك بشكل مجهول.",
    thanksNote:  "لم يتم تخزين أي بيانات شخصية.",
    viewAgain:   "مراجعة الإجابات",
    section:     (i, n) => `القسم ${i} / ${n}`,
    langLabel:   "Sprache / Language",
  
  },
  tooltips: null,
  questions: {},
  sections: {

    S01: { title: "البيانات الديموغرافية" },
    S02: { title: "الأسرة والأسرة المعيشية" },
    S03: { title: "الاقتصاد والأمور المالية" },
    S04: { title: "التوجه السياسي" },
    S05: { title: "كفاءة الأحزاب", description: "بأي حزب تثق أكثر في الكفاءة في المجالات التالية؟" },
    S06: { title: "الرضا والثقة" },
    S07: { title: "المواضيع والمواقف" },
    S08: { title: "الطاقة والتنقل" },
    S09: { title: "الجيوسياسة", description: "ملاحظة: تشير الأسئلة إلى الحكومة أو المسؤول المعني – وليس إلى البلد أو شعبه." },
    S10: { title: "الدين والرؤية العالمية" },
    S11: { title: "الأصل والخلفية" },
    S12: { title: "التجارب القانونية", description: "⚠️ هذا الاستبيان مجهول تمامًا. لا يتم تخزين أي بيانات شخصية. «لا إجابة» صالحة دائمًا." },
    S13: { title: "الرضا عن الحياة" },
    S14: { title: "تجارب في ألمانيا", description: "يستهدف هذا القسم الأشخاص ذوي وضع اللاجئ أو طالب اللجوء. جميع المعلومات طوعية ومجهولة تمامًا." },
    S15: { title: "المواقف والإدراك الذاتي" },
    S16: { title: "الملاحظات والتواصل", description: "هل لديك تعليقات أو اقتراحات للتحسين؟ جميع الإدخالات طوعية ومجهولة." },
    S17: { title: "التمييز والمساواة", description: "تتعلق هذه الأسئلة بالتجارب الشخصية والمواقف المجتمعية. جميع الإدخالات طوعية ومجهولة." },
    S18: { title: "السياسة الضريبية", description: "ما موقفك من التدابير التالية في السياسة الضريبية؟" },
    S19: { title: "الإدمان واستخدام المواد", description: "جميع الإدخالات طوعية ومجهولة. «لا إجابة» صالحة دائمًا." },
  
  },
};
