// 多言語対応の言語設定(唯一の定義箇所)
// - ja はルート直下、他言語は /<code>/ サブディレクトリ
// - hreflang とフッタの言語スイッチャは inject_links.mjs がこの定義から生成する
export const ORIGIN = "https://quick-calc.site";

export const LANGS = [
  { code: "ja", dir: "", htmlLang: "ja", ogLocale: "ja_JP", label: "日本語" },
  { code: "en", dir: "en", htmlLang: "en", ogLocale: "en_US", label: "English" },
  { code: "zh", dir: "zh", htmlLang: "zh-CN", ogLocale: "zh_CN", label: "简体中文" },
  { code: "ko", dir: "ko", htmlLang: "ko", ogLocale: "ko_KR", label: "한국어" }
];

// 言語スイッチャの見出し(aria-label)
export const SWITCH_LABEL = {
  ja: "言語",
  en: "Language",
  zh: "语言",
  ko: "언어"
};

// 翻訳版サイトの共通文言(トップ生成・翻訳ページ作成時の基準)
export const SITE = {
  ja: {
    brand: "計算ツールボックス",
    browse: "ツールを探す",
    footerPrivacyNote: "入力した値はすべてお使いの端末内で計算され、サーバーには送信されません。",
    footerDisclaimer: "本サイトの計算結果はすべて概算です。正確な数値は各ページ記載の一次情報・公的機関の窓口でご確認ください。",
    privacy: "プライバシーポリシー",
    disclaimer: "免責事項",
    contact: "お問い合わせ",
    allTools: "ツール一覧"
  },
  en: {
    brand: "Quick Calc",
    browse: "All tools",
    footerPrivacyNote: "Everything you enter is calculated on your device and never sent to a server.",
    footerDisclaimer: "All results on this site are approximations. For exact figures, check the primary sources listed on each page or contact the relevant public office.",
    privacy: "Privacy Policy",
    disclaimer: "Disclaimer",
    contact: "Contact",
    allTools: "All tools"
  },
  zh: {
    brand: "Quick Calc",
    browse: "全部工具",
    footerPrivacyNote: "您输入的所有数据都只在您的设备上计算,不会发送到服务器。",
    footerDisclaimer: "本站的计算结果均为约值。准确数值请以各页面注明的官方一次信息为准,或咨询相关政府窗口。",
    privacy: "隐私政策",
    disclaimer: "免责声明",
    contact: "联系我们",
    allTools: "全部工具"
  },
  ko: {
    brand: "Quick Calc",
    browse: "전체 도구",
    footerPrivacyNote: "입력한 값은 모두 사용 중인 기기 안에서만 계산되며 서버로 전송되지 않습니다.",
    footerDisclaimer: "이 사이트의 계산 결과는 모두 대략적인 값입니다. 정확한 수치는 각 페이지에 명시된 1차 정보(공식 자료)나 관계 기관에서 확인해 주세요.",
    privacy: "개인정보 처리방침",
    disclaimer: "면책사항",
    contact: "문의하기",
    allTools: "전체 도구"
  }
};
