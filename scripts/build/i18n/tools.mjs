// 翻訳済みツールのカタログ(言語別トップの生成元)
// - ツールを翻訳したらここに追記して build_top.mjs を再実行する
// - cat は data.js と同じ日本語キー(健康/お金/日付/変換)。表示名は CATS で言語別に持つ
export const CATS = {
  en: { "健康": "Health", "お金": "Money", "日付": "Dates & time", "変換": "Everyday & conversion" },
  zh: { "健康": "健康", "お金": "金钱", "日付": "日期·时间", "変換": "生活·换算" },
  ko: { "健康": "건강", "お金": "돈", "日付": "날짜·시간", "変換": "생활·변환" }
};

export const TOP = {
  en: {
    title: "Quick Calc | Free calculators for everyday life in Japan",
    desc: "Free web calculators for health, money, dates and everyday life — including tools for living in Japan (Japanese era converter, Japanese-standard BMI and more). No sign-up, mobile-friendly, sources cited on every page.",
    h1: "Quick Calc",
    tagline: "Free calculators for everyday life in Japan. Every tool shows its formula and primary sources."
  },
  zh: {
    title: "Quick Calc | 在日生活实用免费计算工具",
    desc: "健康·金钱·日期·日常生活的免费在线计算工具,包含在日生活专用工具(日本年号换算、日本标准BMI等)。无需注册,手机适配,每个页面都注明计算依据和出处。",
    h1: "Quick Calc",
    tagline: "在日生活实用的免费计算工具。每个工具都注明计算公式和一次信息出处。"
  },
  ko: {
    title: "Quick Calc | 일본 생활에 유용한 무료 계산 도구",
    desc: "건강·돈·날짜·일상생활의 무료 웹 계산 도구. 일본 생활 전용 도구(일본 연호 변환, 일본 기준 BMI 등) 포함. 가입 불필요, 모바일 지원, 모든 페이지에 계산 근거와 출처 명시.",
    h1: "Quick Calc",
    tagline: "일본 생활에 유용한 무료 계산 도구. 모든 도구에 계산식과 1차 정보 출처를 명시합니다."
  }
};

export const TOOLS = {
  en: [
    { slug: "wareki", cat: "日付", name: "Japanese Era (Wareki) Converter", desc: "Convert Western years to Japanese era years (Meiji to Reiwa) and back — with the kanji you can copy onto forms." },
    { slug: "bmi", cat: "健康", name: "BMI & Ideal Weight Calculator (Japanese Standard)", desc: "BMI and ideal weight, judged by the standard used in Japanese health checkups." }
  ],
  zh: [
    { slug: "wareki", cat: "日付", name: "西历·日本年号(和历)换算器", desc: "西历⇔日本年号互转,附可直接抄写到表格上的汉字写法。" },
    { slug: "bmi", cat: "健康", name: "BMI·标准体重计算器(日本标准)", desc: "按日本体检使用的标准判定BMI和标准体重。" }
  ],
  ko: [
    { slug: "wareki", cat: "日付", name: "서기·일본 연호(와레키) 변환기", desc: "서기⇔일본 연호 변환. 서류에 옮겨 적을 수 있는 한자 표기 제공." },
    { slug: "bmi", cat: "健康", name: "BMI·표준체중 계산기(일본 기준)", desc: "일본 건강검진에서 쓰이는 기준으로 BMI·표준체중 판정." }
  ]
};
