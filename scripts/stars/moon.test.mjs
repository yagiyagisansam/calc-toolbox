#!/usr/bin/env node
/*
 * 月の計算を「外から取ってきた値」と突き合わせる回帰テスト。
 *
 * なぜ tests.json と別立てにするか:
 *   tests.json の判定は完全一致で、許容誤差を書けない。
 *   天文の値は「◯度以内」で合っていれば充分なので、そこはこちらで見る。
 *
 * なぜ外部の値なのか:
 *   以前は sky.js の期待値を sky.js 自身で作っていた。実装が間違っていても
 *   テストが通ってしまい、実際に月の高度が最大2.5度ずれたまま通っていた。
 *   期待値は必ず外から取る。
 *
 * 期待値の出所:
 *   1. 月の位置     scripts/stars/fixtures/moon-horizons.json
 *                   NASA/JPL Horizons (DE441)。大気差なしの測心高度・方位。
 *   2. 月の出入り   scripts/stars/fixtures/moon-riseset-horizons.json
 *                   同じく Horizons。大気差込みの上端が地平線に接する瞬間。
 *   3. 月齢         このファイル内の NAOJ_AGE(国立天文台「暦象年表」の月齢)
 *
 * 使い方: node scripts/stars/moon.test.mjs
 * ネットワークには出ない。fixture を取り直すのは fetch_fixtures.mjs。
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const Sky = require(path.join(ROOT, "stars", "sky.js"));

const readFixture = (name) =>
  JSON.parse(readFileSync(path.join(HERE, "fixtures", name), "utf8"));

let failed = 0;
let checks = 0;

function ok(cond, label, detail) {
  checks++;
  if (!cond) {
    failed++;
    console.log(`❌ ${label}`);
    if (detail) console.log(`   ${detail}`);
  }
}

/* ---- 1. 月の高度・方位 -------------------------------------------------- */
{
  // 指示書の受入条件: 全件0.3度以内
  const LIMIT_DEG = 0.3;
  const fx = readFixture("moon-horizons.json");
  let worst = 0;
  let worstLabel = "";
  let sum = 0;
  let n = 0;

  for (const { site, rows } of fx.samples) {
    for (const row of rows) {
      const got = Sky.position(new Date(row.utc), site.lat, site.lon).altitudeDeg;
      const diff = Math.abs(got - row.altitudeDeg);
      sum += diff;
      n++;
      if (diff > worst) {
        worst = diff;
        worstLabel = `${site.name} ${row.utc} 実装${got.toFixed(4)} JPL${row.altitudeDeg}`;
      }
    }
  }
  ok(
    worst <= LIMIT_DEG,
    `月の高度が JPL Horizons と ${LIMIT_DEG} 度以内 (${n}点)`,
    `最大差 ${worst.toFixed(4)} 度: ${worstLabel}`
  );
  console.log(
    `月の高度: ${n}点 / 平均差 ${(sum / n).toFixed(4)} 度 / 最大差 ${worst.toFixed(4)} 度`
  );
}

/* ---- 2. 月の出・月の入り ------------------------------------------------ */
{
  // 指示書の受入条件: 各イベント10分以内(目標5分)。fixture 自体が1分に量子化されている。
  const LIMIT_MIN = 5;
  const fx = readFixture("moon-riseset-horizons.json");
  let worst = 0;
  let worstLabel = "";
  let n = 0;
  const found = [];

  for (const { site, events } of fx.sites) {
    for (const ev of events) {
      const want = new Date(ev.utc);
      // 前後3時間を渡す。この幅なら該当イベントが必ず1つだけ入る。
      const r = Sky.moonRiseSet(
        new Date(want.valueOf() - 3 * 3600000),
        new Date(want.valueOf() + 3 * 3600000),
        site.lat,
        site.lon
      );
      const got = r[ev.kind];
      ok(got !== null, `${site.name} ${ev.utc} の${ev.kind === "rise" ? "月の出" : "月の入り"}を検出できない`);
      if (!got) continue;
      const diffMin = Math.abs(got.valueOf() - want.valueOf()) / 60000;
      n++;
      found.push(got.valueOf());
      if (diffMin > worst) {
        worst = diffMin;
        worstLabel = `${site.name} ${ev.kind} ${ev.utc} → ${got.toISOString().slice(0, 19)}Z`;
      }
    }
  }
  ok(
    worst <= LIMIT_MIN,
    `月の出入りが JPL Horizons と ${LIMIT_MIN} 分以内 (${n}件)`,
    `最大差 ${worst.toFixed(2)} 分: ${worstLabel}`
  );

  // 10分単位に量子化されていないこと(以前は10分刻みの走査だけで返していた)
  const onTenMin = found.filter((ms) => ms % (10 * 60000) === 0).length;
  ok(
    onTenMin < found.length / 2,
    "月の出入りが10分単位に量子化されている",
    `${found.length}件中 ${onTenMin}件がちょうど10分の倍数`
  );
  console.log(`月の出入り: ${n}件 / 最大差 ${worst.toFixed(2)} 分`);
}

