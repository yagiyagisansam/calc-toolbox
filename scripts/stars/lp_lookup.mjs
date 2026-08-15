#!/usr/bin/env node
/*
 * 指定した地点の光害指標と星見レベルを、このサイト自身のデータで調べる。
 *
 * 何に使うか:
 *   掲載スポットの候補を選ぶとき、「暗そう」という印象ではなく
 *   実際のデータで確かめるため。候補の緯度経度を渡すと、
 *   VIIRS 夜間光から作った光害ラスタ(stars/data/lp-japan.png)を引いて、
 *   快晴・月なしのときの星見レベルを返す。
 *
 *   lp.js はブラウザ専用(canvas を使う)なので、同じ引き方を Node 用に書いてある。
 *   参照する PNG もメタ情報も同じものなので、サイトに出る値と一致する。
 *
 * 使い方:
 *   node scripts/stars/lp_lookup.mjs 36.12 137.55 [名前]
 *   node scripts/stars/lp_lookup.mjs --tsv < 地点一覧.tsv
 *     (1行に「名前<TAB>緯度<TAB>経度」)
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePNG } from "./png.mjs";

const require = createRequire(import.meta.url);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const Score = require(path.join(ROOT, "stars", "score.js"));

const META = JSON.parse(readFileSync(path.join(ROOT, "stars", "data", "lp-japan.json"), "utf8"));
const PNG = decodePNG(readFileSync(path.join(ROOT, "stars", "data", "lp-japan.png")));

/* lp.js の index() と同じ引き方(最近傍。2.7km 四方の格子なので補間しても情報は増えない) */
export function lpIndex(lat, lon) {
  const b = META.bbox;
  if (lat < b.south || lat > b.north || lon < b.west || lon > b.east) return null;
  const x = Math.floor(((lon - b.west) / (b.east - b.west)) * META.width);
  const y = Math.floor(((b.north - lat) / (b.north - b.south)) * META.height);
  if (x < 0 || y < 0 || x >= META.width || y >= META.height) return null;
  // decodePNG は channels ぶん詰めて返す。輝度は先頭チャンネル。
  return PNG.data[(y * META.width + x) * PNG.channels];
}

/** 快晴・月なしのときの星見レベル(その場所の「上限」) */
export function bestPossible(lat, lon) {
  const index = lpIndex(lat, lon);
  if (index === null) return null;
  const r = Score.evaluate({ lpIndex: index, cloudPct: 0, precipPct: 0, moonBrightness: 0 });
  return { index, score: r.score, band: r.band.label, darkness: r.darkness };
}

/* ---- コマンドとして呼ばれたとき ---- */
if (process.argv[1] && process.argv[1].endsWith("lp_lookup.mjs")) {
  const argv = process.argv.slice(2);

  const show = (name, lat, lon) => {
    const r = bestPossible(lat, lon);
    if (!r) {
      console.log(`${name}\t${lat}\t${lon}\tデータ範囲外`);
      return;
    }
    console.log(
      [name, lat, lon, r.index, r.score, r.band, Math.round(r.darkness * 100) + "%"].join("\t")
    );
  };

  if (argv[0] === "--tsv") {
    const text = readFileSync(0, "utf8");
    console.log(["名前", "緯度", "経度", "光害指標", "星見レベル", "段階", "暗さ"].join("\t"));
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const [name, lat, lon] = t.split("\t");
      show(name, Number(lat), Number(lon));
    }
  } else if (argv.length >= 2) {
    show(argv[2] || "(名前なし)", Number(argv[0]), Number(argv[1]));
  } else {
    console.error("使い方: node scripts/stars/lp_lookup.mjs 緯度 経度 [名前]");
    process.exit(1);
  }
}
