// 言語別トップページ(/en/ /zh/ /ko/)を生成する
// - 一覧は <lang>/tools/ を走査して自動生成(名前=各ページの <h1>、説明=meta descriptionの1文目)
//   → ツールを翻訳したらこのスクリプトを再実行するだけで載る。カタログの二重管理をしない
// - カテゴリは日本語版の scripts/build/data.js の cat を使う
// 使い方: node scripts/build/i18n/build_top.mjs
//   ※実行後は node scripts/build/i18n/inject_links.mjs も再実行すること
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ORIGIN, LANGS, SITE } from "./langs.mjs";
import { CATS, TOP } from "./tools.mjs";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const CAT_ORDER = ["健康", "お金", "日付", "変換"];
const FAVICON = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%3E%3Crect%20width='24'%20height='24'%20rx='5'%20fill='#0b6e4f'/%3E%3Cg%20fill='none'%20stroke='#fff'%20stroke-width='1.7'%20stroke-linecap='round'%3E%3Crect%20x='6.6'%20y='4.6'%20width='10.8'%20height='14.8'%20rx='2.4'/%3E%3Cpath%20d='M9.6%208.2h4.8'/%3E%3Cpath%20d='M9.9%2012.4h.01M12%2012.4h.01M14.1%2012.4h.01M9.9%2015.9h.01M12%2015.9h.01M14.1%2015.9h.01'/%3E%3C/g%3E%3C/svg%3E";

const dataSrc = readFileSync(join(ROOT, "scripts/build/data.js"), "utf8");
const JA_TOOLS = JSON.parse(dataSrc.slice(dataSrc.indexOf("= ") + 2).replace(/;\s*$/, ""));
const CAT_OF = Object.fromEntries(JA_TOOLS.map((t) => [t.slug, t.cat]));

// meta description の1文目(日本語・中国語の。/英語の. にも対応)
function firstSentence(s) {
  const m = s.match(/^[\s\S]*?[。．.!?！?](?=\s|$)/);
  return (m ? m[0] : s).trim();
}

function readPage(file) {
  const html = readFileSync(file, "utf8");
  const h1 = html.match(/<h1>([\s\S]*?)<\/h1>/);
  const desc = html.match(/<meta name="description" content="([^"]*)"/);
  if (!h1 || !desc) return null;
  return { name: h1[1].replace(/<[^>]*>/g, "").trim(), desc: firstSentence(desc[1]) };
}

for (const lang of LANGS.filter((l) => l.code !== "ja")) {
  const t = TOP[lang.code];
  const s = SITE[lang.code];
  const toolsDir = join(ROOT, lang.dir, "tools");
  const tools = [];
  if (existsSync(toolsDir)) {
    for (const slug of readdirSync(toolsDir).sort()) {
      const file = join(toolsDir, slug, "index.html");
      if (!existsSync(file)) continue;
      const page = readPage(file);
      if (!page) { console.error(`skip(h1/descriptionなし): ${lang.dir}/tools/${slug}`); continue; }
      const cat = CAT_OF[slug];
      if (!cat) { console.error(`skip(data.jsに未登録): ${slug}`); continue; }
      tools.push({ slug, cat, ...page });
    }
  }

  const sections = CAT_ORDER.filter((c) => tools.some((x) => x.cat === c)).map((c) =>
    `  <h2>${CATS[lang.code][c]}</h2>\n  <ul class="related">\n` +
    tools.filter((x) => x.cat === c).map((x) =>
      `    <li><a href="./tools/${x.slug}/">${x.name}</a> — ${x.desc}</li>`).join("\n") +
    "\n  </ul>"
  ).join("\n");

  const url = `${ORIGIN}/${lang.dir}/`;
  const html = `<!DOCTYPE html>
<html lang="${lang.htmlLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-src 'none'; object-src 'none'">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <title>${t.title}</title>
  <meta name="description" content="${t.desc}">
  <link rel="stylesheet" href="../shared/style.css">
  <!-- @meta start -->
  <link rel="canonical" href="${url}">
  <link rel="icon" href="${FAVICON}">
  <meta name="theme-color" content="#0b6e4f">
  <meta property="og:site_name" content="${s.brand}">
  <meta property="og:title" content="${t.title}">
  <meta property="og:description" content="${t.desc}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${url}">
  <meta property="og:locale" content="${lang.ogLocale}">
  <meta name="twitter:card" content="summary">
  <!-- @meta end -->
</head>
<body>
<!-- @partial:header start -->
<header class="site-header">
  <a class="site-brand" href="./"><svg class="site-brand-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 7.5h8"/><path d="M8.5 12.5h.01M12 12.5h.01M15.5 12.5h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01"/></svg>${s.brand}</a>
</header>
<!-- @partial:header end -->
<main>
  <h1>${t.h1}</h1>
  <p>${t.tagline}</p>
${sections}
</main>
<!-- @partial:footer start -->
<footer class="site-footer">
  <p>${s.footerPrivacyNote}</p>
  <nav>
    <a href="./privacy.html">${s.privacy}</a>
    <a href="./disclaimer.html">${s.disclaimer}</a>
    <a href="../contact.html">${s.contact}</a>
  </nav>
  <p>${s.footerDisclaimer}</p>
  <p>© 2026 ${s.brand}</p>
</footer>
<!-- @partial:footer end -->
</body>
</html>
`;
  mkdirSync(join(ROOT, lang.dir), { recursive: true });
  writeFileSync(join(ROOT, lang.dir, "index.html"), html);
  console.log(`${lang.dir}/index.html: ツール${tools.length}件`);
}
