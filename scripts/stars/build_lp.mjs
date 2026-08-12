#!/usr/bin/env node
/*
 * 光害(夜間光)の静的ラスタ stars/data/lp-japan.png を生成する開発用スクリプト。
 * サイト本体の動作には不要。年1回程度の更新を想定している。
 *
 * 使い方:
 *   node scripts/stars/build_lp.mjs                 通常実行
 *   node scripts/stars/build_lp.mjs --target 12     採用する夜の枚数を変える
 *   node scripts/stars/build_lp.mjs --months 36     さかのぼる期間を変える
 *   node scripts/stars/build_lp.mjs --dry-run       候補日の一覧だけ出して終了
 *
 * データ:
 *   NASA GIBS / VIIRS Suomi-NPP "GapFilled BRDF Corrected DayNightBand Radiance"
 *   (NASA Black Marble VNP46A2 相当。月光BRDF・大気・地形・迷光の補正済み日次プロダクト)
 *   https://gibs.earthdata.nasa.gov/  認証不要・利用制限なし(出典明記のこと)
 *
 * 方針:
 *   1. 月明かりの影響を避けるため、新月前後の夜(輝面比が小さい日)だけを候補にする。
 *   2. 1つの朔望月から採るのは最大 MAX_PER_CYCLE 枚。特定の季節・気象に偏らせない。
 *   3. 取得した画像のうち、観測が無くほぼ空("不透明画素の割合"が低い)ものは捨てる。
 *   4. 画素ごとの「中央値」を採る。平均ではなく中央値にするのは、残った雲・漁火・
 *      花火やイベント照明のような一時的な光を落とすため。
 *   5. 「その画素が放つ光」から「その画素の上空の明るさ」へ変換する(glow.mjs)。
 *      これをやらないと、都心の隣の暗い山頂が外洋と同じ最高評価になってしまう。
 *   6. PNG には変換後の値を入れ、暗い/明るいの正規化パラメータは JSON 側に置く。
 *      校正をやり直すときに画像を作り直さなくて済むようにするため。
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { decodePNG, encodeGrayPNG } from "./png.mjs";
import { skyGlow } from "./glow.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const Moon = require(path.join(ROOT, "stars", "moon.js"));

// ---- 設定 --------------------------------------------------------------

// 対象範囲。与那国(123E)から南鳥島(154E)、沖ノ鳥島寄り(24N)から北海道北端(46N)まで含む。
const BBOX = { west: 122, south: 24, east: 154, north: 46 };
// 出力の画素数。散乱を計算した後のラスタは元々なめらかなので、細かくしても
// 情報は増えずファイルが重くなるだけ。0.0267度 ≒ 2.7km で十分。
const WIDTH = 1200;
const HEIGHT = 825;

// 散乱の計算に使う1画素あたりの距離(km)。ぼかしは縦横とも同じ半径で行うため、
// 南北方向と東西方向の平均を代表値として使う(緯度による差は1割程度)。
const KM_PER_DEG = 111.32;
const CENTER_LAT = (BBOX.north + BBOX.south) / 2;
const KM_PER_PIXEL =
  (((BBOX.north - BBOX.south) / HEIGHT) * KM_PER_DEG +
    ((BBOX.east - BBOX.west) / WIDTH) * KM_PER_DEG * Math.cos((CENTER_LAT * Math.PI) / 180)) /
  2;

// 8bit に落とすときのガンマ。暗い側の階調を残すために伸張する。
const ENCODING_GAMMA = 2.5;

const LAYER = "VIIRS_SNPP_GapFilled_BRDF_Corrected_DayNightBand_Radiance";
const WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";

const TARGET_IMAGES = 16; // 中央値を取るのに採用する枚数
const MAX_PER_CYCLE = 3; // 1朔望月あたりの上限
const MAX_MOON_FRACTION = 0.12; // 輝面比がこれ未満の夜だけ候補にする
const MIN_COVERAGE = 0.6; // 不透明画素がこの割合未満なら観測なしとみなす
const REQUEST_INTERVAL_MS = 3000; // 取得間隔(先方に負荷をかけないため)
const LAG_DAYS = 3; // 当日分は未公開のことがあるので少し前から遡る

// Suomi-NPP の夜間の通過はおよそ現地 01:30。日本(UTC+9)ではその前日の 16:30 UTC。
const OVERPASS_UTC_HOUR = 16.5;

// 散乱(スカイグロウ)の計算パラメータ。詳細は glow.mjs を参照。
const SCATTER = {
  scalesKm: [3, 10, 30, 90, 250], // 近傍から遠方までのぼかし半径
  scaleHeightKm: 10, // 散乱が起きる大気の実効高さ
  // 最終値 = LOCAL_MIX×その場の発光 + (1-LOCAL_MIX)×散乱してきた光。
  // その場に街灯があれば当然見えないので、局所の発光も少しだけ残す。
  localMix: 0.25
};

// GIBS が返す 0-255 のランプは放射輝度に対して線形とみなす。
// (このレイヤーの凡例は等間隔の無彩色ランプで、対数指定は宣言されていない)
// 別のスケールだと判明した場合はこの1か所を直せばよい。
//
// 注意: このランプは「放射ゼロ」を 0 ではなく 7 前後で描く。外洋の値がそれにあたる。
// 引かずに散乱を計算すると、日本中どこにいても一定の下駄が乗ってしまうため、
// 合成後の最小値をゼロ点とみなして差し引く。
function linearize(v, zeroLevel) {
  return Math.max(0, v - zeroLevel);
}

// ---- 引数 --------------------------------------------------------------

const argv = process.argv.slice(2);
function argValue(name, fallback) {
  const i = argv.indexOf(name);
  if (i < 0 || i + 1 >= argv.length) return fallback;
  const v = Number(argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}
const target = argValue("--target", TARGET_IMAGES);
const months = argValue("--months", 24);
const dryRun = argv.includes("--dry-run");

// ---- 候補日の選定 ------------------------------------------------------

function ymd(date) {
  return date.toISOString().slice(0, 10);
}

/** 観測時刻(その日の 16:30 UTC)における月の輝面比 */
function moonFractionAt(date) {
  const t = new Date(date);
  t.setUTCHours(Math.floor(OVERPASS_UTC_HOUR), (OVERPASS_UTC_HOUR % 1) * 60, 0, 0);
  return Moon.illumination(t).fraction;
}

