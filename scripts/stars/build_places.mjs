#!/usr/bin/env node
/*
 * 地名の索引(stars/data/places.json)を作る。
 *
 * なぜ同梱するのか:
 *   「秩父市」「奥多摩」「富士山」と打って、その近くのスポットを探せるようにしたい。
 *   ふつうは住所検索のサービス(ジオコーダ)を呼ぶが、この構成では使えない。
 *     ・静的サイトなので、鍵を隠せるサーバー側の中継役がいない
 *     ・ブラウザから Nominatim を直接叩くのは先方の利用規約に反するし、
 *       [[rules/scraping-etiquette]] にも反する
 *     ・ページの CSP は connect-src を自サイトに絞ってある。外部を足したくない
 *   そこで、地名と座標の対応表をあらかじめ作って同梱する。
 *   通信は起こらず、機内モードでも動き、先方に負荷をかけない。
 *
 * 出どころ:
 *   GeoNames (https://www.geonames.org/) の日本データ JP.zip。CC BY 4.0。
 *   出典表示はサイトのフッターと about ページで行うこと(ライセンスの条件)。
 *
 * 使い方:
 *   node scripts/stars/build_places.mjs [JP.zip のパス]
 *   パスを省くと geonames から取ってくる(開発時の1回きり)。
 *
 * 出力: stars/data/places.json
 */
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gzipSync, inflateRawSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PREFECTURES } from "./prefectures.mjs";
import { EXTRA_PLACES, DROP_NAMES } from "./places-extra.mjs";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const OUT = path.join(ROOT, "stars", "data", "places.json");
const URL_JP = "https://download.geonames.org/export/dump/JP.zip";

/*
 * 索引に入れる種別。
 *
 * 行政区分は絞り込みに、地形は「あの山の近く」を探すのに使う。
 * 全部入れると10万件になって配信量が跳ねるので、星を見に行く人が
 * 目印にしそうなものだけに限る(駅・ホテル・税務署などは入れない)。
 */
const KINDS = {
  ADM1: { kind: "pref", label: "都道府県" },
  ADM2: { kind: "city", label: "市・郡" },
  ADM3: { kind: "city", label: "町・村・区" },
  MT: { kind: "place", label: "山" },
  /*
   * 火山と山地・連峰。
   *
   * これを落としていたせいで、富士山(3776m)が索引に入っていなかった。
   * GeoNames では富士山の分類は MT ではなく VLC(火山)で、
   * 「富士山」で検索すると神奈川と千葉の小さな丘(標高167m/288m)だけが出ていた。
   * 阿蘇山・開聞岳・桜島も VLC、八ヶ岳連峰・榛名山・剱岳は MTS。
   * 星を見に行く先として、どれも落としてよいものではない。
   */
  VLC: { kind: "place", label: "火山" },
  MTS: { kind: "place", label: "山地・連峰" },
  PK: { kind: "place", label: "峰" },
  HLL: { kind: "place", label: "丘" },
  PASS: { kind: "place", label: "峠" },
  PLAT: { kind: "place", label: "高原" },
  CAPE: { kind: "place", label: "岬" },
  ISL: { kind: "place", label: "島" },
  LK: { kind: "place", label: "湖" },
  RSV: { kind: "place", label: "ダム湖" },
  FLLS: { kind: "place", label: "滝" },
  BCH: { kind: "place", label: "浜" },
  VAL: { kind: "place", label: "谷" },
  PRK: { kind: "place", label: "公園" }
};

const HAS_KANJI = /[一-鿿]/;
const ALL_KANA = /^[ぁ-ゟ゠-ヿー]+$/;

/*
 * GeoNames の alternatenames は言語の区別がなく、中国語(簡体字)の表記も混ざる。
 * 素朴に「漢字を含む最短の名前」を採ると、東京都が「东京都」になった
 * (どちらも3文字なので、並べ替えの偶然で簡体字が先に来た)。
 *
 * ここに並べるのは、日本語では使わないと確認できた簡体字だけ。
 * 迷った字は入れない ── 日本語でも使う字を混ぜると、正しい地名まで捨ててしまう
 * (最初にそれをやって、会・内・作・区などを弾きかけた)。
 * 取りこぼしは下の都道府県名の照合で気づける。
 */
const SIMPLIFIED = /[东广岛滨泽县阳长龙华关门马鸟冈乡团园图泷苏达边张岭样业检欢汉济尔观见军单岁归录时]/;

const GOOD_TAIL = /(都|道|府|県|市|区|町|村|郡|山|岳|峰|峠|原|湖|沼|池|岬|崎|島|嶼|浜|浦|滝|谷|川|公園|高原|台|丘|森|平)$/;

