// 案Lデザインの本番トップページを生成する
// - 61タイルを静的HTMLで出力(SEO/非JS環境用に説明つき一覧も同梱)
// - 人気セクションは全ユーザー利用データ基準のRANK配列(週次更新)で表示
import { readFileSync, writeFileSync } from "node:fs";

import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const dataSrc = readFileSync(ROOT + "/scripts/build/data.js", "utf8");
const TOOLS = JSON.parse(dataSrc.slice(dataSrc.indexOf("= ") + 2).replace(/;\s*$/, ""));
const iconsSrc = readFileSync(ROOT + "/scripts/build/icons.js", "utf8");
const ICON_PATHS = {};
for (const m of iconsSrc.matchAll(/^ ([a-z]+): '(.*)',$/gm)) ICON_PATHS[m[1]] = m[2];

const GCLS = { "健康": "g0", "お金": "g1", "日付": "g2", "変換": "g3" };
const CAT_ORDER = ["健康", "お金", "日付", "変換"];
// 人気ランキング(全ユーザーの利用データ基準)。週次運用でSearch Console/Analyticsの
// 実データから並びを更新して再生成する。端末ごとの個人履歴は使わない(Hiroさん指示)
const RANK = ["moji", "password", "waribiki", "days", "bmi", "wareki", "eigyobi", "kinenbi", "jikan", "tax", "fudosan", "heikin"];

function svg(slug) {
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON_PATHS[slug] + "</svg>";
}

const sorted = CAT_ORDER.flatMap((c) => TOOLS.filter((t) => t.cat === c));
const tilesHtml = sorted.map((t) =>
  `      <a class="tile" href="./tools/${t.slug}/" data-slug="${t.slug}" data-cat="${t.cat}" data-kw="${(t.name + " " + t.desc + " " + t.kw).replace(/"/g, "")}" title="${t.name} — ${t.desc}">
        <span class="ic ${GCLS[t.cat]}">${svg(t.slug)}</span><span class="nm">${t.g}</span>
      </a>`).join("\n");

const seoList = CAT_ORDER.map((c) =>
  `      <h3>${c === "日付" ? "日付・時間" : c === "変換" ? "暮らし・変換" : c}</h3>\n      <ul>\n` +
  TOOLS.filter((t) => t.cat === c).map((t) => `        <li><a href="./tools/${t.slug}/">${t.name}</a> — ${t.desc}</li>`).join("\n") +
  "\n      </ul>").join("\n");

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-src 'none'; object-src 'none'">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <title>計算ツールボックス | 暮らしに役立つ無料計算ツール集</title>
  <meta name="description" content="健康・お金・日付・暮らしの疑問をその場で計算できる無料Webツール集(61個)。登録不要・スマホ対応。すべてのツールに計算根拠と一次情報の出典を明記しています。">
  <link rel="stylesheet" href="./shared/style.css">
  <!-- @meta start -->
  <link rel="canonical" href="https://quick-calc.site/">
  <link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20viewBox%3D'0%200%20100%20100'%3E%3Ctext%20y%3D'.9em'%20font-size%3D'90'%3E%F0%9F%A7%AE%3C%2Ftext%3E%3C%2Fsvg%3E">
  <meta name="theme-color" content="#0b6e4f">
  <meta property="og:site_name" content="計算ツールボックス">
  <meta property="og:title" content="計算ツールボックス | 暮らしに役立つ無料計算ツール集">
  <meta property="og:description" content="健康・お金・日付・暮らしの疑問をその場で計算できる無料Webツール集(61個)。登録不要・スマホ対応。すべてのツールに計算根拠と一次情報の出典を明記しています。">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://quick-calc.site/">
  <meta property="og:locale" content="ja_JP">
  <meta name="twitter:card" content="summary">
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"WebSite","name":"計算ツールボックス","url":"https://quick-calc.site/","inLanguage":"ja"}</script>
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
    .tile .nm { font-size: 0.73rem; font-weight: 600; text-align: center; white-space: nowrap; letter-spacing: -0.01em; }
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
      <h1>計算ツールボックス</h1>
      <p class="tg">暮らしの計算61ツール・登録不要・ぜんぶ無料</p>
    </div>
  </div>

  <div class="tp-search" id="search">🔍 <input type="search" id="search-input" placeholder="検索(例: 家賃、文字数、営業日)" aria-label="ツールを検索" autocomplete="off"></div>
  <div class="tp-tabs" id="tabs" role="tablist"></div>

  <div id="pop-sec">
    <div class="tp-sec"><b>人気</b></div>
    <div class="tp-grid" id="popular"></div>
  </div>

  <div class="tp-sec" id="genre-title"><b>すべて</b><span>61個</span></div>
  <p class="no-hit" id="no-hit" hidden>該当するツールがありません。別のことばでお試しください(例: 家賃、割引、カロリー)</p>
  <div class="tp-grid" id="grid">
