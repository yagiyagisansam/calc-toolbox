// お問い合わせフォームの選択肢データを data.js から再生成する
// 使い方: node scripts/build/build_contact_tools.mjs
// ツールを追加したら実行すること(手書きの一覧を持たないための生成スクリプト)
//
// 出力: shared/contact-tools.js
//   1段目(計算ツール / みんなの投票)の選択に応じて、2段目の選択肢を組み立てるためのデータ
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const dataSrc = readFileSync(ROOT + "/scripts/build/data.js", "utf8");
const TOOLS = JSON.parse(dataSrc.slice(dataSrc.indexOf("= ") + 2).replace(/;\s*$/, ""));

const CAT_ORDER = ["健康", "お金", "日付", "変換"];
const CAT_LABEL = { "健康": "健康・からだ", "お金": "お金", "日付": "日付・時間", "変換": "暮らし・変換" };

// 「みんなの投票」「星見スポット」は計算ツールではなく、それぞれ別プロダクト側に置く
const POLL_SLUG = "poll";
const STARS_SLUG = "stars";
const calcTools = TOOLS.filter((t) => t.slug !== POLL_SLUG && t.slug !== STARS_SLUG);

const calcGroups = CAT_ORDER.map((cat) => ({
  label: CAT_LABEL[cat] || cat,
  items: calcTools
    .filter((t) => t.cat === cat)
    .sort((a, b) => a.name.localeCompare(b.name, "ja"))
    .map((t) => ({ v: t.slug, n: t.name })),
})).filter((g) => g.items.length);

// 統計ツール側は、画面ごとの分かりやすい単位で分ける
const pollGroups = [{
  label: "みんなの投票",
  items: [
    { v: "poll-create", n: "アンケートを作るとき" },
    { v: "poll-vote", n: "投票・結果の表示" },
    { v: "poll-delete", n: "アンケートの削除" },
    { v: "poll", n: "その他(みんなの投票全般)" },
  ],
}];

// 星見スポット側も、画面ごとの分かりやすい単位で分ける
const starsGroups = [{
  label: "今夜のオススメ星見スポット",
  items: [
    { v: "stars-map", n: "地図・色分けの表示" },
    { v: "stars-list", n: "地域別の一覧・スポットの詳細" },
    { v: "stars-submit", n: "スポットの申請" },
    { v: "stars-data", n: "掲載内容の訂正・削除の依頼" },
    { v: "stars", n: "その他(星見スポット全般)" },
  ],
}];

const out =
  "// 自動生成: node scripts/build/build_contact_tools.mjs\n" +
  "// お問い合わせフォームの選択肢。ツールを追加したら再生成すること\n" +
  "var CONTACT_TOOLS = " + JSON.stringify({ calc: calcGroups, poll: pollGroups, stars: starsGroups }, null, 1) + ";\n";

writeFileSync(ROOT + "/shared/contact-tools.js", out, "utf8");
console.log(`shared/contact-tools.js: 計算ツール${calcTools.length}件・みんなの投票${pollGroups[0].items.length}項目・星見スポット${starsGroups[0].items.length}項目を生成しました`);
