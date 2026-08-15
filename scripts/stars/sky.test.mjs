#!/usr/bin/env node
/*
 * 空の計算(月と、夜がどの日かの判定)を「外から取ってきた値」と
 * 突き合わせる回帰テスト。
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
 * 使い方: node scripts/stars/sky.test.mjs
 * ネットワークには出ない。fixture を取り直すのは fetch_fixtures.mjs。
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";

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

/* ---- 4-2. 沈んでいる月は点数に影響しないこと ------------------------------ */
{
  /*
   * 「満月だろうと沈んでいれば影響なし」が点数に反映されているかを確かめる。
   *
   * 月齢や輝面比は点数に一切入らない。効くのは brightness だけで、
   * これは地平線下で 0 を返す。つまり満月の夜でも、月が沈んでいる時間帯は
   * 新月の夜とまったく同じ点数になっていなければならない。
   * ここが崩れると「今夜は満月だからやめよう」と、
   * 実際には月あかりのない好条件の夜を捨てさせてしまう。
   */
  const Score = require(path.join(ROOT, "stars", "score.js"));
  const LAT = 35.6581;
  const LON = 139.7414;

  const scoreAt = (iso) => {
    const d = new Date(iso);
    return Score.evaluate({
      lpIndex: 105, cloudPct: 0, precipPct: 0,
      moonBrightness: Sky.brightness(d, LAT, LON)
    }).score;
  };

  // 2026-07-29 は満月(輝面比 99.9%)
  const fullUp = new Date("2026-07-29T16:00:00Z");   // 満月が高く昇っている
  const fullDown = new Date("2026-07-29T01:00:00Z"); // 同じ満月の日だが沈んでいる
  const newMoon = new Date("2026-08-12T13:00:00Z");  // 新月

  ok(
    Sky.illumination(fullDown).fraction > 0.99,
    "前提: 2026-07-29 は満月のはず",
    String(Sky.illumination(fullDown).fraction)
  );
  ok(
    Sky.position(fullDown, LAT, LON).altitudeDeg < 0,
    "前提: その時刻の月は地平線下のはず",
    String(Sky.position(fullDown, LAT, LON).altitudeDeg)
  );

  ok(
    Sky.brightness(fullDown, LAT, LON) === 0,
    "満月でも沈んでいれば月あかりは0",
    String(Sky.brightness(fullDown, LAT, LON))
  );
  ok(
    scoreAt(fullDown.toISOString()) === scoreAt(newMoon.toISOString()),
    "満月でも沈んでいれば新月と同じ点数",
    `満月(沈) ${scoreAt(fullDown.toISOString())} / 新月 ${scoreAt(newMoon.toISOString())}`
  );
  ok(
    scoreAt(fullUp.toISOString()) < scoreAt(fullDown.toISOString()) - 10,
    "満月が出ているときは、はっきり点が下がる",
    `満月(出) ${scoreAt(fullUp.toISOString())} / 満月(沈) ${scoreAt(fullDown.toISOString())}`
  );

  // 高いほど効く(sin(高度)の重み)。低い満月は高い満月より点が高い。
  const low = new Date("2026-07-29T19:00:00Z");
  ok(
    scoreAt(low.toISOString()) > scoreAt(fullUp.toISOString()),
    "同じ満月でも、低いほうが影響が小さい",
    `低い ${scoreAt(low.toISOString())} / 高い ${scoreAt(fullUp.toISOString())}`
  );
  console.log("月あかり: 沈んだ月は点数に影響しないことを確認");
}

/* ---- 5. 端末のタイムゾーンに左右されないこと ----------------------------- */
{
  /*
   * 「今夜」がどの日かは、見ている人の端末の時計の設定ではなく、
   * その地点の位置で決まらなければならない。日本国外から日本の夜を見ても
   * 同じものが出る必要がある。
   *
   * 子プロセスで TZ を変えて確かめる(同じプロセス内では変えられない)。
   */
  const sites = [
    ["代表", 36, 138],
    ["稚内", 45.42, 141.67],
    ["東京", 35.68, 139.76],
    ["石垣島", 24.34, 124.16]
  ];
  const code =
    'const S=require(' + JSON.stringify(path.join(ROOT, "stars", "sky.js")) + ');' +
    'const n=new Date("2026-08-14T19:00:00Z");' +
    'process.stdout.write(' +
    JSON.stringify(sites.map((s) => [s[1], s[2]])) +
    '.map(function(r){return S.currentNightDate(r[0],r[1],n);}).join(","));';

  const zones = ["UTC", "Asia/Tokyo", "America/Los_Angeles", "Pacific/Kiritimati"];
  const seen = zones.map((tz) =>
    execFileSync(process.execPath, ["-e", code], {
      env: { ...process.env, TZ: tz },
      encoding: "utf8"
    })
  );

  ok(
    new Set(seen).size === 1,
    "端末のタイムゾーンで「今夜」が変わってしまう",
    zones.map((tz, i) => `${tz}: ${seen[i]}`).join(" / ")
  );

  // 中身も期待どおりか(石垣島だけ前日の夜が続いている)
  ok(
    seen[0] === "2026-08-15,2026-08-15,2026-08-15,2026-08-14",
    "8/15 04:00 JST の各地点の夜",
    seen[0]
  );
  console.log(`夜の判定: ${zones.length}つのタイムゾーンで同じ結果`);
}

