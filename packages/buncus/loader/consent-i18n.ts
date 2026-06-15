// Consent-gate copy in every locale giscus ships (35 locales). The gate is the
// one piece of UI the loader renders in the host page (before the iframe loads),
// so its strings can't come from the widget's i18n bundle — they live here.
//
// Keyed by giscus locale code. `resolveConsentCopy` applies giscus's locale
// fallbacks (gsw->de, zh-Hans->zh-CN, zh-Hant->zh-TW) and falls back to English.

export interface ConsentCopy {
  /** Privacy notice shown above the actions. */
  text: string;
  /** "Load comments" button label. */
  load: string;
  /** "Remember my choice" checkbox label. */
  remember: string;
  /** Link label appended to the notice when data-privacy-url is set. */
  privacy: string;
}

/** Locales written right-to-left; the gate gets dir="rtl" for these. */
export const RTL_LOCALES = new Set(["ar", "fa", "he"]);

// Mirrors giscus's i18n.fallbacks.json: alias locales that reuse another's copy.
const FALLBACKS: Record<string, string> = {
  gsw: "de",
  "zh-Hans": "zh-CN",
  "zh-Hant": "zh-TW",
};

export const CONSENT_I18N: Record<string, ConsentCopy> = {
  ar: {
    text: "يتم تحميل التعليقات من GitHub. يؤدي ذلك إلى إرسال عنوان IP الخاص بك إلى ‏GitHub Inc.‏ (الولايات المتحدة).",
    load: "تحميل التعليقات",
    remember: "تذكّر اختياري",
    privacy: "الخصوصية",
  },
  be: {
    text: "Каментарыі загружаюцца з GitHub. Пры гэтым ваш IP-адрас перадаецца ў GitHub Inc. (ЗША).",
    load: "Загрузіць каментарыі",
    remember: "Запомніць мой выбар",
    privacy: "Прыватнасць",
  },
  bg: {
    text: "Коментарите се зареждат от GitHub. Това предава вашия IP адрес към GitHub Inc. (САЩ).",
    load: "Зареждане на коментарите",
    remember: "Запомни избора ми",
    privacy: "Поверителност",
  },
  ca: {
    text: "Els comentaris es carreguen des de GitHub. Això transmet la vostra adreça IP a GitHub Inc. (EUA).",
    load: "Carrega els comentaris",
    remember: "Recorda la meva selecció",
    privacy: "Privadesa",
  },
  cs: {
    text: "Komentáře se načítají z GitHubu. Tím se vaše IP adresa přenese do GitHub Inc. (USA).",
    load: "Načíst komentáře",
    remember: "Zapamatovat moji volbu",
    privacy: "Soukromí",
  },
  da: {
    text: "Kommentarer indlæses fra GitHub. Dette sender din IP-adresse til GitHub Inc. (USA).",
    load: "Indlæs kommentarer",
    remember: "Husk mit valg",
    privacy: "Privatliv",
  },
  de: {
    text: "Kommentare werden von GitHub geladen. Dabei wird deine IP an GitHub Inc. (USA) übertragen.",
    load: "Kommentare laden",
    remember: "Auswahl merken",
    privacy: "Datenschutz",
  },
  en: {
    text: "Comments are loaded from GitHub. This transmits your IP address to GitHub Inc. (USA).",
    load: "Load comments",
    remember: "Remember my choice",
    privacy: "Privacy",
  },
  eo: {
    text: "Komentoj estas ŝargataj de GitHub. Tio transsendas vian IP-adreson al GitHub Inc. (Usono).",
    load: "Ŝargi komentojn",
    remember: "Memori mian elekton",
    privacy: "Privateco",
  },
  es: {
    text: "Los comentarios se cargan desde GitHub. Esto transmite tu dirección IP a GitHub Inc. (EE. UU.).",
    load: "Cargar comentarios",
    remember: "Recordar mi elección",
    privacy: "Privacidad",
  },
  eu: {
    text: "Iruzkinak GitHub-etik kargatzen dira. Horrek zure IP helbidea GitHub Inc.-i (AEB) bidaltzen dio.",
    load: "Kargatu iruzkinak",
    remember: "Gogoratu nire aukera",
    privacy: "Pribatutasuna",
  },
  fa: {
    text: "نظرات از GitHub بارگذاری می‌شوند. این کار نشانی IP شما را به ‏GitHub Inc.‏ (ایالات متحده) ارسال می‌کند.",
    load: "بارگذاری نظرات",
    remember: "انتخاب من را به خاطر بسپار",
    privacy: "حریم خصوصی",
  },
  fr: {
    text: "Les commentaires sont chargés depuis GitHub. Cela transmet votre adresse IP à GitHub Inc. (États-Unis).",
    load: "Charger les commentaires",
    remember: "Se souvenir de mon choix",
    privacy: "Confidentialité",
  },
  gr: {
    text: "Τα σχόλια φορτώνονται από το GitHub. Αυτό μεταδίδει τη διεύθυνση IP σας στην GitHub Inc. (ΗΠΑ).",
    load: "Φόρτωση σχολίων",
    remember: "Να θυμάσαι την επιλογή μου",
    privacy: "Απόρρητο",
  },
  hbs: {
    text: "Komentari se učitavaju sa GitHub-a. Time se vaša IP adresa prenosi kompaniji GitHub Inc. (SAD).",
    load: "Učitaj komentare",
    remember: "Zapamti moj izbor",
    privacy: "Privatnost",
  },
  he: {
    text: "התגובות נטענות מ-GitHub. פעולה זו מעבירה את כתובת ה-IP שלך אל ‏GitHub Inc.‏ (ארה״ב).",
    load: "טעינת תגובות",
    remember: "זכור את הבחירה שלי",
    privacy: "פרטיות",
  },
  hu: {
    text: "A hozzászólások a GitHubról töltődnek be. Ez továbbítja az IP-címét a GitHub Inc. (USA) felé.",
    load: "Hozzászólások betöltése",
    remember: "Választás megjegyzése",
    privacy: "Adatvédelem",
  },
  id: {
    text: "Komentar dimuat dari GitHub. Ini mengirimkan alamat IP Anda ke GitHub Inc. (AS).",
    load: "Muat komentar",
    remember: "Ingat pilihan saya",
    privacy: "Privasi",
  },
  it: {
    text: "I commenti vengono caricati da GitHub. Questo trasmette il tuo indirizzo IP a GitHub Inc. (USA).",
    load: "Carica i commenti",
    remember: "Ricorda la mia scelta",
    privacy: "Privacy",
  },
  ja: {
    text: "コメントは GitHub から読み込まれます。これにより、あなたの IP アドレスが GitHub Inc.（米国）に送信されます。",
    load: "コメントを読み込む",
    remember: "選択を記憶する",
    privacy: "プライバシー",
  },
  kh: {
    text: "មតិយោបល់ត្រូវបានផ្ទុកពី GitHub។ វាបញ្ជូនអាសយដ្ឋាន IP របស់អ្នកទៅ GitHub Inc. (សហរដ្ឋអាមេរិក)។",
    load: "ផ្ទុកមតិយោបល់",
    remember: "ចងចាំជម្រើសរបស់ខ្ញុំ",
    privacy: "ឯកជនភាព",
  },
  ko: {
    text: "댓글은 GitHub에서 로드됩니다. 이 과정에서 사용자의 IP 주소가 GitHub Inc.(미국)로 전송됩니다.",
    load: "댓글 불러오기",
    remember: "내 선택 기억하기",
    privacy: "개인정보 보호",
  },
  nl: {
    text: "Reacties worden geladen vanaf GitHub. Hierbij wordt je IP-adres naar GitHub Inc. (VS) verzonden.",
    load: "Reacties laden",
    remember: "Mijn keuze onthouden",
    privacy: "Privacy",
  },
  pl: {
    text: "Komentarze są ładowane z GitHub. Powoduje to przesłanie Twojego adresu IP do GitHub Inc. (USA).",
    load: "Załaduj komentarze",
    remember: "Zapamiętaj mój wybór",
    privacy: "Prywatność",
  },
  pt: {
    text: "Os comentários são carregados do GitHub. Isto transmite o seu endereço IP à GitHub Inc. (EUA).",
    load: "Carregar comentários",
    remember: "Lembrar a minha escolha",
    privacy: "Privacidade",
  },
  ro: {
    text: "Comentariile sunt încărcate de pe GitHub. Acest lucru transmite adresa ta IP către GitHub Inc. (SUA).",
    load: "Încarcă comentariile",
    remember: "Reține alegerea mea",
    privacy: "Confidențialitate",
  },
  ru: {
    text: "Комментарии загружаются с GitHub. При этом ваш IP-адрес передаётся в GitHub Inc. (США).",
    load: "Загрузить комментарии",
    remember: "Запомнить мой выбор",
    privacy: "Конфиденциальность",
  },
  th: {
    text: "ความคิดเห็นถูกโหลดจาก GitHub ซึ่งจะส่งที่อยู่ IP ของคุณไปยัง GitHub Inc. (สหรัฐอเมริกา)",
    load: "โหลดความคิดเห็น",
    remember: "จดจำตัวเลือกของฉัน",
    privacy: "ความเป็นส่วนตัว",
  },
  tr: {
    text: "Yorumlar GitHub'dan yüklenir. Bu işlem IP adresinizi GitHub Inc. (ABD) ile paylaşır.",
    load: "Yorumları yükle",
    remember: "Seçimimi hatırla",
    privacy: "Gizlilik",
  },
  uk: {
    text: "Коментарі завантажуються з GitHub. Це передає вашу IP-адресу до GitHub Inc. (США).",
    load: "Завантажити коментарі",
    remember: "Запам'ятати мій вибір",
    privacy: "Конфіденційність",
  },
  uz: {
    text: "Izohlar GitHub'dan yuklanadi. Bu sizning IP manzilingizni GitHub Inc. (AQSh) ga yuboradi.",
    load: "Izohlarni yuklash",
    remember: "Tanlovimni eslab qol",
    privacy: "Maxfiylik",
  },
  vi: {
    text: "Bình luận được tải từ GitHub. Việc này sẽ gửi địa chỉ IP của bạn đến GitHub Inc. (Hoa Kỳ).",
    load: "Tải bình luận",
    remember: "Ghi nhớ lựa chọn của tôi",
    privacy: "Quyền riêng tư",
  },
  "zh-CN": {
    text: "评论从 GitHub 加载。这会将您的 IP 地址发送给 GitHub Inc.（美国）。",
    load: "加载评论",
    remember: "记住我的选择",
    privacy: "隐私",
  },
  "zh-HK": {
    text: "留言由 GitHub 載入。這會將你的 IP 位址傳送至 GitHub Inc.（美國）。",
    load: "載入留言",
    remember: "記住我的選擇",
    privacy: "私隱",
  },
  "zh-TW": {
    text: "留言由 GitHub 載入。這會將您的 IP 位址傳送給 GitHub Inc.（美國）。",
    load: "載入留言",
    remember: "記住我的選擇",
    privacy: "隱私權",
  },
};

/**
 * Resolve the consent copy for a giscus `lang` value. Tries an exact match,
 * then giscus's fallback aliases, then the base language (e.g. `pt-BR` -> `pt`),
 * and finally English.
 */
export function resolveConsentCopy(lang: string | undefined): ConsentCopy {
  if (lang) {
    const exact = CONSENT_I18N[lang] || CONSENT_I18N[FALLBACKS[lang]];
    if (exact) return exact;
    const base = CONSENT_I18N[lang.split("-")[0]];
    if (base) return base;
  }
  return CONSENT_I18N.en;
}

/** Whether the gate should render right-to-left for this `lang`. */
export function isRtlLocale(lang: string | undefined): boolean {
  if (!lang) return false;
  return RTL_LOCALES.has(lang) || RTL_LOCALES.has(lang.split("-")[0]);
}
