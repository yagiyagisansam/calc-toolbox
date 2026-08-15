#!/usr/bin/env node
/*
 * 都道府県と地方の対応表を、使う場所それぞれの形へ書き出す。
 * 使い方: node scripts/stars/build_prefs.mjs
 *
 * 出力:
 *   stars/data/prefs.json        申請フォームの選択肢
 *   scripts/stars/setup.sql      @prefs ブロックを差し替え(DB側の検証用)
 *
 * 唯一の出所は scripts/stars/prefectures.mjs。
 * フォームとDBに同じ表を別々に書くと必ずずれるので、生成に寄せている。
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PREFECTURES, REGIONS } from "./prefectures.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ---- ① フォーム用の JSON ----
const json = {
  note: "scripts/stars/prefectures.mjs から生成。直接編集しないこと。",
  regions: REGIONS,
  prefectures: PREFECTURES.map(([pref, region]) => ({ pref, region }))
};
const jsonPath = path.join(ROOT, "stars", "data", "prefs.json");
mkdirSync(path.dirname(jsonPath), { recursive: true });
writeFileSync(jsonPath, JSON.stringify(json, null, 2) + "\n");

// ---- ② SQL の @prefs ブロック ----
const sqlPath = path.join(ROOT, "scripts", "stars", "setup.sql");
const sql = readFileSync(sqlPath, "utf8");

const rows = PREFECTURES.map(
  ([pref, region], i) =>
    `  ('${pref}', '${region}')${i === PREFECTURES.length - 1 ? "" : ","}`
).join("\n");

const block = [
  "-- @prefs start",
  "insert into public.stars_prefectures (pref, region) values",
  rows,
  "on conflict (pref) do update set region = excluded.region;",
  "-- @prefs end"
].join("\n");

const START = "-- @prefs start";
const END = "-- @prefs end";
const from = sql.indexOf(START);
const to = sql.indexOf(END);
if (from < 0 || to < 0) {
  console.error(`setup.sql に ${START} / ${END} が見つかりません`);
  process.exit(1);
}
const updated = sql.slice(0, from) + block + sql.slice(to + END.length);
writeFileSync(sqlPath, updated);

console.log(`都道府県 ${PREFECTURES.length} 件 / 地方 ${REGIONS.length} 区分`);
console.log("  stars/data/prefs.json を更新");
console.log("  scripts/stars/setup.sql の @prefs ブロックを更新");
