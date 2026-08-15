#!/usr/bin/env node
/*
 * 掲載候補の座標が、どの市区町村の中にあるかを国土地理院に問い合わせ、
 * 結果を spot-candidates.json へ書き戻す。
 *
 * なぜ要るか:
 *   候補の市区町村が正しいかを、同梱の地名索引(役場の代表点)で測っていた。
 *   役場の位置は自治体の中心ではないので、広い自治体では隣町の役場のほうが
 *   近いことが普通にあり、7件が「怪しい」と出たまま潰せなかった。
 *   実際には1件だけが本当の誤りで(椿山森林公園。経度が17kmずれていた)、
 *   残る6件は検査のほうが間違っていた。
 *
 *   国土地理院の逆ジオコーダは行政界そのもので答えるので、
 *   代表点からの距離という当てにならない目安を使わずに済む。
 *
 * なぜ普段のテストでは呼ばないか:
 *   テストは外部へ通信しない決まりにしてある(手元でも、通信のない場所でも
 *   同じ結果になることを優先している)。ここで一度だけ問い合わせて
 *   結果を JSON に書き込み、check_candidates.mjs はそれを読むだけにする。
 *
 * 出どころ:
 *   逆ジオコーダ https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress
 *   市区町村コード表 https://maps.gsi.go.jp/js/muni.js
 *   どちらも国土地理院。利用にあたっては出典を明示すること。
 *
 * 使い方: node scripts/stars/verify_candidate_cities.mjs
 *   候補1件につき1回だけ問い合わせ、間隔を1秒空ける(47件で約1分)。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(HERE, "spot-candidates.json");

const REVERSE = "https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress";
const MUNI_JS = "https://maps.gsi.go.jp/js/muni.js";

/* この環境では Node の fetch が届かないことがあるので curl を使う */
async function get(url, params) {
  const args = ["-s", "--max-time", "60", "-G", url];
  for (const [k, v] of Object.entries(params || {})) {
    args.push("--data-urlencode", `${k}=${v}`);
  }
  const { stdout } = await run("curl", args, { maxBuffer: 1 << 26 });
  return stdout;
}

/* 市区町村コード → { pref, city } */
async function muniTable() {
  const text = await get(MUNI_JS);
  const table = new Map();
  // 例: GSI.MUNI_ARRAY["1101"] = '1,北海道,1101,札幌市　中央区';
  for (const m of text.matchAll(/GSI\.MUNI_ARRAY\["(\d+)"\]\s*=\s*'([^']+)'/g)) {
    const parts = m[2].split(",");
    if (parts.length < 4) continue;
    table.set(m[1], {
      pref: parts[1],
      // 政令市は「札幌市　中央区」のように全角空白で区がつく
      city: parts[3].replace(/　/g, "")
    });
  }
  return table;
}

const data = JSON.parse(readFileSync(FILE, "utf8"));
const table = await muniTable();
process.stderr.write(`市区町村コード表: ${table.size} 件\n`);
if (table.size < 1000) throw new Error("市区町村コード表を読めませんでした");

const CHECKED = new Date().toISOString().slice(0, 10);
let changed = 0;
const report = [];

for (const s of data.spots) {
  const text = await get(REVERSE, { lat: s.lat, lon: s.lon });
  let muniCd = null;
  let lv01 = null;
  try {
    const j = JSON.parse(text);
    muniCd = j.results && j.results.muniCd;
    lv01 = j.results && j.results.lv01Nm;
  } catch (e) {
    /* 海上などは results が空になる */
  }

  /*
   * コードの桁のずれ。
   * 逆ジオコーダは5桁("01460")、市区町村コード表は先頭の0を落とした形("1460")。
   * どちらでも引けるようにしておく。
   */
  const key = String(muniCd || "");
  const hit = table.get(key) || table.get(key.replace(/^0+/, ""));

  if (!hit) {
    s.cityCheck = { ok: false, why: "国土地理院が市区町村を返さなかった", at: CHECKED };
    report.push(`${s.pref} ${s.name}: 市区町村を特定できず(muniCd=${muniCd})`);
    continue;
  }

  const prefOk = hit.pref === s.pref;
  // 政令市は「宮崎市」と「宮崎市清武町」のように表記が割れるので、前方一致で見る
  const cityOk =
    !s.city || hit.city === s.city || hit.city.startsWith(s.city) || s.city.startsWith(hit.city);

  s.cityCheck = {
    ok: prefOk && cityOk,
    muniCd: muniCd,
    pref: hit.pref,
    city: hit.city,
    lv01: lv01 || null,
    source: "国土地理院 逆ジオコーダ",
    at: CHECKED
  };
  if (!prefOk || !cityOk) {
    changed++;
    report.push(
      `${s.pref} ${s.name}(${s.city || "—"}): 実際は ${hit.pref}${hit.city}${lv01 ? " " + lv01 : ""}`
    );
  }

  // 先方に配慮して間隔を空ける
  await new Promise((r) => setTimeout(r, 1000));
}

/*
 * 期待していた市区町村コードと、実際の応答が食い違ったら止める。
 *
 * 独立検証3が公式情報から導いた expectedMuniCd は「こうなるはず」であって、
 * API の応答ではない。食い違ったときに黙って応答のほうへ書き換えると、
 * 「公式の所在地と、座標が指す場所が違う」という肝心の事実が消える。
 * どちらが誤りかは人が決めるので、ここでは止めて見せるだけにする。
 */
{
  const conflicts = [];
  for (const s of data.spots) {
    if (!s.expectedMuniCd || !s.cityCheck) continue;
    const got = String(s.cityCheck.muniCd || "").replace(/^0+/, "");
    const want = String(s.expectedMuniCd).replace(/^0+/, "");
    if (got !== want) {
      conflicts.push(
        `${s.pref} ${s.name}: 期待 ${s.expectedMuniCd} / 応答 ${s.cityCheck.muniCd || "(なし)"}` +
          `(${s.cityCheck.pref || "?"}${s.cityCheck.city || ""})`
      );
    }
  }
  if (conflicts.length) {
    writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");
    console.error("\n期待した市区町村コードと応答が食い違いました。自動では直しません:");
    for (const c of conflicts) console.error("  ・" + c);
    console.error("\n公式の所在地と座標のどちらが誤りかを人が決めてください。");
    process.exit(1);
  }
}

data._所在地の検査 =
  "cityCheck は国土地理院の逆ジオコーダで、座標が実際にどの市区町村の中にあるかを" +
  "確かめた結果。行政界そのもので判定しているので、役場の代表点からの距離より確か。" +
  "取り直しは scripts/stars/verify_candidate_cities.mjs。";

writeFileSync(FILE, JSON.stringify(data, null, 2) + "\n");
console.log(`\n${data.spots.length} 件を照合しました`);
if (report.length) {
  console.log(`\n食い違い ${report.length} 件:`);
  for (const r of report) console.log("  ・" + r);
} else {
  console.log("食い違いはありません");
}
