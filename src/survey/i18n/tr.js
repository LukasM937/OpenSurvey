// Turkish (Türkçe) — UI strings + section titles
// ui:        UI strings (buttons, titles, notes). null → falls back to German.
// tooltips:  Per-question explanation text.       null → falls back to German.
// questions: Question text / option overrides.    null → uses German from SECTIONS.
// sections:  Section title / description.         null → uses German from SECTIONS.
export default {
  ui: {

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
  tooltips: null,
  questions: null,
  sections: {

    S01: { title: "Sosyodemografi" },
    S02: { title: "Aile & Hane" },
    S03: { title: "Ekonomi & Finans" },
    S04: { title: "Siyasi Yönelim" },
    S05: { title: "Parti Yetkinliği", description: "Aşağıdaki konularda hangi partiye en çok güveniyorsunuz?" },
    S06: { title: "Memnuniyet & Güven" },
    S07: { title: "Konular & Tutumlar" },
    S08: { title: "Enerji & Mobilite" },
    S09: { title: "Jeopolitik", description: "Not: Sorular ilgili hükümeti veya görev sahibini ifade eder – ülkeyi veya halkını değil." },
    S10: { title: "Din & Dünya Görüşü" },
    S11: { title: "Köken & Geçmiş" },
    S12: { title: "Hukuki Deneyimler", description: "⚠️ Bu anket tamamen anonimdir. Hiçbir kişisel veri saklanmaz. 'Cevap yok' her zaman geçerlidir." },
    S13: { title: "Yaşam Memnuniyeti" },
    S14: { title: "Almanya'daki Deneyimler", description: "Bu bölüm mülteci veya sığınmacı statüsündeki kişilere yöneliktir. Tüm bilgiler gönüllü ve tamamen anonimdir." },
    S15: { title: "Tutumlar & Öz Algı" },
    S16: { title: "Geri Bildirim & İletişim", description: "Yorumlarınız veya iyileştirme önerileriniz var mı? Tüm girişler gönüllü ve anonimdir." },
    S17: { title: "Ayrımcılık & Eşitlik", description: "Bu sorular kişisel deneyimler ve toplumsal tutumlarla ilgilidir. Tüm girişler gönüllü ve anonimdir." },
    S18: { title: "Vergi Politikası", description: "Aşağıdaki vergi politikası önlemlerine ne kadar katılıyorsunuz?" },
    S19: { title: "Bağımlılık & Madde Kullanımı", description: "Tüm girişler gönüllü ve anonimdir. 'Cevap yok' her zaman geçerlidir." },
  
  },
};
