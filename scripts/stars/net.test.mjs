#!/usr/bin/env node
/*
 * 壊れた天気キャッシュをサイト側がどう扱うかの回帰テスト。
 *
 * 何を守るためのテストか:
 *   雲量が欠けているとき、以前は 0 を入れて先へ進んでいた。
 *   雲量 0 は「快晴」を意味するので、データが無いときに画面は最高の評価を出す。
 *   「分からない」と言われるより、「快晴」と言われて出かけて曇っているほうが害が大きい。
 *
 *   サーバー側(weather-cache.sql)でも同じ検証をしているが、
 *   古いキャッシュが残っている・別の経路で配られる、という状況はありうる。
 *   最後に画面へ出すのはサイト側なので、ここでも必ず見る。
 *
 * 期待する結果は2つのどちらか:
 *   ・はっきり例外にする(画面にはその旨が出る)
 *   ・NaN として残す(地図では塗らず、表では「データなし」と出る)
 *   どちらでもない「0 になる」は不可。
 *
 * 使い方: node scripts/stars/net.test.mjs
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// net.js はブラウザ向けなので、読み込みに要る分だけ用意する
globalThis.STARS_CONFIG = { grid: { south: 24, north: 46, west: 123, east: 146, stepDeg: 1 } };
const Net = require(path.join(ROOT, "stars", "net.js"));

let failed = 0;
let checks = 0;

function ok(cond, label, detail) {
  checks++;
  if (cond) return;
  failed++;
  console.log(`❌ ${label}`);
  if (detail !== undefined) console.log(`   ${detail}`);
}

/* ---- 正常なキャッシュを組み立てる ---------------------------------------- */

const META = { south: 24, north: 26, west: 123, east: 125, step: 1 }; // 3×3 = 9地点
const N = 9;
const NT = 5;
const T0 = 1786000000; // 適当な基準時刻(unixtime)

function times() {
  return Array.from({ length: NT }, (_, k) => T0 + k * 3600);
}

function series(value) {
  return Array.from({ length: N }, () => Array.from({ length: NT }, () => value));
}

function goodRow() {
  return {
    meta: { ...META },
    updated_at: new Date(T0 * 1000).toISOString(),
    payload: {
      times: times(),
      cloud: series(40),
      precip: series(10),
      visibility: series(24000),
      humidity: series(50)
    }
  };
}

const START = new Date(T0 * 1000);
const END = new Date((T0 + (NT - 1) * 3600) * 1000);

function slice(row) {
  return Net.sliceGrid(row, START, END);
}

/* ---- 0. まず正常なものが通ること ----------------------------------------- */
{
  const g = slice(goodRow());
  ok(g.times.length === NT, "正常なキャッシュの時刻数", g.times.length);
  ok(g.rows === 3 && g.cols === 3, "格子の大きさ", `${g.rows}×${g.cols}`);
  ok(g.cloud[0][0] === 40, "雲量が読める", g.cloud[0][0]);
  ok(g.imputed.missing === 0 && g.imputed.filled === 0, "欠測はゼロ");
}

/* ---- 1. 例外になるべきもの ----------------------------------------------- */

function mustThrow(label, mutate) {
  const row = goodRow();
  mutate(row);
  let threw = null;
  let result;
  try {
    result = slice(row);
  } catch (e) {
    threw = e;
  }
  ok(threw !== null, `${label}: 例外にならず素通りした`,
     threw === null ? JSON.stringify(result && result.cloud[0] && Array.from(result.cloud[0])) : "");
  // 例外にならなかった場合、0(快晴)に化けていないかも見ておく
  if (threw === null && result) {
    ok(result.cloud[0][0] !== 0, `${label}: 雲量が0(快晴)に化けた`);
  }
}

