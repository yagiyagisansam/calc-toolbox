#!/usr/bin/env node
/*
 * 全ツールの tests.json を Node で一括実行する開発用ランナー(サイト本体には不要)。
 * 使い方: node scripts/run_tests.mjs [ツール名...]  ※省略時は全ツール
 * 判定は各ツールの test.html と同じ「期待値の部分一致」。
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

const only = process.argv.slice(2);
const dirs = readdirSync(path.join(root, "tools"), { withFileTypes: true })
  .filter((e) => e.isDirectory() && (only.length === 0 || only.includes(e.name)))
  .map((e) => e.name);

let total = 0;
let failed = 0;
for (const dir of dirs) {
  const specPath = path.join(root, "tools", dir, "tests.json");
  if (!existsSync(specPath)) continue;
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  const api = require(path.join(root, "tools", dir, spec.module));
  for (const c of spec.cases) {
    total++;
    let actual;
    let ok;
    try {
      actual = api[c.func](...c.args);
      ok = matches(c.expect, actual);
    } catch (err) {
      actual = String(err);
      ok = false;
    }
    if (!ok) {
      failed++;
      console.log(`❌ ${dir}: ${c.name}`);
      console.log(`   期待: ${JSON.stringify(c.expect)}`);
      console.log(`   実際: ${JSON.stringify(actual)}`);
    }
  }
}
console.log(`${total - failed} / ${total} 件通過${failed ? "(失敗あり)" : "(全通過)"}`);
process.exit(failed ? 1 : 0);