${tilesHtml}
  </div>

  <details class="seo-list">
    <summary>61ツールの説明つき一覧を開く</summary>
${seoList}
  </details>

  <div class="about">
    <p>健康・お金・日付・暮らしのちょっとした疑問を、その場で計算できる無料のWebツール集です。すべてのツールに<strong>計算方法と根拠(一次情報の出典)</strong>を明記しています。計算結果は入力値に基づく概算です。詳しくは<a href="./disclaimer.html">免責事項</a>をご覧ください。</p>
  </div>
</main>
<!-- @partial:footer start -->
<footer class="site-footer">
  <p>入力した値はすべてお使いの端末内で計算され、サーバーには送信されません。</p>
  <nav>
    <a href="./">ツール一覧</a>
    <a href="./privacy.html">プライバシーポリシー</a>
    <a href="./disclaimer.html">免責事項</a>
    <a href="./contact.html">お問い合わせ</a>
  </nav>
  <p>本サイトの計算結果はすべて概算です。正確な数値は各ページ記載の一次情報・公的機関の窓口でご確認ください。</p>
  <p>© 2026 計算ツールボックス</p>
</footer>
<!-- @partial:footer end -->
<script>
(function () {
  "use strict";
  var RANK = ${JSON.stringify(RANK)};
  var CATS = [["all", "すべて"], ["健康", "健康"], ["お金", "お金"], ["日付", "日付・時間"], ["変換", "暮らし・変換"]];
  var current = "all";
  var tabsEl = document.getElementById("tabs");
  var grid = document.getElementById("grid");
  var popEl = document.getElementById("popular");
  var tiles = [].slice.call(grid.querySelectorAll(".tile"));
  var bySlug = {};
  tiles.forEach(function (t) { bySlug[t.dataset.slug] = t; });

  // ひらがな→カタカナ+小文字化で表記ゆれを吸収
  function norm(s) {
    return s.toLowerCase().replace(/[ぁ-ゖ]/g, function (ch) {
      return String.fromCharCode(ch.charCodeAt(0) + 0x60);
    });
  }
  var index = tiles.map(function (t) { return norm(t.dataset.kw + " " + t.textContent); });

  // 人気: 全ユーザーの利用データに基づくランキング(RANK。週次で更新される)
  function renderPopular() {
    popEl.innerHTML = "";
    RANK.slice(0, 8).forEach(function (slug, i) {
      var t = bySlug[slug];
      if (!t) return;
      var clone = t.cloneNode(true);
      clone.hidden = false;
      var rk = document.createElement("span");
      var n = i + 1;
      rk.className = "rk" + (n === 1 ? "" : n === 2 ? " silver" : n === 3 ? " bronze" : " plain");
      rk.textContent = n;
      clone.querySelector(".ic").appendChild(rk);
      popEl.appendChild(clone);
    });
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
    var label = terms.length ? "検索結果" : (current === "all" ? "すべて" : CATS.filter(function (c) { return c[0] === current; })[0][1]);
    document.getElementById("genre-title").innerHTML = "<b>" + label + "</b><span>" + shown + "個</span>";
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
writeFileSync(ROOT + "/index.html", html);
console.log("production index.html generated:", sorted.length, "tiles");