mustThrow("雲量が丸ごと無い", (r) => { delete r.payload.cloud; });
mustThrow("視程が丸ごと無い", (r) => { delete r.payload.visibility; });
mustThrow("降水確率が丸ごと無い", (r) => { delete r.payload.precip; });
mustThrow("湿度が丸ごと無い", (r) => { delete r.payload.humidity; });
mustThrow("地点数が足りない", (r) => { r.payload.cloud = series(40).slice(0, 5); });
mustThrow("ある地点の配列だけ短い", (r) => { r.payload.cloud[3] = [40, 40]; });
mustThrow("時刻が無い", (r) => { r.payload.times = []; });
mustThrow("時刻が並んでいない", (r) => { r.payload.times = [T0, T0 - 3600, T0, T0, T0]; });
mustThrow("時刻に数値でないものが混じる", (r) => { r.payload.times[2] = "2026-08-14"; });
mustThrow("値が文字列", (r) => { r.payload.cloud[0][0] = "40"; });
mustThrow("値が範囲外(雲量999)", (r) => { r.payload.cloud[0][0] = 999; });
mustThrow("値が負", (r) => { r.payload.humidity[0][0] = -5; });
mustThrow("payload が無い", (r) => { delete r.payload; });
mustThrow("格子の定義が壊れている", (r) => { r.meta.step = null; });
mustThrow("雲量が配列でない", (r) => { r.payload.cloud = "たくさん"; });

/* ---- 2. 欠測(null)の扱い -------------------------------------------------- */
{
  // 途中の1時間だけ欠ける → 直前の値で埋める
  const row = goodRow();
  row.payload.cloud[0][2] = null;
  const g = slice(row);
  ok(g.cloud[2][0] === 40, "1時間の欠測は直前の値で埋める", g.cloud[2][0]);
  ok(g.imputed.filled === 1, "埋めた数が記録される", g.imputed.filled);
  ok(g.imputed.missing === 0, "埋めきれなかった数はゼロ", g.imputed.missing);
}

{
  // 先頭が欠ける → 埋める材料が無い。0 にはせず NaN のままにする
  const row = goodRow();
  row.payload.cloud[0][0] = null;
  const g = slice(row);
  ok(Number.isNaN(g.cloud[0][0]), "先頭の欠測が0に化けていない", g.cloud[0][0]);
  ok(g.imputed.missing === 1, "埋めきれなかった数が記録される", g.imputed.missing);
  ok(g.cloud[1][0] === 40, "先頭以外は無事", g.cloud[1][0]);
}

{
  // 2時間以上続く欠測 → 1時間だけ埋め、その先は NaN
  const row = goodRow();
  row.payload.cloud[0][1] = null;
  row.payload.cloud[0][2] = null;
  row.payload.cloud[0][3] = null;
  const g = slice(row);
  ok(g.cloud[1][0] === 40, "欠測1時間目は埋める", g.cloud[1][0]);
  ok(Number.isNaN(g.cloud[2][0]), "欠測2時間目は埋めない", g.cloud[2][0]);
  ok(Number.isNaN(g.cloud[3][0]), "欠測3時間目も埋めない", g.cloud[3][0]);
  ok(g.imputed.filled === 1 && g.imputed.missing === 2,
     "埋めた数と諦めた数", `${g.imputed.filled} / ${g.imputed.missing}`);
}

{
  // 全地点・全時刻が欠測 → どこも 0(快晴)にならない
  const row = goodRow();
  row.payload.cloud = Array.from({ length: N }, () => Array.from({ length: NT }, () => null));
  const g = slice(row);
  let zeros = 0;
  for (let k = 0; k < NT; k++) {
    for (let i = 0; i < N; i++) if (g.cloud[k][i] === 0) zeros++;
  }
  ok(zeros === 0, "全欠測でも0(快晴)にならない", `${zeros} 個が0`);
  ok(g.imputed.missing === N * NT, "全部が欠測として数えられる", g.imputed.missing);
}

/* ---- 3. 欠測は画面に伝わるか -------------------------------------------- */
{
  const row = goodRow();
  row.payload.cloud[0][0] = null;
  const g = slice(row);
  const note = Net.coverageNote(g);
  ok(note !== null && /データなし|欠け/.test(note), "欠測があることが文言に出る", note);
}

{
  const g = slice(goodRow());
  ok(Net.coverageNote(g) === null, "問題が無ければ文言は出さない", Net.coverageNote(g));
}

/* ---- 4. 求めた時間帯がキャッシュに無い ----------------------------------- */
{
  const row = goodRow();
  let threw = false;
  try {
    Net.sliceGrid(row, new Date((T0 + 86400) * 1000), new Date((T0 + 90000) * 1000));
  } catch (e) {
    threw = true;
  }
  ok(threw, "範囲外を求めたら例外にする");
}

console.log(`\n${checks - failed} / ${checks} 件通過${failed ? "(失敗あり)" : "(全通過)"}`);
process.exit(failed ? 1 : 0);