/* ---- 4-b. 期待値の出どころが後から辿れること ---------------------------- */
{
  /*
   * 「いつ取ったか」しか残っていないと、数字が合わなくなったときに
   * こちらの実装が変わったのか、Horizons の設定を違えたのか、
   * 先方の版が上がったのかを切り分けられない。
   * 問い合わせの中身・応答の版・応答の指紋が残っていることを確かめる。
   */
  for (const name of ["moon-horizons.json", "moon-riseset-horizons.json"]) {
    const fx = readFixture(name);
    ok(Array.isArray(fx.requests) && fx.requests.length > 0, `${name}: 問い合わせの記録がある`);
    for (const r of fx.requests || []) {
      ok(r.url && r.params && r.params.SITE_COORD, `${name}: 問い合わせの中身が残っている`, r.label);
      ok(/^sha256:[0-9a-f]{64}$/.test(r.responseSha256 || ""), `${name}: 応答の指紋がある`, r.label);
      /*
       * 指紋だけでは、後から「その応答が本当にこれだった」ことを示せない。
       * 比べる相手が無いためで、ハッシュは過去の応答の存在を証明しない。
       * 生の応答も残し、そこから指紋を計算し直せることを確かめる。
       */
      let recomputed = null;
      try {
        const raw = gunzipSync(Buffer.from(r.responseGzipBase64 || "", "base64")).toString("utf8");
        recomputed = "sha256:" + createHash("sha256").update(raw, "utf8").digest("hex");
      } catch (e) {
        /* 生の応答が無いか壊れている */
      }
      ok(
        recomputed === r.responseSha256,
        `${name}: 生の応答から指紋を計算し直せる`,
        `${r.label} / ${recomputed || "生の応答が無い"}`
      );
      ok(typeof r.apiVersion === "string", `${name}: API の版が残っている`, String(r.apiVersion));
      // 標高は 0km で問い合わせている。この前提は文書にも書いてある
      ok(/,0'$/.test(r.params.SITE_COORD), `${name}: 標高0kmで問い合わせている`, r.params.SITE_COORD);
    }
    ok(fx.siteAltitudeKm === 0, `${name}: 標高0kmの前提が記録されている`, String(fx.siteAltitudeKm));
    ok(
      typeof fx.limits === "string" && fx.limits.length > 10,
      `${name}: 比較の限界が書かれている`,
      String(fx.limits).slice(0, 30)
    );
  }
  console.log("期待値の出どころ: 問い合わせの中身・API版・応答の指紋を記録済み");
}

/* ---- 5. 月あかりは地点ごとに違う ---------------------------------------- */
/*
 * 全国の地図が月の減点を「地図の中心1点」で済ませていた不具合の証拠を、
 * テストとして残す。同じ時刻でも、日本の南北で月の高度は20度以上違う。
 * 「全国でほとんど変わらない」という前提そのものが誤りだった。
 *
 * 期待値は独立検証(scripts/stars/INDEPENDENT-REVIEW-2.md §1)が
 * 別に計算した値。実装を走らせて作った値ではない。
 */
{
  const when = new Date("2026-05-30T18:00:00Z"); // 2026-05-31 03:00 JST
  const expected = [
    { name: "稚内", lat: 45.42, lon: 141.67, altitudeDeg: -0.6 },
    { name: "地図の中心付近", lat: 36, lon: 138, altitudeDeg: 7.5 },
    { name: "石垣島", lat: 24.34, lon: 124.16, altitudeDeg: 24.2 }
  ];

  for (const e of expected) {
    const got = Sky.position(when, e.lat, e.lon).altitudeDeg;
    ok(
      Math.abs(got - e.altitudeDeg) <= 0.3,
      `${e.name}の月高度が独立検証と一致する`,
      `実装 ${got.toFixed(2)} 度 / 検証 ${e.altitudeDeg} 度`
    );
  }

  const b = (e) => Sky.brightness(when, e.lat, e.lon);
  ok(b(expected[0]) === 0, "地平線の下では月あかりが 0 になる", String(b(expected[0])));
  ok(
    b(expected[2]) - b(expected[1]) > 0.2,
    "同じ時刻でも石垣島と本州中央で月あかりが大きく違う",
    `石垣 ${b(expected[2]).toFixed(3)} / 中央 ${b(expected[1]).toFixed(3)}`
  );
  console.log(
    `月あかりの地点差: 稚内 ${b(expected[0]).toFixed(3)} / ` +
      `中央 ${b(expected[1]).toFixed(3)} / 石垣 ${b(expected[2]).toFixed(3)}`
  );
}

console.log(`\n${checks - failed} / ${checks} 件通過${failed ? "(失敗あり)" : "(全通過)"}`);
process.exit(failed ? 1 : 0);
