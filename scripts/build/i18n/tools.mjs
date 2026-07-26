// 言語別トップページの表示文言(カテゴリ名・トップの見出し)
// ツール一覧は build_top.mjs が翻訳済みページを走査して自動生成するため、ここには持たない
// (ツールを翻訳したら build_top.mjs を再実行するだけで一覧に載る)
export const CATS = {
  en: { "健康": "Health", "お金": "Money", "日付": "Dates & time", "変換": "Everyday & conversion" },
  zh: { "健康": "健康", "お金": "金钱", "日付": "日期·时间", "変換": "生活·换算" },
  ko: { "健康": "건강", "お金": "돈", "日付": "날짜·시간", "変換": "생활·변환" }
};

export const TOP = {
  en: {
    title: "Quick Calc | Free calculators for everyday life in Japan",
    desc: "Free web calculators for health, money, dates and everyday life — including tools for living in Japan (Japanese era converter, English address converter, Japanese-standard BMI and more). No sign-up, mobile-friendly, sources cited on every page.",
    h1: "Quick Calc",
    tagline: "Free calculators for everyday life in Japan. Every tool shows its formula and primary sources."
  },
  zh: {
    title: "Quick Calc | 在日生活实用免费计算工具",
    desc: "健康·金钱·日期·日常生活的免费在线计算工具,包含在日生活专用工具(日本年号换算、英文地址转换、日本标准BMI等)。无需注册,手机适配,每个页面都注明计算依据和出处。",
    h1: "Quick Calc",
    tagline: "在日生活实用的免费计算工具。每个工具都注明计算公式和一次信息出处。"
  },
  ko: {
    title: "Quick Calc | 일본 생활에 유용한 무료 계산 도구",
    desc: "건강·돈·날짜·일상생활의 무료 웹 계산 도구. 일본 생활 전용 도구(일본 연호 변환, 영문 주소 변환, 일본 기준 BMI 등) 포함. 가입 불필요, 모바일 지원, 모든 페이지에 계산 근거와 출처 명시.",
    h1: "Quick Calc",
    tagline: "일본 생활에 유용한 무료 계산 도구. 모든 도구에 계산식과 1차 정보 출처를 명시합니다."
  }
};
