// lab(検討中ツール)の実ブラウザ一括検証
// 各ページを開いて次を確認する:
//  1. pageerror が出ない
//  2. calc.js が読めていて、tests.json のケースをそのページ上で実行して全通過
//  3. ページの作りが揃っている(h1・フォーム・結果表示・出典・検討中の帯・CSP)
//  4. 入力を実際に動かして結果が出る(空・0・極端な値・文字列を入れても壊れない)
//  5. 自由入力の値がそのままHTMLとして解釈されない(XSSの持ち込み)
// 使い方: node scripts/verify_lab.mjs [ポート番号]  ※先に python3 -m http.server を起動しておく
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = process.argv[2] || "8901";
const BASE = `http://127.0.0.1:${PORT}`;
const LAB = join(ROOT, "lab");

const results = [];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
page.setDefaultTimeout(10000);
page.setDefaultNavigationTimeout(20000);
let errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
let dialogs = 0;
page.on("dialog", async (d) => { dialogs++; await d.dismiss(); });

async function check(name, fn) {
  errors = [];
  dialogs = 0;
  try {
    await fn();
    if (errors.length) throw new Error("pageerror: " + errors.join(" | "));
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", `${name} → ${String(e).slice(0, 240)}`]);
  }
}

// 入力欄に入れて壊れないか見る値(境界と異常系)
const PROBES = ["", "0", "1", "-1", "999999999", "abc", "<img src=x onerror=alert(1)>"];

const slugs = readdirSync(LAB, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("_")) // _template などの作業用は対象外
  .map((e) => e.name)
  .sort();

for (const slug of slugs) {
  const specPath = join(LAB, slug, "tests.json");
  const spec = existsSync(specPath) ? JSON.parse(readFileSync(specPath, "utf8")) : null;

  await check(slug, async () => {
    await page.goto(`${BASE}/lab/${slug}/`, { waitUntil: "load" });

    // calc.js が読めていて、テストがページ上で通るか
    if (!spec) throw new Error("tests.json が無い");
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
    if (!out.loaded) throw new Error(`calc.js未読込(window.${spec.global}が無い)`);
    if (out.pass !== out.total) throw new Error(`計算テスト ${out.pass}/${out.total}: ${out.bad.join(" / ")}`);

    // ページの作りが揃っているか
    const s = await page.evaluate(() => ({
      h1: document.querySelector("h1")?.textContent?.trim() || "",
      inputs: document.querySelectorAll("main input, main select, main textarea").length,
      result: document.querySelectorAll("main .tool-result").length,
      sources: document.querySelectorAll("main .sources li").length,
      lead: !!document.querySelector("main .lead-card"),
      draft: !!document.querySelector(".lab-note"),
      csp: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
      title: document.title,
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    }));
    if (!s.h1) throw new Error("h1が空");
    if (!s.title) throw new Error("titleが空");
    if (s.inputs === 0) throw new Error("入力欄が無い");
    if (s.result === 0) throw new Error("結果の表示先が無い");
    if (s.sources === 0) throw new Error("出典が無い");
    if (!s.lead) throw new Error("lead-card(このツールでわかること)が無い");
    if (!s.draft) throw new Error("検討中の帯(.lab-note)が無い");
    if (!s.csp) throw new Error("CSPのmetaが無い");
    if (s.overflow) throw new Error("横方向にはみ出している");

    // 実際に動かす: 何か入れて結果が出ること
    const filled = await page.evaluate(() => {
      const els = [...document.querySelectorAll("main input, main select")];
      let n = 0;
      for (const el of els) {
        if (el.tagName === "SELECT") { if (el.options.length > 1) { el.selectedIndex = 1; n++; } }
        else if (el.type === "checkbox" || el.type === "radio") { el.checked = true; n++; }
        else if (el.type === "date" || el.type === "month" || el.type === "time") {
          // 日付系は「10」では無効値になるので、min/maxの範囲に収まる実在の値を入れる
          const def = { date: "2026-07-15", month: "2026-07", time: "12:00" }[el.type];
          let v = def;
          if (el.min && v < el.min) v = el.min;
          if (el.max && v > el.max) v = el.max;
          el.value = v;
          n++;
        } else {
          const min = parseFloat(el.min), max = parseFloat(el.max);
          let v = 10;
          if (isFinite(min) && v < min) v = min;
          if (isFinite(max) && v > max) v = max;
          el.value = el.type === "number" || el.inputMode === "numeric" || el.inputMode === "decimal" ? String(v) : "10";
          n++;
        }
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const btn = document.querySelector("main button[type=submit], main form button");
      if (btn) btn.click();
      return n;
    });
    if (filled === 0) throw new Error("入力できる要素が無い");
    await page.waitForTimeout(150);
    const shown = await page.evaluate(() =>
      [...document.querySelectorAll("main .tool-result")].some((b) => !b.hidden && b.textContent.trim().length > 0));
    if (!shown) throw new Error("値を入れても結果が表示されない");

    // 異常値を入れても落ちないか + 自由入力がHTMLとして解釈されないか
    for (const probe of PROBES) {
      await page.evaluate((v) => {
        for (const el of document.querySelectorAll("main input")) {
          if (el.type === "checkbox" || el.type === "radio") continue;
          el.value = v;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const btn = document.querySelector("main button[type=submit], main form button");
        if (btn) btn.click();
      }, probe);
      await page.waitForTimeout(60);
    }
    const injected = await page.evaluate(() => !!document.querySelector("main img[onerror], main script"));
    if (injected) throw new Error("入力値がHTMLとして差し込まれている(エスケープ漏れ)");
    if (dialogs > 0) throw new Error(`ダイアログが出た(${dialogs}回)`);
  });
}

await browser.close();

// PDFの一覧表に載せるため、ツールごとの結果をファイルに残す
const report = {};
for (const [st, n] of results) {
  const slug = n.split(" ")[0].replace(/ .*/, "").split(" →")[0];
  report[slug] = { ok: st === "PASS", note: st === "PASS" ? "" : n.slice(slug.length + 3, slug.length + 160) };
}
writeFileSync(join(LAB, "verify_report.json"), JSON.stringify(report, null, 1));

let fail = 0;
for (const [st, n] of results) {
  if (st === "FAIL") { fail++; console.log("FAIL " + n); }
}
console.log(`${results.length - fail} / ${results.length} 通過${fail ? "(失敗あり)" : "(全通過)"}`);
console.log("→ lab/verify_report.json に結果を保存しました");
process.exit(fail ? 1 : 0);
