// 多言語ページの実ブラウザ一括検証
// 各言語の全ツールページを開き、次を確認する:
//  1. pageerror が出ない
//  2. 共有 calc.js が読めている(tests.json のケースをそのページ上で実行して全通過)
//     → 相対パスの間違いを確実に検出する
//  3. hreflang(全言語+x-default)と言語スイッチャがある
//  4. html lang / og:locale / canonical がその言語・そのURLになっている
//  5. 未翻訳の取りこぼし(日本語のUI定型文言が残っていないか)
// 使い方: node scripts/verify_i18n.mjs [ポート番号]  ※先に python3 -m http.server を起動しておく
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = process.argv[2] || "8901";
const BASE = `http://127.0.0.1:${PORT}`;
const LANGS = [
  { code: "en", dir: "en", htmlLang: "en", ogLocale: "en_US" },
  { code: "zh", dir: "zh", htmlLang: "zh-CN", ogLocale: "zh_CN" },
  { code: "ko", dir: "ko", htmlLang: "ko", ogLocale: "ko_KR" }
];
// 翻訳漏れの検出に使う、日本語版UIの定型文言(訳されていれば出てこないもの)
const JA_LEFTOVERS = ["ツール一覧", "お問い合わせ", "詳細機能:", "よくある質問", "計算方法と根拠", "使い方", "関連ツール", "計算ツールボックス"];