/**
 * 新月前後の夜を新しい順に列挙する。
 * 連続する候補日は1つの朔望月とみなし、各月から最大 MAX_PER_CYCLE 日だけ採る。
 */
function pickCandidates() {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - LAG_DAYS);
  const days = Math.round(months * 30.44);

  const dark = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() - i);
    if (moonFractionAt(d) < MAX_MOON_FRACTION) dark.push(d);
  }

  // 日付が飛んだところを朔望月の切れ目とみなしてグループ化する
  const picked = [];
  let cycleCount = 0;
  for (let i = 0; i < dark.length; i++) {
    if (i > 0) {
      const gapDays = (dark[i - 1] - dark[i]) / 86400000;
      if (gapDays > 3) cycleCount = 0; // 新しい朔望月に入った
    }
    if (cycleCount < MAX_PER_CYCLE) picked.push(dark[i]);
    cycleCount++;
  }
  return picked;
}

// ---- 取得 --------------------------------------------------------------

function tileUrl(dateStr) {
  const p = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetMap",
    LAYERS: LAYER,
    SRS: "EPSG:4326",
    BBOX: `${BBOX.west},${BBOX.south},${BBOX.east},${BBOX.north}`,
    WIDTH: String(WIDTH),
    HEIGHT: String(HEIGHT),
    FORMAT: "image/png",
    TIME: dateStr
  });
  return `${WMS}?${p}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 散乱パラメータを調整して何度も回すことになるため、取得した画像はディスクに残す。
// 同じ画像を先方から取り直さないための措置でもある。
const CACHE_DIR = path.join(os.tmpdir(), "stars-lp-cache");

/**
 * 1日分を取得して輝度配列にする。観測が無ければ gray は null。
 * GIBS のこのレイヤーは無彩色(R=G=B)のランプで返るため、R をそのまま輝度として使う。
 * @returns {Promise<{coverage:number, gray:Uint8Array|null, valid?:Uint8Array, cached:boolean}>}
 */
async function fetchNight(dateStr) {
  mkdirSync(CACHE_DIR, { recursive: true });
  // 画素数を変えたら別のキャッシュになるようファイル名に入れておく
  const cachePath = path.join(CACHE_DIR, `${dateStr}_${WIDTH}x${HEIGHT}.png`);

  let buf;
  let cached = false;
  if (existsSync(cachePath)) {
    buf = readFileSync(cachePath);
    cached = true;
  } else {
    const res = await fetch(tileUrl(dateStr));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(cachePath, buf);
  }

  const img = decodePNG(buf);
  if (img.width !== WIDTH || img.height !== HEIGHT) {
    throw new Error(`想定外のサイズ ${img.width}x${img.height}`);
  }

  const n = WIDTH * HEIGHT;
  const gray = new Uint8Array(n);
  const valid = new Uint8Array(n);
  let opaque = 0;
  for (let i = 0; i < n; i++) {
    const o = i * img.channels;
    const a = img.channels === 4 ? img.data[o + 3] : 255;
    if (a > 0) {
      gray[i] = img.data[o];
      valid[i] = 1;
      opaque++;
    }
  }
  const coverage = opaque / n;
  return coverage < MIN_COVERAGE
    ? { coverage, gray: null, cached }
    : { coverage, gray, valid, cached };
}

// ---- 合成 --------------------------------------------------------------

/** 画素ごとの中央値。observations は {gray, valid} の配列 */
function medianComposite(observations) {
  const n = WIDTH * HEIGHT;
  const out = new Uint8Array(n);
  const bucket = new Uint8Array(observations.length);
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (let j = 0; j < observations.length; j++) {
      if (observations[j].valid[i]) bucket[k++] = observations[j].gray[i];
    }
    if (k === 0) continue;
    // k は最大でも数十なので挿入ソートで十分速い
    for (let a = 1; a < k; a++) {
      const v = bucket[a];
      let b = a - 1;
      while (b >= 0 && bucket[b] > v) {
        bucket[b + 1] = bucket[b];
        b--;
      }
      bucket[b + 1] = v;
    }
    out[i] = k % 2 ? bucket[(k - 1) >> 1] : Math.round((bucket[k / 2 - 1] + bucket[k / 2]) / 2);
  }
  return out;
}

/** 緯度経度 → 画素インデックス(校正の確認用) */
function pixelAt(lat, lon) {
  const x = Math.floor(((lon - BBOX.west) / (BBOX.east - BBOX.west)) * WIDTH);
  const y = Math.floor(((BBOX.north - lat) / (BBOX.north - BBOX.south)) * HEIGHT);
  return y * WIDTH + x;
}

// 校正の目視確認に使う参照地点(おおよそ明るい順)。
// 富士山頂と奥多摩は「地上の光は無いが都心が近い」場所で、散乱を計算しないと
// 外洋と同じ評価になってしまう。散乱が効いているかの確認に使う。
const REFERENCES = [
  { name: "東京・新宿", lat: 35.69, lon: 139.7 },
  { name: "大阪・梅田", lat: 34.7, lon: 135.5 },
  { name: "山梨・甲府", lat: 35.66, lon: 138.57 },
  { name: "東京・奥多摩", lat: 35.81, lon: 139.1 },
  { name: "静岡・富士山頂", lat: 35.36, lon: 138.73 },
  { name: "長野・野辺山", lat: 35.94, lon: 138.48 },
  { name: "長野・上高地", lat: 36.25, lon: 137.63 },
  { name: "岐阜・乗鞍畳平", lat: 36.12, lon: 137.55 },
  { name: "沖縄・西表島", lat: 24.35, lon: 123.83 },
  { name: "小笠原・父島", lat: 27.09, lon: 142.19 },
  { name: "太平洋沖(参照の下限)", lat: 32.0, lon: 145.0 }
];

// ---- 本体 --------------------------------------------------------------

async function main() {
  const candidates = pickCandidates();
  console.log(
    `候補: ${candidates.length}日 (直近${months}か月・輝面比<${MAX_MOON_FRACTION}・1朔望月あたり最大${MAX_PER_CYCLE}日)`
  );
  if (dryRun) {
    candidates.slice(0, 40).forEach((d) => {
      console.log("  ", ymd(d), "輝面比", moonFractionAt(d).toFixed(4));
    });
    return;
  }

  const used = [];
  const observations = [];
  for (const d of candidates) {
    if (observations.length >= target) break;
    const dateStr = ymd(d);
    try {
      const r = await fetchNight(dateStr);
      if (!r.gray) {
        console.log(`  skip ${dateStr} 観測なし(被覆 ${(r.coverage * 100).toFixed(1)}%)`);
      } else {
        observations.push(r);
        used.push(dateStr);
        console.log(
          `  use  ${dateStr} 被覆 ${(r.coverage * 100).toFixed(1)}%  (${observations.length}/${target})`
        );
      }
      // キャッシュから読めたときは先方に触れていないので待たない
      if (!r.cached) await sleep(REQUEST_INTERVAL_MS);
    } catch (e) {
      console.log(`  fail ${dateStr} ${e.message}`);
      await sleep(REQUEST_INTERVAL_MS);
    }
  }

  if (observations.length < Math.min(10, target)) {
    throw new Error(
      `有効な夜が ${observations.length} 枚しか集まらなかった。--months を増やして再実行すること`
    );
  }

  // (1) 画素ごとの中央値 = その地点が放つ光
  const emissionU8 = medianComposite(observations);

  // (2) 散乱を計算して「その地点の上空の明るさ」にする
  //     まず放射ゼロにあたる値(外洋の値)を求めて差し引く
  let zeroLevel = 255;
  for (let i = 0; i < emissionU8.length; i++) {
    if (emissionU8[i] < zeroLevel) zeroLevel = emissionU8[i];
  }
  console.log(`\n放射ゼロとみなす値: ${zeroLevel}`);

  const emission = new Float32Array(emissionU8.length);
  for (let i = 0; i < emission.length; i++) {
    emission[i] = linearize(emissionU8[i], zeroLevel);
  }

  const { glow, weights } = skyGlow(emission, WIDTH, HEIGHT, {
    kmPerPixel: KM_PER_PIXEL,
    scalesKm: SCATTER.scalesKm,
    scaleHeightKm: SCATTER.scaleHeightKm
  });

  const combined = new Float32Array(emission.length);
  let maxCombined = 0;
  for (let i = 0; i < combined.length; i++) {
    const v = SCATTER.localMix * emission[i] + (1 - SCATTER.localMix) * glow[i];
    combined[i] = v;
    if (v > maxCombined) maxCombined = v;
  }

  // (3) 8bit へ符号化する。暗い側の階調を残したいのでガンマをかけて伸張する。
  //     復号は不要で、格納値をそのまま 0(最も暗い)〜255(最も明るい)の指標として使う。
  const gray = new Uint8Array(combined.length);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.round(255 * Math.pow(Math.min(combined[i] / maxCombined, 1), 1 / ENCODING_GAMMA));
  }

  let grayMin = 255;
  for (let i = 0; i < gray.length; i++) if (gray[i] < grayMin) grayMin = gray[i];

  const png = encodeGrayPNG(WIDTH, HEIGHT, gray);

  const outDir = path.join(ROOT, "stars", "data");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "lp-japan.png"), png);

  // 参照地点の値を出して、暗い順に妥当に並んでいるかを確認できるようにする
  const refs = REFERENCES.map((r) => {
    const i = pixelAt(r.lat, r.lon);
    return { ...r, value: gray[i], emission: emissionU8[i] };
  });
  console.log("\n参照地点(左=散乱込みの指標 0-255 / 右=元の発光量):");
  refs.forEach((r) =>
    console.log(`  ${String(r.value).padStart(3)}  (発光 ${String(r.emission).padStart(3)})  ${r.name}`)
  );
  console.log(
    "\n散乱スケールの重み:",
    SCATTER.scalesKm.map((km, i) => `${km}km=${(weights[i] * 100).toFixed(1)}%`).join("  ")
  );

  const meta = {
    layer: LAYER,
    source: "NASA GIBS / VIIRS Suomi-NPP Gap-Filled BRDF-Corrected DayNightBand Radiance (Black Marble VNP46A2 相当)",
    sourceUrl: "https://gibs.earthdata.nasa.gov/",
    credit: "NASA Earth Observing System Data and Information System (EOSDIS) / GIBS",
    generatedAt: new Date().toISOString(),
    method:
      `新月前後の夜 ${observations.length} 枚の画素ごと中央値をとり、` +
      `大気散乱((r²+h²)^-1.25 を多重ガウスで近似)で上空の明るさに変換したもの`,
    caveat:
      "地形による遮蔽・大気の状態・光源の色は考慮していない。絶対的な空の明るさではなく比較用の相対指標である。",
    dates: used,
    bbox: BBOX,
    width: WIDTH,
    height: HEIGHT,
    degPerPixel: {
      lon: (BBOX.east - BBOX.west) / WIDTH,
      lat: (BBOX.north - BBOX.south) / HEIGHT
    },
    kmPerPixel: KM_PER_PIXEL,
    zeroLevel,
    scatter: { ...SCATTER, weights },
    encodingGamma: ENCODING_GAMMA,
    // 格納値 0-255 をそのまま光害指標として使う。
    // floor は「これ以上暗くならない」値(外洋)、ceil は都心の飽和値。
    // score.js はこの2つで 0..1 に正規化する。変えても画像は作り直さなくてよい。
    calibration: { floor: grayMin, ceil: 255 },
    references: refs.map((r) => ({
      name: r.name,
      lat: r.lat,
      lon: r.lon,
      value: r.value,
      emission: r.emission
    }))
  };
  writeFileSync(path.join(outDir, "lp-japan.json"), JSON.stringify(meta, null, 2) + "\n");

  console.log(
    `\n生成: stars/data/lp-japan.png  ${(png.length / 1024).toFixed(0)} KB  (${WIDTH}x${HEIGHT}, ${observations.length}枚合成)`
  );
}

main().catch((e) => {
  console.error("エラー:", e.message);
  process.exit(1);
});
