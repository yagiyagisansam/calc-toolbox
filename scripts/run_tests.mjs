#!/usr/bin/env node
/*
 * 全ツールの tests.json を Node で一括実行する開発用ランナー(サイト本体には不要)。
 * 使い方: node scripts/run_tests.mjs [--lab] [ツール名...]  ※省略時は全ツール / --lab で lab/ を対象
 * 判定は各ツールの test.html と同じ「期待値の部分一致」。
 *
 * tests.json の形式は2通り(どちらも test.html 側と共通):
 *   1) 1モジュール:  { "module": "calc.js", "global": "BmiCalc", "cases": [...] }
 *   2) 複数モジュール: { "modules": { "StarsScore": "score.js", "StarsSky": "sky.js" },
 *                       "cases": [{ "global": "StarsSky", ... }] }
 * 2) は星見スポット(stars/)のように、1つのプロダクトが複数の純関数モジュールを
 *    持つ場合に使う。cases の "global" で呼び先を選ぶ。
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function matches(expect, actual) {
  if (expect !== null && typeof expect === "object") {
    if (actual === null || typeof actual !== "object") return false;
    return Object.keys(expect).every((k) => matches(expect[k], actual[k]));
  }
  return expect === actual;
}

// --lab を付けると lab/(公開サイトに反映していない検討中ツール)を対象にする
const args = process.argv.slice(2);
const base = args.includes("--lab") ? "lab" : "tools";
const only = args.filter((a) => a !== "--lab");

// tools/<slug>/ に加えて、計算ツールではない別プロダクト(直下に tests.json を持つ)も対象にする
const PRODUCT_DIRS = ["stars"];
const targets = readdirSync(path.join(root, base), { withFileTypes: true })
  .filter((e) => e.isDirectory() && (only.length === 0 || only.includes(e.name)))
  .map((e) => ({ name: e.name, dir: path.join(root, base, e.name) }));
if (base === "tools") {
  for (const name of PRODUCT_DIRS) {
    if (only.length === 0 || only.includes(name)) {
      targets.push({ name, dir: path.join(root, name) });
    }
  }
}

let total = 0;
let failed = 0;
for (const { name, dir } of targets) {
  const specPath = path.join(dir, "tests.json");
  if (!existsSync(specPath)) continue;
  const spec = JSON.parse(readFileSync(specPath, "utf8"));

  // 単一モジュール形式も複数モジュール形式も、グローバル名 → API の対応表に揃える
  const modules = spec.modules || { [spec.global]: spec.module };
  const apis = {};
  for (const [globalName, file] of Object.entries(modules)) {
    apis[globalName] = require(path.join(dir, file));
  }
  const defaultGlobal = spec.global || Object.keys(modules)[0];

  for (const c of spec.cases) {
    total++;
    let actual;
    let ok;
    try {
      const api = apis[c.global || defaultGlobal];
      if (!api) throw new Error(`未知のモジュール: ${c.global}`);
      actual = api[c.func](...c.args);
      ok = matches(c.expect, actual);
    } catch (err) {
      actual = String(err);
      ok = false;
    }
    if (!ok) {
      failed++;
      console.log(`❌ ${name}: ${c.name}`);
      console.log(`   期待: ${JSON.stringify(c.expect)}`);
      console.log(`   実際: ${JSON.stringify(actual)}`);
    }
  }
}
console.log(`${total - failed} / ${total} 件通過${failed ? "(失敗あり)" : "(全通過)"}`);
process.exit(failed ? 1 : 0);