/* 都道府県コード(GeoNames の admin1)→ 名前。ADM1 の行から作る */
const PREF_BY_CODE = new Map();

/* 正しい都道府県名(このリポジトリの唯一の出所) */
const PREF_NAMES = new Set(PREFECTURES.map(([p]) => p));

/**
 * カタカナをひらがなに寄せる。
 * 検索で「ちちぶ」と打っても「チチブ」と打っても当たるようにするため。
 *
 * ヶ・ヵ は変換しない(理由は stars/places.js の同名の関数に書いた)。
 * ここと向こうで規則が食い違うと、索引と検索語が噛み合わなくなる。
 */
function toHiragana(s) {
  return s
    .replace(/[ァ-ヴ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/ゕ/g, "ヵ")
    .replace(/ゖ/g, "ヶ");
}

/** zip の中の1ファイルを取り出す(格納/deflate のみ。JP.zip はこれで足りる) */
function unzipOne(buf, wantName) {
  // End of central directory を後ろから探す
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip の終端が見つかりません");

  let off = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);

  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error("zip の目録が壊れています");
    const method = buf.readUInt16LE(off + 10);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);

    if (name === wantName) {
      const lnLen = buf.readUInt16LE(localOff + 26);
      const leLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lnLen + leLen;
      const size = buf.readUInt32LE(off + 20); // compressed size
      const body = buf.subarray(start, start + size);
      if (method === 0) return body;
      if (method === 8) return inflateRawSync(body);
      throw new Error("未対応の圧縮方式: " + method);
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(wantName + " が zip の中にありません");
}

async function getZip(argPath) {
  if (argPath && existsSync(argPath)) {
    process.stderr.write(`読み込み: ${argPath}\n`);
    return readFile(argPath);
  }
  process.stderr.write(`取得中: ${URL_JP}\n`);
  // この環境では Node の fetch が届かないことがあるので curl を使う
  const tmp = path.join(HERE, "generated", "JP.zip");
  await mkdir(path.dirname(tmp), { recursive: true });
  await run("curl", ["-s", "--max-time", "300", "-o", tmp, URL_JP], { maxBuffer: 1 << 28 });
  return readFile(tmp);
}

const zip = await getZip(process.argv[2]);
const text = unzipOne(zip, "JP.txt").toString("utf8");

/* ---- 1回目: 都道府県コードの対応表を作る ---- */
for (const line of text.split("\n")) {
  const c = line.split("\t");
  if (c.length < 19 || c[7] !== "ADM1") continue;
  const jp = c[3].split(",").find((a) => PREF_NAMES.has(a));
  if (jp) PREF_BY_CODE.set(c[10], jp);
}
process.stderr.write(`都道府県: ${PREF_BY_CODE.size} 件\n`);

/* ---- 2回目: 索引を組み立てる ---- */
const seen = new Set();
const rows = [];
const counts = {};

const extraById = new Map(EXTRA_PLACES.map((e) => [e.id, e]));
const extraSeen = new Set();