/* ---- 3. 月齢 ------------------------------------------------------------ */
{
  /*
   * 国立天文台の月齢(正午の値)。指示書に列挙されたものをそのまま書き写した。
   * 定義は「直前の朔からの経過日数」。
   */
  const NAOJ_AGE = [
    ["2026-08-01T12:00:00+09:00", 17.7],
    ["2026-08-24T12:00:00+09:00", 11.4],
    ["2026-08-28T12:00:00+09:00", 15.4],
    ["2026-08-31T12:00:00+09:00", 18.4]
  ];
  const LIMIT_DAYS = 0.2;
  for (const [iso, want] of NAOJ_AGE) {
    const got = Sky.illumination(new Date(iso)).ageDays;
    ok(
      Math.abs(got - want) <= LIMIT_DAYS,
      `月齢 ${iso}`,
      `実装 ${got.toFixed(2)} / 国立天文台 ${want} / 差 ${(got - want).toFixed(2)} 日`
    );
  }
  console.log(`月齢: ${NAOJ_AGE.length}件を国立天文台の値と照合`);

  // 月齢が朔望月の範囲に収まること(直前の朔からの経過なので 0〜29.6 日)
  for (let i = 0; i < 60; i++) {
    const d = new Date(Date.UTC(2026, 0, 1) + i * 7 * 86400000);
    const age = Sky.illumination(d).ageDays;
    ok(
      age >= 0 && age < 29.9,
      `月齢が範囲外 ${d.toISOString()}`,
      `${age.toFixed(2)} 日`
    );
  }
}

/* ---- 4. 月あかりの連続性 ------------------------------------------------ */
{
  /*
   * 指示書の要求: 月の出入りの境目の前後で brightness() が連続で、
   * 沈んだあとは 0 であること。
   */
  const LAT = 35.6581;
  const LON = 139.7414;
  const setAt = new Date("2026-08-14T10:23:00Z"); // Horizons の月の入り

  ok(
    Sky.brightness(new Date(setAt.valueOf() + 30 * 60000), LAT, LON) === 0,
    "月が沈んだ30分後の brightness が0でない"
  );
  ok(
    Sky.brightness(new Date(setAt.valueOf() + 6 * 3600000), LAT, LON) === 0,
    "月が沈んだ6時間後の brightness が0でない"
  );

  // 境目の前後1分で値が飛ばない(sin(高度)なので0へ滑らかに近づく)
  const before = Sky.brightness(new Date(setAt.valueOf() - 60000), LAT, LON);
  const after = Sky.brightness(new Date(setAt.valueOf() + 60000), LAT, LON);
  ok(before >= 0 && before < 0.02, "月の入り直前の brightness が跳ねている", `${before}`);
  ok(after === 0, "月の入り直後の brightness が0でない", `${after}`);

  // 高いところでは相応の値が出る(0に張り付いていない)
  const high = Sky.brightness(new Date("2026-07-29T13:00:00Z"), LAT, LON);
  ok(high > 0.4 && high < 0.5, "満月が高いときの brightness がおかしい", `${high}`);
}

console.log(`\n${checks - failed} / ${checks} 件通過${failed ? "(失敗あり)" : "(全通過)"}`);
process.exit(failed ? 1 : 0);
