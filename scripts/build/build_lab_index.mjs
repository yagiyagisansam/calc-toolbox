// lab(検討中ツール)の一覧を生成する
// - lab/index.html   ブラウザで開く一覧ページ
// - lab/INDEX.md     GitHub上で読む一覧(リンク付き)
// - lab/tools.json   PDF生成などが使う機械可読の一覧
// 各ツールの情報は index.html の title / description / h1 / 出典 から読み取る(二重管理をしない)
// 使い方: node scripts/build/build_lab_index.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const LAB = join(ROOT, "lab");
const CAT_ORDER = ["健康", "お金", "日付", "変換"];
const CAT_LABEL = { "健康": "健康", "お金": "お金", "日付": "日付・時間", "変換": "暮らし・変換" };

// 候補データ(カテゴリと出所)。実装時の選定結果を残してある
let meta = {};
const metaPath = join(LAB, "_meta.json");
if (existsSync(metaPath)) {
  for (const x of JSON.parse(readFileSync(metaPath, "utf8"))) meta[x.slug] = x;
}

function esc(s) {
  return String(s).replace(/&(?!(amp|lt|gt|quot|#\d+);)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function textOf(html, re) {
  const m = html.match(re);
  return m ? m[1].replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim() : "";
}

const rows = [];
for (const slug of readdirSync(LAB).sort()) {
  const dir = join(LAB, slug);
  if (!statSync(dir).isDirectory() || slug.startsWith("_")) continue;
  const file = join(dir, "index.html");
  if (!existsSync(file)) continue;
  const html = readFileSync(file, "utf8");
  const name = textOf(html, /<h1>([\s\S]*?)<\/h1>/);
  const desc = textOf(html, /<meta name="description" content="([^"]*)"/);
  // 出典は最初の1件のURLとその説明
  const srcBlock = html.match(/<ul class="sources">([\s\S]*?)<\/ul>/);
  let sourceName = "", sourceUrl = "";
  if (srcBlock) {
    sourceUrl = (srcBlock[1].match(/href="(https?:[^"]+)"/) || [])[1] || "";
    sourceName = srcBlock[1].replace(/<a[\s\S]*?<\/a>/g, "").replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ").replace(/[（(]\d{4}年.*$/, "").trim().slice(0, 60);
  }
  let tests = 0;
  const tp = join(dir, "tests.json");
  if (existsSync(tp)) tests = JSON.parse(readFileSync(tp, "utf8")).cases.length;

  rows.push({
    slug, name, desc,
    cat: meta[slug]?.cat || "変換",
    field: meta[slug]?.field || "",
    why: meta[slug]?.why || "",
    src: meta[slug]?.src || "",
    sourceName, sourceUrl, tests
  });
}

const byCat = {};
for (const c of CAT_ORDER) byCat[c] = rows.filter((r) => r.cat === c);

// ---- lab/index.html ----
const sections = CAT_ORDER.filter((c) => byCat[c].length).map((c) =>
  `  <h2 class="lab-cat">${CAT_LABEL[c]}<span class="lab-count">${byCat[c].length}件</span></h2>
  <ul class="lab-list">
${byCat[c].map((r) => `    <li><a href="./${r.slug}/">${esc(r.name)}</a><small>${esc(r.desc)}</small></li>`).join("\n")}
  </ul>`).join("\n\n");

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-src 'none'; object-src 'none'">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <meta name="robots" content="noindex">
  <title>検討中のツール ${rows.length}件 | 計算ツールボックス</title>
  <meta name="description" content="公開サイトに反映していない検討中の計算ツール${rows.length}件の一覧です。">
  <link rel="stylesheet" href="../shared/style.css">
  <link rel="stylesheet" href="./lab.css">
</head>
<body>
<header class="site-header">
  <a class="site-brand" href="../"><svg class="site-brand-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 7.5h8"/><path d="M8.5 12.5h.01M12 12.5h.01M15.5 12.5h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01"/></svg>計算ツールボックス</a>
</header>
<main>
  <p class="lab-note">ここにあるのは<strong>検討中のツール</strong>です。公開サイトの一覧・検索・サイトマップには載せていません。</p>
  <h1>検討中のツール(${rows.length}件)</h1>
  <div class="lead-card"><span class="lead-label">この一覧について</span><p>国内外の計算ツールを調べて選んだ${rows.length}件です。それぞれ計算ロジックを画面から切り離して作り、期待値つきのテストを同梱しています。本サイトへ載せるかどうかはこれから判断します。</p></div>

${sections}
</main>
<footer class="site-footer">
  <p>入力した値はすべてお使いの端末内で計算され、サーバーには送信されません。</p>
  <nav>
    <a href="../">計算ツールボックス</a>
  </nav>
  <p>本サイトの計算結果はすべて概算です。正確な数値は各ページ記載の一次情報・公的機関の窓口でご確認ください。</p>
  <p>© 2026 計算ツールボックス</p>
</footer>
</body>
</html>
`;
writeFileSync(join(LAB, "index.html"), html);

// ---- lab/INDEX.md ----
const md = [
  `# 検討中のツール一覧(${rows.length}件)`,
  "",
  "公開サイトには反映していません。各リンクはこのリポジトリ内のページです。",
  "",
  "| # | ツール名 | カテゴリ | 概要 | テスト | 出典 |",
  "|---|---|---|---|---|---|",
  ...CAT_ORDER.filter((c) => byCat[c].length).flatMap((c) =>
    byCat[c].map((r, i) => {
      const n = rows.indexOf(r) + 1;
      const src = r.sourceUrl ? `[${r.sourceName || "出典"}](${r.sourceUrl})` : (r.sourceName || "");
      return `| ${n} | [${r.name}](./${r.slug}/index.html) | ${CAT_LABEL[c]} | ${r.desc} | ${r.tests}件 | ${src} |`;
    })),
  "",
  "## カテゴリ別の件数",
  "",
  "| カテゴリ | 件数 |",
  "|---|---|",
  ...CAT_ORDER.filter((c) => byCat[c].length).map((c) => `| ${CAT_LABEL[c]} | ${byCat[c].length} |`),
  `| **合計** | **${rows.length}** |`,
  ""
].join("\n");
writeFileSync(join(LAB, "INDEX.md"), md);

writeFileSync(join(LAB, "tools.json"), JSON.stringify(rows, null, 1));
console.log(`lab: ${rows.length}件 → index.html / INDEX.md / tools.json`);
for (const c of CAT_ORDER) console.log(`  ${CAT_LABEL[c]}: ${byCat[c].length}件`);