for (const line of text.split("\n")) {
  const c = line.split("\t");
  if (c.length < 19) continue;
  const extra = extraById.get(c[0]);
  const spec = extra ? { kind: "place", label: extra.label } : KINDS[c[7]];
  if (!spec) continue;

  const alts = extra ? [extra.name, extra.kana] : c[3].split(",");
  if (extra) extraSeen.add(c[0]);

  /*
   * 表示に使う日本語名を選ぶ。
   * 漢字を含み、簡体字を含まないものの中から、
   * 「日本語として自然な語尾を持つ」→「短い」の順に優先する。
   */
  const kanjiNames = alts.filter((a) => HAS_KANJI.test(a) && !SIMPLIFIED.test(a));
  if (!kanjiNames.length) continue;

  /*
   * 都道府県だけは、このリポジトリが持つ正しい一覧との完全一致で選ぶ。
   * 47件しかなく答えが分かっているので、推測に頼る理由がない。
   */
  if (c[7] === "ADM1") {
    const exact = kanjiNames.find((a) => PREF_NAMES.has(a));
    if (!exact) continue;
    kanjiNames.length = 0;
    kanjiNames.push(exact);
  }

  /*
   * 市区町村は「市・町・村・区・郡」まで含んだ正式な形を選ぶ。
   *
   * 「短いほう」を選ぶ規則のままだと、GeoNames の別名に
   * 「宮崎」と「宮崎市」の両方があるとき短い「宮崎」が採られ、
   * 索引に市の付いた名前が1つも入らなくなる。
   * その結果「宮崎市」「青森市」「田村市」と打つと0件になっていた
   * (「宮崎」と打てば当たるが、住所を打つ人は市まで入れる)。
   * 逆に正式な形を入れておけば、「宮崎」でも前方一致で当たる。
   */
  const ADMIN_TAIL = /(都|道|府|県|市|区|町|村|郡)$/;
  const isAdmin = spec.kind === "city" || spec.kind === "pref";

  const name = kanjiNames.sort((a, b) => {
    if (isAdmin) {
      const aa = ADMIN_TAIL.test(a) ? 0 : 1;
      const ab = ADMIN_TAIL.test(b) ? 0 : 1;
      // 正式な形を先に。そのうえで長いほう(「北九州市若松区」>「若松区」)
      if (aa !== ab) return aa - ab;
      if (a.length !== b.length) return b.length - a.length;
      return a.localeCompare(b, "ja");
    }
    const ga = GOOD_TAIL.test(a) ? 0 : 1;
    const gb = GOOD_TAIL.test(b) ? 0 : 1;
    return ga - gb || a.length - b.length || a.localeCompare(b, "ja");
  })[0];

  // 読み。ひらがな・カタカナだけの別名を拾ってひらがなに寄せる
  const kanaAlts = alts.filter((a) => ALL_KANA.test(a)).map(toHiragana);
  const kana = kanaAlts.sort((a, b) => b.length - a.length)[0] || "";

  // 星を見に行く先の検索には使わないもの(本州・尖閣諸島など。理由は places-extra.mjs)
  if (DROP_NAMES.has(name)) continue;

  const pref = c[7] === "ADM1" ? name : PREF_BY_CODE.get(c[10]) || "";
  const lat = Number(c[4]);
  const lon = Number(c[5]);
  if (!isFinite(lat) || !isFinite(lon)) continue;

  // 同じ名前・同じ県・ほぼ同じ場所のものは1つにまとめる
  const key = `${name}|${pref}|${lat.toFixed(2)}|${lon.toFixed(2)}`;
  if (seen.has(key)) continue;
  seen.add(key);

  /*
   * 目立ち度。同じ名前が複数あるとき、どれを先に出すかに使う。
   * 「富士山」で神奈川の小さな丘(標高数十m)が先に出てはいけない。
   * 山などは標高、集落は人口を目安にする。
   */
  const population = Number(c[14]) || 0;
  const elevation = Number(c[15]) || Number(c[16]) || 0;
  const rank = spec.kind === "place" ? elevation : population;

  counts[spec.label] = (counts[spec.label] || 0) + 1;
  rows.push({
    n: name,
    k: kana,
    p: pref,
    t: spec.kind,
    l: spec.label,
    r: Math.max(0, Math.round(rank)),
    y: Math.round(lat * 10000) / 10000,
    x: Math.round(lon * 10000) / 10000
  });
}

/* ---- 補完辞書が全部当たったか ---- */
for (const e of EXTRA_PLACES) {
  if (!extraSeen.has(e.id)) {
    throw new Error(
      `補完辞書の id ${e.id}(${e.name})が GeoNames に見つかりません。\n` +
        `  ${e.note}\n` +
        "  GeoNames 側で id が変わったか、消えた可能性があります。確かめてから直してください。"
    );
  }
}

/*
 * ---- 都道府県が空のまま残った地点を埋める ----
 *
 * GeoNames の admin1 が空の行が残る。ほとんどは離島と湖で、
 * そのままだと絞り込みの表示が「・島」「・湖」になり、
 * どこの島なのか分からないまま候補に並ぶ。
 *
 * 埋め方は「いちばん近い市区町村の県」。島や湖は必ずどこかの
 * 市区町村に属しているので、40km 以内に市区町村があればそれで足りる
 * (いちばん遠い伊豆諸島でも本土側ではなく島の役場が当たる)。
 * それでも見つからないものは、索引から落とす ── 県が分からない地点を
 * 候補に出しても、利用者はどこの話か判断できない。
 */
{
  const admins = rows.filter((r) => r.t === "city" && r.p);
  const LIMIT_KM = 40;
  let filled = 0;
  const dropped = [];

  const distKm = (a, b, c2, d) => {
    const R = 6371;
    const dLat = ((c2 - a) * Math.PI) / 180;
    const dLon = ((d - b) * Math.PI) / 180;
    const la = (a * Math.PI) / 180;
    const lb = (c2 * Math.PI) / 180;
    const h =
      Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };

  for (const r of rows) {
    if (r.p) continue;
    let best = null;
    let bestKm = Infinity;
    for (const a of admins) {
      const km = distKm(r.y, r.x, a.y, a.x);
      if (km < bestKm) {
        bestKm = km;
        best = a;
      }
    }
    if (best && bestKm <= LIMIT_KM) {
      r.p = best.p;
      filled++;
    } else {
      dropped.push(`${r.n}(${r.l}, 最寄り ${best ? Math.round(bestKm) : "?"}km)`);
    }
  }

  const before = rows.length;
  for (let i = rows.length - 1; i >= 0; i--) if (!rows[i].p) rows.splice(i, 1);
  process.stderr.write(
    `都道府県の補完: ${filled} 件を埋め、${before - rows.length} 件を落とした\n`
  );
  if (dropped.length) process.stderr.write(`  落としたもの: ${dropped.join(" / ")}\n`);
}

