// 言語別トップページのUI文言
// ツール一覧は build_top.mjs が翻訳済みページを走査して自動生成するため、ここには持たない
// (ツールを翻訳したら build_top.mjs を再実行するだけで一覧に載る)

// カテゴリ名(キーは data.js の cat と同じ日本語)
export const CATS = {
  en: { "健康": "Health", "お金": "Money", "日付": "Dates", "変換": "Everyday" },
  zh: { "健康": "健康", "お金": "金钱", "日付": "日期", "変換": "生活" },
  ko: { "健康": "건강", "お金": "돈", "日付": "날짜", "変換": "생활" }
};

// トップページのUI文言。日本語版(index.html)と同じ構成の各パーツに対応する
export const TOP = {
  en: {
    title: "Quick Calc | Free calculators for everyday life in Japan",
    desc: "Free web calculators for health, money, dates and everyday life in Japan ({n} tools) — including a Japanese era converter, an English address converter and Japanese-standard BMI. No sign-up, mobile-friendly, with the formula and primary sources on every page.",
    brand: "Quick Calc",
    tagline: "{n} everyday calculators. No sign-up, all free.",
    searchPlaceholder: "Search (e.g. rent, address, business days)",
    searchLabel: "Search tools",
    all: "All",
    popular: "Popular",
    results: "Results",
    unit: "tools",
    noHit: "No tools matched. Try another word (e.g. rent, discount, calories).",
    seoSummary: "Open the full list of {n} tools with descriptions",
    pollTitle: "Poll tool",
    pollNote: "A separate tool from the calculators",
    pollName: "Everyone's Poll",
    pollDesc: "Create a poll, share it and see the results in real time (no sign-up). Japanese only.",
    about: "Free web calculators for the small questions that come up in daily life in Japan — health, money, dates and everyday conversions. Every tool states <strong>how it is calculated and the primary sources</strong> it is based on. Results are approximations based on what you enter; see the <a href=\"./disclaimer.html\">Disclaimer</a> for details."
  },
  zh: {
    title: "Quick Calc | 在日生活实用免费计算工具",
    desc: "健康·金钱·日期·日常生活的免费在线计算工具({n}个),包含日本年号换算、英文地址转换、日本标准BMI等在日生活专用工具。无需注册,手机适配,每个页面都注明计算依据和出处。",
    brand: "Quick Calc",
    tagline: "生活中的{n}个计算工具·无需注册·完全免费",
    searchPlaceholder: "搜索(例: 房租、地址、工作日)",
    searchLabel: "搜索工具",
    all: "全部",
    popular: "热门",
    results: "搜索结果",
    unit: "个",
    noHit: "没有找到相应的工具。请换个词试试(例: 房租、折扣、卡路里)。",
    seoSummary: "展开{n}个工具的说明列表",
    pollTitle: "统计工具",
    pollNote: "与计算工具不同的另一种工具",
    pollName: "大家的投票",
    pollDesc: "创建问卷并分享,实时统计结果(无需注册)。仅日文。",
    about: "这里汇集了健康·金钱·日期·日常生活中随手就想算一下的免费在线工具。每个工具都注明<strong>计算方法和依据(一次信息出处)</strong>。计算结果是基于所输入数值的约值,详情请见<a href=\"./disclaimer.html\">免责声明</a>。"
  },
  ko: {
    title: "Quick Calc | 일본 생활에 유용한 무료 계산 도구",
    desc: "건강·돈·날짜·일상생활의 무료 웹 계산 도구 {n}개. 일본 연호 변환, 영문 주소 변환, 일본 기준 BMI 등 일본 생활 전용 도구 포함. 가입 불필요, 모바일 지원, 모든 페이지에 계산 근거와 출처 명시.",
    brand: "Quick Calc",
    tagline: "생활 속 계산 도구 {n}개 · 가입 불필요 · 모두 무료",
    searchPlaceholder: "검색(예: 월세, 주소, 영업일)",
    searchLabel: "도구 검색",
    all: "전체",
    popular: "인기",
    results: "검색 결과",
    unit: "개",
    noHit: "해당하는 도구가 없습니다. 다른 말로 검색해 보세요(예: 월세, 할인, 칼로리).",
    seoSummary: "{n}개 도구의 설명 목록 열기",
    pollTitle: "통계 도구",
    pollNote: "계산 도구와는 다른 별도의 도구입니다",
    pollName: "모두의 투표",
    pollDesc: "설문을 만들어 공유하고 결과를 실시간으로 집계합니다(가입 불필요). 일본어만 지원합니다.",
    about: "일본에서 생활하며 문득 계산해 보고 싶어지는 건강·돈·날짜·생활 속 물음을 그 자리에서 계산할 수 있는 무료 웹 도구 모음입니다. 모든 도구에 <strong>계산 방법과 근거(1차 정보 출처)</strong>를 명시하고 있습니다. 계산 결과는 입력값에 따른 대략적인 값이며, 자세한 내용은 <a href=\"./disclaimer.html\">면책사항</a>을 확인해 주세요."
  }
};

// タイルに出す短い名前を <h1> から作る規則。
// 括弧の補足を落とし、末尾の一般語(Calculator / 计算器 / 계산기 など)を取り、長ければ語の切れ目で詰める。
// 言語別に短縮名を手で持たないための仕組み(翻訳を足せば自動で名前が付く)。
export const SHORT = {
  // 末尾から取り除く語(小文字で比較)。長いものから順に当てる
  strip: {
    en: ["calculator", "converter", "simulator", "calc", "tool", "counter", "checker", "generator"],
    zh: ["计算器", "换算器", "换算", "计算", "模拟计算器", "模拟", "工具", "转换器", "转换"],
    ko: ["계산기", "변환기", "환산 계산기", "환산", "변환", "시뮬레이션", "도구", "계산"]
  },
  maxLen: { en: 22, zh: 9, ko: 12 }
};
