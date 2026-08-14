#!/usr/bin/env node
/*
 * 月の位置の「答え合わせ用」の値を、外部の権威ある情報源から取ってきて保存する。
 *
 * なぜ要るか:
 *   以前は sky.js のテストの期待値を sky.js 自身で計算して書いていた。
 *   これでは実装が間違っていてもテストが通ってしまう(実際に通っていた)。
 *   独立検証で、月の高度が最大2.3度ずれていることが分かった。
 *   二度と同じことにならないよう、期待値は必ず外から取る。
 *
 * 取得元:
 *   NASA/JPL Horizons (https://ssd.jpl.nasa.gov/horizons/)
 *   DE441 に基づく暦。月の位置はこれを正とする。
 *   取るのは「大気差なしの見かけの高度・方位(観測地点から見た値)」。
 *   大気差を含めないのは、大気の状態に左右されない量で比べたいため。
 *
 * 使い方:
 *   node scripts/stars/fetch_fixtures.mjs
 *     → scripts/stars/fixtures/moon-horizons.json を作り直す
 *
 * テストはこのファイルを読むだけで、ネットワークには出ない。
 */
import { writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, "fixtures", "moon-horizons.json");
const OUT_RTS = path.join(HERE, "fixtures", "moon-riseset-horizons.json");

/* 比べる地点。北・中央・南に散らして、緯度による効きの違いも見る */
const SITES = [
  { name: "東京", lat: 35.6581, lon: 139.7414 },
  { name: "稚内", lat: 45.4156, lon: 141.6731 },
  { name: "石垣島", lat: 24.3448, lon: 124.1572 }
];

/* 取得する期間。月の満ち欠けが一巡し、地平線付近も高いところも含むように選ぶ */
const SPANS = [
  { start: "2026-08-14 09:00", stop: "2026-08-14 12:00", step: "10 m" },
  { start: "2026-08-20 09:00", stop: "2026-08-20 21:00", step: "60 m" },
  { start: "2026-08-28 09:00", stop: "2026-08-28 21:00", step: "60 m" }
];

/* Horizons へ問い合わせて $$SOE〜$$EOE の中身を返す */
async function horizonsRaw(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) q.append(k, v);
  /*
   * この環境では Node の fetch が Horizons に届かない(プロキシに阻まれる)ので curl を使う。
   * 取得は開発時の1回きりで、テストはこのファイルを読むだけなので実害はない。
   */
  const args = ["-s", "--max-time", "180", "-G", "https://ssd.jpl.nasa.gov/api/horizons.api"];
  for (const [k, v] of q) args.push("--data-urlencode", `${k}=${v}`);
  const { stdout: text } = await run("curl", args, { maxBuffer: 32 * 1024 * 1024 });
  const a = text.indexOf("$$SOE");
  const b = text.indexOf("$$EOE");
  if (a < 0 || b < 0) throw new Error("Horizons の応答を読めません:\n" + text.slice(-500));
  return text.slice(a + 5, b).trim();
}

const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function toIso(y, mon, d, hh, mm) {
  return `${y}-${String(MON.indexOf(mon) + 1).padStart(2, "0")}-${d}T${hh}:${mm}:00Z`;
}

async function horizons(site, span) {
  const q = new URLSearchParams();
  const add = (k, v) => q.append(k, v);
  add("format", "text");
  add("COMMAND", "'301'"); // 月
  add("OBJ_DATA", "'NO'");
  add("MAKE_EPHEM", "'YES'");
  add("EPHEM_TYPE", "'OBSERVER'");
  add("CENTER", "'coord@399'"); // 地球上の指定座標から見る
  add("COORD_TYPE", "'GEODETIC'");
  add("SITE_COORD", `'${site.lon},${site.lat},0'`); // 東経, 北緯, 標高km
  add("START_TIME", `'${span.start}'`);
  add("STOP_TIME", `'${span.stop}'`);
  add("STEP_SIZE", `'${span.step}'`);
  add("QUANTITIES", "'4,10'"); // 4=方位/高度, 10=輝面比
  add("ANG_FORMAT", "'DEG'");
  add("APPARENT", "'AIRLESS'"); // 大気差を含めない
  add("CAL_FORMAT", "'CAL'");

  /*
   * この環境では Node の fetch が Horizons に届かない(プロキシに阻まれる)ので curl を使う。
   * 取得は開発時の1回きりで、テストはこのファイルを読むだけなので実害はない。
   */
  const args = ["-s", "--max-time", "120", "-G", "https://ssd.jpl.nasa.gov/api/horizons.api"];
  for (const [k, v] of q) args.push("--data-urlencode", `${k}=${v}`);
  const { stdout: text } = await run("curl", args, { maxBuffer: 32 * 1024 * 1024 });
  const a = text.indexOf("$$SOE");
  const b = text.indexOf("$$EOE");
  if (a < 0 || b < 0) throw new Error("Horizons の応答を読めません:\n" + text.slice(-500));

  const rows = [];
  for (const line of text.slice(a + 5, b).trim().split("\n")) {
    // 例: " 2026-Aug-14 10:20 Nm  275.729875  -0.274325  47.12345"
    const m = line.match(
      /^\s*(\d{4})-([A-Za-z]{3})-(\d{2})\s+(\d{2}):(\d{2})\s+\S*\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/
    );
    if (!m) continue;
    const iso = toIso(m[1], m[2], m[3], m[4], m[5]);
    rows.push({
      utc: iso,
      azimuthDeg: Number(m[6]),
      altitudeDeg: Number(m[7]),
      illuminatedPct: Number(m[8])
    });
  }
  if (!rows.length) throw new Error("行を1つも読めませんでした");
  return rows;
}