const results = [];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
page.setDefaultTimeout(10000);
page.setDefaultNavigationTimeout(20000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

async function check(name, fn) {
  errors.length = 0;
  try {
    await fn();
    if (errors.length) throw new Error("pageerror: " + errors.join(" | "));
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", `${name} → ${String(e).slice(0, 220)}`]);
  }
}

for (const lang of LANGS) {
  const toolsDir = join(ROOT, lang.dir, "tools");
  if (!existsSync(toolsDir)) continue;
  for (const slug of readdirSync(toolsDir).sort()) {
    const file = join(toolsDir, slug, "index.html");
    if (!existsSync(file)) continue;
    const specPath = join(ROOT, "tools", slug, "tests.json");
    const spec = existsSync(specPath) ? JSON.parse(readFileSync(specPath, "utf8")) : null;
    const url = `/${lang.dir}/tools/${slug}/`;

    await check(`${lang.code}/${slug}`, async () => {
      await page.goto(BASE + url, { waitUntil: "load" });

      // 共有 calc.js が読めているか(tests.json をこのページ上で実行)
      if (spec) {
        const out = await page.evaluate((s) => {
          function matches(expect, actual) {
            if (expect !== null && typeof expect === "object") {
              if (actual === null || typeof actual !== "object") return false;
              return Object.keys(expect).every((k) => matches(expect[k], actual[k]));
            }
            return expect === actual;
          }
          const api = window[s.global];
          if (!api) return { loaded: false };
          let pass = 0;
          const bad = [];
          for (const c of s.cases) {
            let ok = false;
            try { ok = matches(c.expect, api[c.func].apply(null, c.args)); } catch (e) { ok = false; }
            if (ok) pass++; else bad.push(c.name);
          }
          return { loaded: true, pass, total: s.cases.length, bad: bad.slice(0, 2) };
        }, spec);
        if (!out.loaded) throw new Error(`共有calc.js未読込(window.${spec.global}が無い): src相対パスを確認`);
        if (out.pass !== out.total) throw new Error(`計算テスト ${out.pass}/${out.total}: ${out.bad.join(" / ")}`);
      }

      // hreflang / 言語スイッチャ / lang / og:locale / canonical
      const meta = await page.evaluate(() => ({
        htmlLang: document.documentElement.getAttribute("lang"),
        hreflang: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => l.getAttribute("hreflang")),
        sw: !!document.querySelector("nav.lang-switch"),
        swCurrent: !!document.querySelector("nav.lang-switch .lang-current"),
        swTop: !!document.querySelector("body > .lang-bar:first-child"),
        swLabel: document.querySelector(".lang-label")?.textContent?.trim(),
        ogLocale: document.querySelector('meta[property="og:locale"]')?.content,
        canonical: document.querySelector('link[rel="canonical"]')?.href,
        h1: document.querySelector("h1")?.textContent?.trim(),
        bodyText: document.body.innerText
      }));
      if (meta.htmlLang !== lang.htmlLang) throw new Error(`html lang=${meta.htmlLang}(期待 ${lang.htmlLang})`);
      if (meta.ogLocale !== lang.ogLocale) throw new Error(`og:locale=${meta.ogLocale}(期待 ${lang.ogLocale})`);
      if (meta.canonical !== `https://quick-calc.site${url}`) throw new Error(`canonical=${meta.canonical}`);
      for (const h of ["ja", "en", "zh", "ko", "x-default"]) {
        if (!meta.hreflang.includes(h)) throw new Error(`hreflang ${h} が無い`);
      }
      if (!meta.sw || !meta.swCurrent) throw new Error("言語スイッチャが無い/現在言語の印が無い");
      if (!meta.swTop) throw new Error("言語スイッチャがページ最上部にない");
      if (meta.swLabel !== "Language") throw new Error(`言語スイッチャの見出しが Language でない: ${meta.swLabel}`);
      if (!meta.h1) throw new Error("h1が空");
      const left = JA_LEFTOVERS.filter((w) => meta.bodyText.includes(w));
      if (left.length) throw new Error(`日本語の定型文言が残存: ${left.join(", ")}`);

      // 通信・DOM操作を伴うツールは実際に動かして確認する
      if (slug === "jusho") {
        // 日本の住所 → 英語表記
        await page.fill("#zip", "100-0014");
        await page.waitForFunction(() => {
          const b = document.getElementById("result");
          return b && !b.hidden && /Chiyoda-ku/.test(b.textContent);
        }, null, { timeout: 8000 }).catch(() => {
          throw new Error("郵便番号100-0014から住所を引けない(shared/postalへの相対パスを確認)");
        });
        await page.fill("#banchi", "1丁目2番3号");
        const txt = await page.textContent("#result");
        if (!/1-2-3 Nagatacho/.test(txt)) throw new Error(`番地の整形が効いていない: ${txt.slice(0, 120)}`);

        // 母国の書き方 → 日本語表記
        await page.selectOption("#mode", "to-ja");
        await page.selectOption("#country", "np");
        await page.fill("#foreign-input", "Apt 201, 3-2-1 Nishishinjuku, Shinjuku-ku, Tokyo 160-0023");
        await page.waitForFunction(() => {
          const b = document.getElementById("rev-result");
          return b && !b.hidden && b.textContent.indexOf("東京都新宿区西新宿3-2-1") >= 0;
        }, null, { timeout: 8000 }).catch(() => {
          throw new Error("逆変換で日本語表記にできない(shared/postalへの相対パスと解析を確認)");
        });
        const rev = await page.textContent("#rev-result");
        if (rev.indexOf("Apt 201") < 0) throw new Error(`建物名が保持されていない: ${rev.slice(0, 120)}`);

        // 郵便番号が無いときの町名検索
        await page.fill("#foreign-input", "3-2-1 Nishishinjuku, Shinjuku-ku, Tokyo");
        await page.waitForFunction(() => !document.getElementById("rev-lookup").hidden, null, { timeout: 8000 })
          .catch(() => { throw new Error("郵便番号なしのとき町名検索が出ない"); });
        await page.click("#town-search");
        await page.waitForFunction(() => document.querySelectorAll("button.cand").length > 0, null, { timeout: 8000 })
          .catch(() => { throw new Error("町名の逆引き候補が出ない(shared/postal/revへの相対パスを確認)"); });
        await page.click("button.cand");
        await page.waitForFunction(() => document.getElementById("rev-result").textContent.indexOf("東京都") >= 0,
          null, { timeout: 8000 }).catch(() => { throw new Error("候補を選んでも結果が出ない"); });
      }
      if (slug === "shukujitsu" || slug === "gakunen") {
        const filled = await page.evaluate(() => {
          const boxes = [...document.querySelectorAll(".tool-result")].filter((b) => !b.hidden);
          return boxes.some((b) => b.textContent.trim().length > 10);
        });
        if (!filled) throw new Error("初期表示で結果が出ていない");
      }
    });
  }

  // 言語別トップと必須ページ
  for (const p of ["", "privacy.html", "disclaimer.html"]) {
    await check(`${lang.code}/${p || "(top)"}`, async () => {
      await page.goto(`${BASE}/${lang.dir}/${p}`, { waitUntil: "load" });
      const m = await page.evaluate(() => ({
        htmlLang: document.documentElement.getAttribute("lang"),
        sw: !!document.querySelector("nav.lang-switch"),
        links: [...document.querySelectorAll('main a[href^="./tools/"]')].length,
        tiles: document.querySelectorAll("#grid .tile").length,
        tabs: document.querySelectorAll(".tp-tab").length,
        popular: document.querySelectorAll("#popular .tile").length,
        search: !!document.getElementById("search-input"),
        poll: !!document.getElementById("poll-card"),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
      }));
      if (m.htmlLang !== lang.htmlLang) throw new Error(`html lang=${m.htmlLang}`);
      if (p === "" && m.links === 0) throw new Error("トップにツールへのリンクが無い");
      if (p !== "" && !m.sw) throw new Error("言語スイッチャが無い");
      if (p === "") {
        // 日本語版トップと同じUIが揃っているか
        if (m.tiles < 60) throw new Error(`タイルが少ない: ${m.tiles}`);
        if (m.tabs !== 5) throw new Error(`カテゴリタブが5個でない: ${m.tabs}`);
        if (m.popular === 0) throw new Error("人気枠が空");
        if (!m.search) throw new Error("検索欄が無い");
        if (!m.poll) throw new Error("統計ツール枠が無い");
        if (m.overflow) throw new Error("横方向にはみ出している");
      }
    });
  }
}

// 日本語版が壊れていないかの回帰チェック
for (const p of ["/", "/tools/wareki/", "/tools/jusho/", "/tools/shukujitsu/", "/tools/gakunen/"]) {
  await check(`ja ${p}`, async () => {
    await page.goto(BASE + p, { waitUntil: "load" });
    const sw = await page.$("nav.lang-switch");
    if (p === "/" && !sw) throw new Error("トップに言語スイッチャが無い");
  });
}

await browser.close();
let fail = 0;
for (const [s, n] of results) {
  if (s === "FAIL") { fail++; console.log("FAIL " + n); }
}
console.log(`${results.length - fail} / ${results.length} 通過${fail ? "(失敗あり)" : "(全通過)"}`);
process.exit(fail ? 1 : 0);