/* 都道府県が空の行が1件も残っていないこと(絞り込みの表示が壊れるため) */
const noPref = rows.filter((r) => !r.p);
if (noPref.length) {
  throw new Error(`都道府県が空の地点が ${noPref.length} 件残っています`);
}

/*
 * 並びは「行政区分が先、そのあと地形」。
 * 同じ綴りで当たったとき、市町村を先に出したほうが住所検索として自然なため。
 */
const order = { pref: 0, city: 1, place: 2 };
rows.sort((a, b) => order[a.t] - order[b.t] || a.n.length - b.n.length || a.n.localeCompare(b.n, "ja"));

/*
 * 配信量を抑えるため、1件を配列に詰める。
 * 都道府県名と分類は何千回も繰り返すので、表に出して番号で参照する。
 * 素直にオブジェクトで書くと gzip 後で 176KB、この形なら 154KB。
 * 生の大きさは 943KB → 460KB で、読み込んでから展開する手間も減る。
 */
const prefs = [...new Set(rows.map((r) => r.p))];
const kinds = [...new Set(rows.map((r) => r.l))];
const prefIndex = new Map(prefs.map((v, i) => [v, i]));
const kindIndex = new Map(kinds.map((v, i) => [v, i]));

const out = {
  note:
    "地名から座標を引くための索引。住所検索サービスを呼ばずに済ませるために同梱している" +
    "(静的サイトで鍵を隠せる中継役がなく、外部への直叩きは先方の規約に反するため)。",
  source: "GeoNames geographical database (https://www.geonames.org/)",
  license: "CC BY 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  // CC BY 4.0 は「出典・ライセンスへのリンク・変更した旨」の3つを求める。
  // 変更した旨をここにも残す(表示はサイトのフッターと about ページ)。
  modifications:
    "日本の地点から星見の目印になる種別だけを抜き出し、" +
    "日本語表記と読みを選び、都道府県を補い、配列に詰め直した",
  generatedAt: new Date().toISOString().slice(0, 10),
  counts,
  // places の1件は [名前, 読み(ひらがな), 都道府県の番号, 分類の番号, 緯度, 経度]
  format: ["name", "kana", "prefIndex", "kindIndex", "lat", "lon", "rank"],
  prefs,
  kinds,
  places: rows.map((r) => [r.n, r.k, prefIndex.get(r.p), kindIndex.get(r.l), r.y, r.x, r.r])
};

/*
 * 都道府県名が、このリポジトリの正しい一覧と一致するか確かめる。
 *
 * GeoNames の別名には中国語表記が混ざっており、実際に「东京都」を拾ってしまった。
 * 目視では見落とすので、既に持っている正しい表と突き合わせて、
 * 1つでも違えば作り直しを止める。
 */
{
  const want = new Set(PREFECTURES.map(([p]) => p));
  const got = new Set(rows.filter((r) => r.t === "pref").map((r) => r.n));
  const missing = [...want].filter((p) => !got.has(p));
  const extra = [...got].filter((p) => !want.has(p));
  if (missing.length || extra.length) {
    throw new Error(
      "都道府県名が一覧と一致しません。\n  取れなかった: " + missing.join(", ") +
      "\n  余計なもの: " + extra.join(", ")
    );
  }
  process.stderr.write(`都道府県名の照合: ${got.size} 件すべて一致\n`);

  // 市区町村の県名も、正しい一覧の中の値になっているか
  const badPref = rows.filter((r) => r.p && !want.has(r.p));
  if (badPref.length) {
    throw new Error(
      "県名がおかしい地名があります: " +
      badPref.slice(0, 5).map((r) => `${r.n}(${r.p})`).join(", ") +
      ` ほか計${badPref.length}件`
    );
  }
}

await mkdir(path.dirname(OUT), { recursive: true });
const json = JSON.stringify(out);
await writeFile(OUT, json);

const bytes = Buffer.byteLength(json);
const gz = gzipSync(json).length;
process.stderr.write(
  `\n${OUT}\n  ${rows.length} 件 / 生 ${(bytes / 1024).toFixed(0)} KB / gzip ${(gz / 1024).toFixed(0)} KB\n` +
    Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `  ${k}: ${v}`).join("\n") + "\n"
);