const out = {
  note:
    "NASA/JPL Horizons (DE441) から取得した月の位置。大気差を含まない、観測地点から見た値。" +
    "sky.js の期待値をここから取ることで、実装で期待値を作る循環を断つ。",
  source: "https://ssd.jpl.nasa.gov/horizons/",
  fetchedAt: new Date().toISOString(),
  quantities: "azimuth/altitude = airless apparent, topocentric / illuminated fraction",
  samples: []
};

for (const site of SITES) {
  for (const span of SPANS) {
    process.stderr.write(`取得中: ${site.name} ${span.start}…\n`);
    const rows = await horizons(site, span);
    out.samples.push({ site, rows });
    // 先方に配慮して間隔を空ける
    await new Promise((r) => setTimeout(r, 3000));
  }
}

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(
  `保存しました: ${OUT}\n  ${out.samples.length} 区間 / ${out.samples.reduce((n, s) => n + s.rows.length, 0)} 時点`
);

/* ---- 月の出・月の入り -------------------------------------------------- */

/*
 * Horizons の R_T_S_ONLY='TVH' は「屈折を含む月の上端が地平線に接する瞬間」を返す。
 * 国立天文台の月の出・月の入りと同じ定義なので、sky.js の moonRiseSet を
 * そのまま突き合わせられる。刻みを1分にしているので、値の量子化は1分。
 */
const RTS_SITES = [
  { name: "東京", lat: 35.6581, lon: 139.7414 },
  { name: "稚内", lat: 45.4156, lon: 141.6731 },
  { name: "石垣島", lat: 24.3448, lon: 124.1572 }
];

const rtsOut = {
  note:
    "NASA/JPL Horizons の月の出・月の入り。定義は「大気差を含む月の上端が地平線に接する瞬間」で、" +
    "国立天文台の月の出入りと同じ。刻み1分のため値は1分に量子化されている。",
  source: "https://ssd.jpl.nasa.gov/horizons/",
  fetchedAt: new Date().toISOString(),
  definition: "refracted upper limb at true visual horizon (R_T_S_ONLY='TVH')",
  quantizationMinutes: 1,
  sites: []
};

for (const site of RTS_SITES) {
  process.stderr.write(`取得中(月の出入り): ${site.name}…\n`);
  const body = await horizonsRaw({
    format: "text",
    COMMAND: "'301'",
    OBJ_DATA: "'NO'",
    MAKE_EPHEM: "'YES'",
    EPHEM_TYPE: "'OBSERVER'",
    CENTER: "'coord@399'",
    COORD_TYPE: "'GEODETIC'",
    SITE_COORD: `'${site.lon},${site.lat},0'`,
    START_TIME: "'2026-08-14'",
    STOP_TIME: "'2026-08-22'",
    STEP_SIZE: "'1 m'",
    QUANTITIES: "'4'",
    ANG_FORMAT: "'DEG'",
    CAL_FORMAT: "'CAL'",
    R_T_S_ONLY: "'TVH'"
  });

  const events = [];
  for (const line of body.split("\n")) {
    // 例: " 2026-Aug-14 10:23 Ns  276.141875  -0.869011"
    //           日付      時刻  太陽/月の状態 + イベント記号(r=出, s=入, t=南中)
    const m = line.match(
      /^\s*(\d{4})-([A-Za-z]{3})-(\d{2})\s+(\d{2}):(\d{2})\s+(\S*)\s+(-?[\d.]+)\s+(-?[\d.]+)/
    );
    if (!m) continue;
    const mark = m[6].slice(-1); // 最後の1文字がイベント記号
    if (mark !== "r" && mark !== "s") continue; // 南中(t)は使わない
    events.push({
      kind: mark === "r" ? "rise" : "set",
      utc: toIso(m[1], m[2], m[3], m[4], m[5]),
      altitudeDeg: Number(m[8])
    });
  }
  if (!events.length) throw new Error(`${site.name}: 月の出入りを1件も読めませんでした`);
  rtsOut.sites.push({ site, events });
  await new Promise((r) => setTimeout(r, 3000));
}

await writeFile(OUT_RTS, JSON.stringify(rtsOut, null, 1) + "\n");
console.log(
  `保存しました: ${OUT_RTS}\n  ${rtsOut.sites.length} 地点 / ` +
    `${rtsOut.sites.reduce((n, s) => n + s.events.length, 0)} イベント`
);
