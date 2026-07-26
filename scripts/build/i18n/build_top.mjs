// 言語別トップページ(/en/ /zh/ /ko/)を生成する
// - **日本語版トップ(scripts/build/build_top.mjs)と同じ案LのタイルUI**を出す
//   (検索・カテゴリタブ・人気枠・タイル格子・説明つき一覧・統計ツール枠)
// - 一覧は <lang>/tools/ を走査して自動生成(名前=各ページの <h1>、説明=meta descriptionの1文目)
//   → ツールを翻訳したらこのスクリプトを再実行するだけで載る
// - タイルの短い名前は <h1> から機械的に作る(tools.mjs の SHORT 規則)
// 使い方: node scripts/build/i18n/build_top.mjs
//   ※実行後は node scripts/build/i18n/inject_links.mjs も再実行すること
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ORIGIN, LANGS, SITE } from "./langs.mjs";
import { CATS, TOP, SHORT } from "./tools.mjs";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const CAT_ORDER = ["健康", "お金", "日付", "変換"];
const GCLS = { "健康": "g0", "お金": "g1", "日付": "g2", "変換": "g3" };
const FAVICON = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2024%2024'%3E%3Crect%20width='24'%20height='24'%20rx='5'%20fill='#0b6e4f'/%3E%3Cg%20fill='none'%20stroke='#fff'%20stroke-width='1.7'%20stroke-linecap='round'%3E%3Crect%20x='6.6'%20y='4.6'%20width='10.8'%20height='14.8'%20rx='2.4'/%3E%3Cpath%20d='M9.6%208.2h4.8'/%3E%3Cpath%20d='M9.9%2012.4h.01M12%2012.4h.01M14.1%2012.4h.01M9.9%2015.9h.01M12%2015.9h.01M14.1%2015.9h.01'/%3E%3C/g%3E%3C/svg%3E";

// 日本語版と同じ順位・カテゴリ・アイコンを使う(表示だけ言語別)
const dataSrc = readFileSync(join(ROOT, "scripts/build/data.js"), "utf8");
const JA_TOOLS = JSON.parse(dataSrc.slice(dataSrc.indexOf("= ") + 2).replace(/;\s*$/, ""));
const CAT_OF = Object.fromEntries(JA_TOOLS.map((t) => [t.slug, t.cat]));
const iconsSrc = readFileSync(join(ROOT, "scripts/build/icons.js"), "utf8");
const ICON_PATHS = {};
for (const m of iconsSrc.matchAll(/^ ([a-z]+): '(.*)',$/gm)) ICON_PATHS[m[1]] = m[2];
// 人気枠の並びは日本語版トップと同一にする(週次でRANKを更新したら両方に効く)
const jaTopSrc = readFileSync(join(ROOT, "scripts/build/build_top.mjs"), "utf8");
const RANK = JSON.parse(jaTopSrc.match(/const RANK = (\[[^\]]*\])/)[1].replace(/'/g, '"'));

function svg(slug) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (ICON_PATHS[slug] || ICON_PATHS.percent) + "</svg>";
}
function esc(s) {
  return String(s).replace(/&(?!(amp|lt|gt|quot|#\d+);)/g, "&amp;").replace(/"/g, "&quot;");
}

// meta description の1文目(日本語・中国語の。/英語の. にも対応)
function firstSentence(s) {
  const m = s.match(/^[\s\S]*?[。．.!?！?](?=\s|$)/);
  return (m ? m[0] : s).trim();
}

// <h1> からタイル用の短い名前を作る
function shortName(h1, code) {
  let s = h1.replace(/&amp;/g, "&").replace(/[（(][^）)]*[）)]/g, "").trim();
  const strip = [...(SHORT.strip[code] || [])].sort((a, b) => b.length - a.length);
  let changed = true;
  while (changed) {
    changed = false;
    for (const w of strip) {
      const re = new RegExp("[\\s·・]*" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$", "i");
      if (re.test(s)) { s = s.replace(re, "").trim(); changed = true; }
    }
  }
  s = s.replace(/[\s·・:：,、-]+$/, "").trim();
  if (!s) s = h1.replace(/[（(][^）)]*[）)]/g, "").trim();
  const max = SHORT.maxLen[code] || 20;
  if (s.length > max) {
    const cut = s.slice(0, max);
    const sp = cut.lastIndexOf(" ");
    s = (sp > max * 0.5 ? cut.slice(0, sp) : cut).trim() + "…";
  }
  return s;
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
  let poll = null;
  if (existsSync(toolsDir)) {
    for (const slug of readdirSync(toolsDir).sort()) {
      const file = join(toolsDir, slug, "index.html");
      if (!existsSync(file)) continue;
      const page = readPage(file);
      if (!page) { console.error(`skip(h1/descriptionなし): ${lang.dir}/tools/${slug}`); continue; }
      if (slug === "poll") { poll = { slug, ...page }; continue; }
      const cat = CAT_OF[slug];
      if (!cat) { console.error(`skip(data.jsに未登録): ${slug}`); continue; }
      tools.push({ slug, cat, short: shortName(page.name, lang.code), ...page });
    }
  }
  const sorted = CAT_ORDER.flatMap((c) => tools.filter((x) => x.cat === c));
  const n = sorted.length;
  const fill = (str) => str.replace(/\{n\}/g, String(n));

  const tilesHtml = sorted.map((x) =>
    `      <a class="tile" href="./tools/${x.slug}/" data-slug="${x.slug}" data-cat="${x.cat}" data-kw="${esc(x.name + " " + x.desc)}" title="${esc(x.name)}">
        <span class="ic ${GCLS[x.cat]}">${svg(x.slug)}</span><span class="nm">${esc(x.short)}</span>
      </a>`).join("\n");

  const seoList = CAT_ORDER.filter((c) => sorted.some((x) => x.cat === c)).map((c) =>
    `      <h3>${CATS[lang.code][c]}</h3>\n      <ul>\n` +
    sorted.filter((x) => x.cat === c).map((x) =>
      `        <li><a href="./tools/${x.slug}/">${esc(x.name)}</a> — ${esc(x.desc)}</li>`).join("\n") +
    "\n      </ul>").join("\n");

  // 「みんなの投票」は日本語のみ。翻訳版でも枠は同じ位置に出し、日本語である旨を添える
  const pollHref = poll ? `./tools/poll/` : `../tools/poll/`;
  const pollSection = `  <div id="poll-sec">
    <div class="tp-sec"><b>${t.pollTitle}</b><span>${t.pollNote}</span></div>
    <a class="poll-card" id="poll-card" href="${pollHref}" data-kw="${esc(t.pollName + " " + t.pollDesc + " poll survey vote 投票 アンケート")}">
      <span class="pic">${svg("poll")}</span>
      <span class="pt"><b>${t.pollName}</b><small>${t.pollDesc}</small></span>
    </a>
  </div>`;

  const url = `${ORIGIN}/${lang.dir}/`;
  const catsJs = JSON.stringify([["all", t.all], ...CAT_ORDER.map((c) => [c, CATS[lang.code][c]])]);

  const html = `<!DOCTYPE html>
<html lang="${lang.htmlLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-src 'none'; object-src 'none'">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <title>${t.title}</title>
  <meta name="description" content="${esc(fill(t.desc))}">
  <link rel="stylesheet" href="../shared/style.css">
  <!-- @meta start -->
  <link rel="canonical" href="${url}">
  <link rel="icon" href="${FAVICON}">
  <meta name="theme-color" content="#0b6e4f">
  <meta property="og:site_name" content="${s.brand}">
  <meta property="og:title" content="${t.title}">
  <meta property="og:description" content="${esc(fill(t.desc))}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${url}">
  <meta property="og:locale" content="${lang.ogLocale}">
  <meta name="twitter:card" content="summary">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"${s.brand}","url":"${url}","inLanguage":"${lang.htmlLang}"}</script>
  <!-- @meta end -->
  <style>
    :root {
      --tp-bg: #f7f5f0; --tp-tile: #ffffff; --tp-ink: #26282b; --tp-muted: #93989e; --tp-gold: #b8873a;
      --tp-shadow: 0 1px 2px rgba(30,32,34,0.05), 0 6px 16px rgba(30,32,34,0.06);
    }
    @media (prefers-color-scheme: dark) {
      :root { --tp-bg: #141619; --tp-tile: #1f2326; --tp-ink: #eceff1; --tp-muted: #8b9196; --tp-shadow: 0 1px 2px rgba(0,0,0,0.4); }
    }
    body { background: var(--tp-bg); color: var(--tp-ink); }
    main { padding-bottom: 40px; }
    .brand { display: flex; align-items: center; gap: 10px; padding: 22px 0 4px; }
    .brand .mark { width: 40px; height: 40px; border-radius: 13px; background: var(--color-accent); display: flex; align-items: center; justify-content: center; box-shadow: var(--tp-shadow); flex: 0 0 auto; }
    .brand .mark svg { width: 24px; height: 24px; color: #fff; }
    .brand h1 { font-size: 1.28rem; margin: 0; font-weight: 800; letter-spacing: -0.01em; line-height: 1.3; }
    .brand .tg { font-size: 0.72rem; color: var(--tp-muted); margin: 1px 0 0; }
    .tp-search { display: flex; align-items: center; gap: 9px; background: var(--tp-tile); border-radius: 16px; padding: 13px 16px; color: var(--tp-muted); box-shadow: var(--tp-shadow); margin: 14px 0 0; }
    .tp-search input { border: none; outline: none; background: none; font-size: 1rem; width: 100%; color: var(--tp-ink); }
    .tp-search .site-search-ic { width: 18px; height: 18px; }
    .tp-tabs { display: flex; gap: 8px; overflow-x: auto; padding: 16px 0 4px; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
    .tp-tabs::-webkit-scrollbar { display: none; }
    .tp-tab { flex: 0 0 auto; padding: 8px 16px; border-radius: 999px; border: none; background: rgba(120,124,130,0.1); color: var(--tp-ink); font-size: 0.88rem; cursor: pointer; white-space: nowrap; font-weight: 500; }
    .tp-tab.on { background: var(--tp-ink); color: var(--tp-bg); font-weight: 700; }
    .tp-sec { display: flex; align-items: baseline; gap: 8px; margin: 20px 2px 10px; }
    .tp-sec b { font-size: 1.02rem; font-weight: 800; }
    .tp-sec span { font-size: 0.7rem; color: var(--tp-muted); }
    .tp-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px 10px; }
    @media (min-width: 560px) { .tp-grid { grid-template-columns: repeat(6, 1fr); } }
    .tile { display: flex; flex-direction: column; align-items: center; gap: 7px; text-decoration: none; color: var(--tp-ink); }
    .tile[hidden] { display: none; }
    .tile .ic { width: 100%; aspect-ratio: 1; max-width: 76px; display: flex; align-items: center; justify-content: center; border-radius: 24px; box-shadow: var(--tp-shadow); position: relative; }
    .tile .ic svg { width: 46%; height: 46%; }
    /* 名前はラテン文字だと長くなるため2行まで折り返す(日本語版はnowrap) */
    .tile .nm { font-size: 0.71rem; font-weight: 600; text-align: center; letter-spacing: -0.01em; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
    .tile .rk { position: absolute; top: -7px; left: -3px; min-width: 20px; height: 20px; border-radius: 999px; background: var(--tp-gold); color: #fff; font-size: 0.68rem; font-weight: 800; display: flex; align-items: center; justify-content: center; padding: 0 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
    .tile .rk.silver { background: #9aa2ab; }
    .tile .rk.bronze { background: #b0795a; }
    .tile .rk.plain { background: var(--tp-tile); color: var(--tp-muted); box-shadow: inset 0 0 0 1.5px rgba(120,124,130,0.25); }
    .g0 { background: #e4f2ea; color: #0e7d59; }
    .g1 { background: #f7ecd9; color: #a3690f; }
    .g2 { background: #e5edf9; color: #3a66a8; }
    .g3 { background: #eee8f7; color: #6f4fa8; }
    @media (prefers-color-scheme: dark) {
      .g0 { background: #20352b; color: #4fc596; }
      .g1 { background: #382e1c; color: #d9a04a; }
      .g2 { background: #222e41; color: #7ba3e0; }
      .g3 { background: #2e2740; color: #a98ce0; }
    }
    .no-hit { color: var(--tp-muted); font-size: 0.88rem; margin: 8px 2px; }
    .poll-card { display: flex; align-items: center; gap: 14px; background: var(--tp-tile); border-radius: 20px; padding: 16px; text-decoration: none; color: var(--tp-ink); box-shadow: var(--tp-shadow); }
    .poll-card .pic { width: 52px; height: 52px; flex: 0 0 auto; border-radius: 17px; background: #fde8ec; color: #d64560; display: flex; align-items: center; justify-content: center; }
    .poll-card .pic svg { width: 26px; height: 26px; }
    .poll-card .pt b { display: block; font-size: 0.98rem; font-weight: 800; }
    .poll-card .pt small { display: block; font-size: 0.76rem; color: var(--tp-muted); margin-top: 2px; line-height: 1.5; }
    @media (prefers-color-scheme: dark) { .poll-card .pic { background: #3a2229; color: #ff8798; } }
    .seo-list { margin-top: 34px; font-size: 0.85rem; }
    .seo-list summary { cursor: pointer; color: var(--tp-muted); font-weight: 600; }
    .seo-list h3 { font-size: 0.95rem; margin: 14px 0 4px; }
    .seo-list ul { padding-left: 1.2em; margin: 4px 0; }
    .seo-list li { margin: 3px 0; color: var(--tp-muted); }
    .about { margin-top: 28px; font-size: 0.85rem; color: var(--tp-muted); }
  </style>
</head>
<body>
<main>
  <div class="brand">
    <span class="mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 7.5h8"/><path d="M8.5 12.5h.01M12 12.5h.01M15.5 12.5h.01M8.5 16.5h.01M12 16.5h.01M15.5 16.5h.01"/></svg></span>
    <div>
      <h1>${s.brand}</h1>
      <p class="tg">${fill(t.tagline)}</p>
    </div>
  </div>

  <div class="tp-search" id="search"><svg class="site-search-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg><input type="search" id="search-input" placeholder="${esc(t.searchPlaceholder)}" aria-label="${esc(t.searchLabel)}" autocomplete="off"></div>
  <div class="tp-tabs" id="tabs" role="tablist"></div>

  <div id="pop-sec">
    <div class="tp-sec"><b>${t.popular}</b></div>
    <div class="tp-grid" id="popular"></div>
  </div>

  <div class="tp-sec" id="genre-title"><b>${t.all}</b><span>${n} ${t.unit}</span></div>
  <p class="no-hit" id="no-hit" hidden>${esc(t.noHit)}</p>
  <div class="tp-grid" id="grid">
${tilesHtml}
  </div>

${pollSection}

  <details class="seo-list">
    <summary>${esc(fill(t.seoSummary))}</summary>
${seoList}
  </details>

  <div class="about">
    <p>${t.about}</p>
  </div>
</main>
<!-- @partial:footer start -->
<footer class="site-footer">
  <p>${s.footerPrivacyNote}</p>
  <nav>
    <a href="./">${s.allTools}</a>
    <a href="./privacy.html">${s.privacy}</a>
    <a href="./disclaimer.html">${s.disclaimer}</a>
    <a href="../contact.html">${s.contact}</a>
  </nav>
  <p>${s.footerDisclaimer}</p>
  <p>© 2026 ${s.brand}</p>
</footer>
<!-- @partial:footer end -->
<script>
(function () {
  "use strict";
  var RANK = ${JSON.stringify(RANK)};
  var CATS = ${catsJs};
  var UNIT = ${JSON.stringify(t.unit)};
  var RESULTS = ${JSON.stringify(t.results)};
  var current = "all";
  var tabsEl = document.getElementById("tabs");
  var grid = document.getElementById("grid");
  var popEl = document.getElementById("popular");
  var tiles = [].slice.call(grid.querySelectorAll(".tile"));
  var bySlug = {};
  tiles.forEach(function (t) { bySlug[t.dataset.slug] = t; });

  function norm(s) { return s.toLowerCase(); }
  var index = tiles.map(function (t) { return norm(t.dataset.kw + " " + t.textContent); });
  var pollCard = document.getElementById("poll-card");
  var pollIndex = norm(pollCard.dataset.kw + " " + pollCard.textContent);

  // 人気: 日本語版と同じ利用データ基準のランキング(週次更新)
  function renderPopular() {
    popEl.innerHTML = "";
    var shown = 0;
    RANK.forEach(function (slug, i) {
      var t = bySlug[slug];
      if (!t || shown >= 8) return;
      var clone = t.cloneNode(true);
      clone.hidden = false;
      var rk = document.createElement("span");
      var n = ++shown;
      rk.className = "rk" + (n === 1 ? "" : n === 2 ? " silver" : n === 3 ? " bronze" : " plain");
      rk.textContent = n;
      clone.querySelector(".ic").appendChild(rk);
      popEl.appendChild(clone);
    });
    if (!shown) document.getElementById("pop-sec").style.display = "none";
  }

  CATS.forEach(function (c) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "tp-tab" + (c[0] === current ? " on" : "");
    b.textContent = c[1];
    b.setAttribute("role", "tab");
    b.onclick = function () {
      current = c[0];
      tabsEl.querySelectorAll(".tp-tab").forEach(function (t, i) { t.classList.toggle("on", CATS[i][0] === current); });
      render();
    };
    tabsEl.appendChild(b);
  });

  var input = document.getElementById("search-input");
  function render() {
    var q = norm(input.value.trim());
    var terms = q.split(/\\s+/).filter(Boolean);
    var shown = 0;
    tiles.forEach(function (t, i) {
      var hit;
      if (terms.length) {
        hit = terms.every(function (w) { return index[i].indexOf(w) !== -1; });
      } else {
        hit = current === "all" || t.dataset.cat === current;
      }
      t.hidden = !hit;
      if (hit) shown++;
    });
    document.getElementById("pop-sec").style.display = (terms.length || current !== "all") ? "none" : "";
    var pollHit = terms.length ? terms.every(function (w) { return pollIndex.indexOf(w) !== -1; }) : current === "all";
    document.getElementById("poll-sec").style.display = pollHit ? "" : "none";
    if (pollHit && terms.length) shown++;
    var label = terms.length ? RESULTS : CATS.filter(function (c) { return c[0] === current; })[0][1];
    document.getElementById("genre-title").innerHTML = "<b>" + label + "</b><span>" + shown + " " + UNIT + "</span>";
    document.getElementById("no-hit").hidden = shown > 0;
  }
  input.addEventListener("input", render);

  var q0 = new URLSearchParams(location.search).get("q");
  if (q0) { input.value = q0; render(); }
  if (location.hash === "#search") setTimeout(function () { input.focus(); }, 60);
  renderPopular();
})();
</script>
</body>
</html>
`;
  mkdirSync(join(ROOT, lang.dir), { recursive: true });
  writeFileSync(join(ROOT, lang.dir, "index.html"), html);
  console.log(`${lang.dir}/index.html: ツール${n}件`);
}
