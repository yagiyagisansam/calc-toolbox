#!/usr/bin/env node
/*
 * 掲載候補(scripts/stars/spot-candidates.json)の中身を機械で検査する。
 *
 * なぜ要るか:
 *   独立検証で、候補データに公式情報と食い違う所在地と道路番号が見つかった
 *   (椿山森林公園は宮崎市の施設なのに日南市、二本杉は国道445号なのに218号)。
 *   候補は掲載されていなくても、Hiroさんが承認を判断するための資料になる。
 *   資料が間違っていれば、そのまま誤った掲載につながる。
 *
 *   市区町村と座標の食い違いは、目で見ても気づけない。
 *   同梱の地名索引(places.json)に照らせば機械で気づける。
 *
 * 何を見るか:
 *   1. 判定(verdict)が4段階のどれかであること
 *   2. 掲載可・条件付き可には、夜間・無料・予約不要それぞれの根拠があること
 *   3. 市区町村が、その都道府県に実在すること
 *   4. 座標が、書かれている都道府県の中にあること(最寄りの市区町村で見る)
 *   5. 座標と市区町村が離れすぎていないこと
 *   6. 47都道府県が1件以上あること
 *   7. 光害の値が、いま同梱しているラスタと一致すること
 *
 * 使い方: node scripts/stars/check_candidates.mjs
 * ネットワークには出ない。
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PREFECTURES } from "./prefectures.mjs";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");

const data = JSON.parse(readFileSync(path.join(HERE, "spot-candidates.json"), "utf8"));
const selection = JSON.parse(readFileSync(path.join(HERE, "selection-2026-08-15.json"), "utf8"));
const places = JSON.parse(readFileSync(path.join(ROOT, "stars", "data", "places.json"), "utf8"));

let failed = 0;
let checks = 0;
/*
 * 「間違いとは言い切れないが、人が見直すべき」もの。
 * 落とすのではなく並べて出す ── 落とすようにすると、正しいデータを
 * 検査に合わせて歪めることになる(役場の位置は自治体の中心ではないので、
 * 広い自治体では隣町の役場のほうが近いことが普通にある)。
 */
const warnings = [];
function ok(cond, label, detail) {
  checks++;
  if (!cond) {
    failed++;
    console.log(`❌ ${label}`);
    if (detail) console.log(`   ${detail}`);
  }
}

const VERDICTS = ["掲載可", "条件付き可", "保留", "除外"];
const APPROVABLE = ["掲載可", "条件付き可"];
const PREF_NAMES = new Set(PREFECTURES.map(([p]) => p));
const selectionByNo = new Map(selection.spots.map((s) => [s.no, s]));

function acceptedException(s, check) {
  return (
    s.acceptance &&
    s.acceptance.acceptedBy === "Hiroさん" &&
    s.acceptance.decidedAt === selection.決定日 &&
    Array.isArray(s.acceptance.exceptions) &&
    s.acceptance.exceptions.some(
      (e) => e.check === check && typeof e.reason === "string" && e.reason.length >= 10
    )
  );
}

/* 索引の市区町村だけを取り出す */
const CITY_KINDS = new Set(["市・郡", "町・村・区"]);
const cities = places.places
  .filter((r) => CITY_KINDS.has(places.kinds[r[3]]))
  .map((r) => ({ name: r[0], pref: places.prefs[r[2]], lat: r[4], lon: r[5] }));

function distKm(a, b, c, d) {
  const R = 6371;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(c - a);
  const dLon = toRad(d - b);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* 近い順に n 件の市区町村 */
function nearestCities(lat, lon, n) {
  return cities
    .map((c) => ({ ...c, km: distKm(lat, lon, c.lat, c.lon) }))
    .sort((a, b) => a.km - b.km)
    .slice(0, n);
}

/*
 * 索引の市区町村名は「富山」「韮崎」のように、市・町・村を落とした形で
 * 入っていることがある(GeoNames の別名から短いほうを選ぶため)。
 * 候補データ側は「富山市」と正式に書くので、末尾を外して照合する。
 */
/*
 * 異体字。GeoNames は自治体名に旧字・略字が混ざる
 * (諫早市 が 諌早市、曽於市 が 曾於市 など)。
 * 表記が違うだけで同じ自治体なので、比べるときだけ寄せる。
 * ここに無い組み合わせは「索引に無い」として落ちる ── 黙って通さない。
 */
const VARIANTS = { 諌: "諫", 曾: "曽", 舘: "館", 濵: "浜", 藪: "薮", 條: "条", 邊: "辺", 瀧: "滝", 澤: "沢" };

function sameCity(a, b) {
  const norm = (s) =>
    String(s)
      .replace(/(市|区|町|村|郡)$/, "")
      .replace(/./g, (c) => VARIANTS[c] || c);
  return a === b || norm(a) === norm(b);
}

/* ---- 1. 形 ---------------------------------------------------------------- */
ok(Array.isArray(data.spots) && data.spots.length >= 47, "候補が47件以上ある", `${data.spots?.length} 件`);

const seenPref = new Set();
for (const s of data.spots) {
  const at = `${s.pref} ${s.name}`;
  seenPref.add(s.pref);

  ok(PREF_NAMES.has(s.pref), `${at}: 都道府県名が正しい`, s.pref);
  ok(VERDICTS.includes(s.verdict), `${at}: 判定が4段階のどれか`, String(s.verdict));
  ok(
    typeof s.verdictWhy === "string" && s.verdictWhy.length > 10,
    `${at}: 判定の理由が書かれている`,
    String(s.verdictWhy).slice(0, 40)
  );

  if (s.acceptance) {
    const selected = selectionByNo.get(s.acceptance.selectionNo);
    ok(
      !!selected && selected.decision === "採用" && selected.pref === s.pref &&
        selected.name === s.acceptance.originalName,
      `${at}: 採用例外が選別原票の採用行と一致する`,
      `selectionNo=${s.acceptance.selectionNo} / originalName=${s.acceptance.originalName}`
    );
    ok(
      s.selection?.no === s.acceptance.selectionNo && s.selection?.decision === "採用",
      `${at}: selection と acceptance が一致する`,
      JSON.stringify(s.selection)
    );
    for (const e of s.acceptance.exceptions || []) {
      ok(
        ["night", "city", "coordinate", "source:night", "source:free", "source:resv"].includes(e.check),
        `${at}: 採用例外の種類が既知`,
        String(e.check)
      );
    }
  }

  /* ---- 2. 承認の対象にするなら、3条件それぞれに根拠が要る ---- */
  if (APPROVABLE.includes(s.verdict)) {
    const covered = new Set();
    for (const src of s.sources || []) for (const c of src.covers || []) covered.add(c);
    if (s.acceptance) {
      for (const e of s.acceptance.exceptions || []) {
        const stale =
          (e.check.startsWith("source:") && covered.has(e.check.slice(7))) ||
          (e.check === "night" && !/要確認|未確認|不可/.test(String(s.night))) ||
          (e.check === "city" && s.cityCheck?.ok === true) ||
          (e.check === "coordinate" && s.coordVerified !== false);
        ok(!stale, `${at}: 解消済みの採用例外が残っていない`, `${e.check}: ${e.reason}`);
      }
    }
    for (const need of ["night", "free", "resv"]) {
      ok(
        covered.has(need) || acceptedException(s, `source:${need}`),
        `${at}: 承認の対象なのに ${need} の根拠が無い`,
        `判定 ${s.verdict} / 根拠 ${[...covered].join(",") || "なし"}`
      );
    }

    /*
     * 座標が、書かれた市区町村の中にあること。
     *
     * 役場の代表点からの距離で見ていたころは、広い自治体で隣町の役場のほうが
     * 近くなり、当てにならなかった。国土地理院の逆ジオコーダは行政界そのもので
     * 答えるので、こちらを使う(結果は cityCheck に書き込んである)。
     * 実際、47件のうち21件が別の市区町村に落ちていた。
     * 1件は県すら違った(福岡県の候補が大分県日田市に落ちていた)。
     *
     * 場所が違うものを承認してはいけないので、ここは警告ではなく失敗にする。
     */
    /*
     * 夜間の欄が「要確認」「未確認」「不可」のまま承認の対象になっていないか。
     *
     * 判定(verdict)と夜間の欄が食い違っていた候補が実際にあった
     * (三重 鵜倉園地。判定は条件付き可なのに、夜間の欄は要確認のまま)。
     * 表を見た人は夜間の欄を読むので、そこが未確認のものを
     * 承認の対象として出してはいけない。
     */
    ok(
      !/要確認|未確認|不可/.test(String(s.night)) || acceptedException(s, "night"),
      `${at}: 承認の対象なのに夜間の欄が「${s.night}」`,
      `判定 ${s.verdict}`
    );

    ok(
      (s.cityCheck && s.cityCheck.ok === true) || acceptedException(s, "city"),
      `${at}: 承認の対象なのに座標と市区町村が一致していない`,
      s.cityCheck
        ? s.cityCheck.pref
          ? `実際は ${s.cityCheck.pref}${s.cityCheck.city}`
          : String(s.cityCheck.why)
        : "cityCheck が無い(verify_candidate_cities.mjs を走らせること)"
    );

    ok(
      s.coordVerified !== false || acceptedException(s, "coordinate"),
      `${at}: 承認の対象なのに座標が確定していない`,
      String(s.coordSource || "coordSource が無い")
    );
  }

  /* すべての候補に、いつ照合したかの記録があること */
  ok(
    s.cityCheck && /^\d{4}-\d{2}-\d{2}$/.test(s.cityCheck.at || ""),
    `${at}: 所在地を照合した記録がある`,
    s.cityCheck ? String(s.cityCheck.at) : "cityCheck が無い"
  );

  for (const src of s.sources || []) {
    ok(
      typeof src.url === "string" && src.url.indexOf("https://") === 0,
      `${at}: 出典が https`,
      String(src.url)
    );
    ok(["公式", "口コミ"].includes(src.kind), `${at}: 出典の種別が 公式 か 口コミ`, String(src.kind));
    ok(/^\d{4}-\d{2}-\d{2}$/.test(src.checkedAt || ""), `${at}: 確認日がある`, String(src.checkedAt));
  }

  /* ---- 3〜5. 市区町村と座標のつじつま ---- */
  if (s.city) {
    const named = cities.find((c) => c.pref === s.pref && sameCity(c.name, s.city));
    ok(!!named, `${at}: 市区町村「${s.city}」が ${s.pref} に実在する`, "地名索引に無い");

    if (named) {
      const km = distKm(s.lat, s.lon, named.lat, named.lon);
      // 市区町村の代表点からの距離。広い自治体があるので緩めに見る
      ok(km <= 40, `${at}: 座標が市区町村「${s.city}」から離れすぎていない`, `${Math.round(km)}km`);

      /*
       * 「その県で近いほうに入っているか」という見方は、もう使わない。
       * 役場の位置は自治体の中心ではないので、広い自治体では隣町の役場のほうが
       * 近いことが普通にあり、正しい7件を疑って本当の誤り1件を見逃していた。
       * 行政界そのもので判定する cityCheck(上)に置き換えた。
       */
    }
  }

  /*
   * 座標が、書かれている都道府県のものか。
   *
   * 行政界の多角形は持っていないので、近い市区町村の代表点で見るしかない。
   * 「いちばん近い1件」で見ると、県境の高原(茶臼山・四国カルスト・久住)が
   * すべて隣県と判定されてしまう ── 実際に県境の上にあるので、これは
   * 検査のほうが間違っている。近い5件のどれかが一致すればよいことにする。
   * この作りでは「隣の県と取り違えた」までは見つけられない。
   * 見つけられるのは「まるで違う場所を書いた」場合だけ。
   */
  const near = nearestCities(s.lat, s.lon, 5);
  ok(
    near.some((c) => c.pref === s.pref),
    `${at}: 座標がその都道府県の近くにある`,
    `近いのは ${near.map((c) => `${c.pref}${c.name}(${Math.round(c.km)}km)`).join(" / ")}`
  );
}

/* ---- 6. 全都道府県がそろっているか ---- */
{
  const missing = [...PREF_NAMES].filter((p) => !seenPref.has(p));
  ok(missing.length === 0, "47都道府県すべてに候補がある", missing.join(" "));
}

/* ---- 7. 光害の値が、いま同梱しているラスタと一致するか ---- */
{
  const { lpIndex } = await import("./lp_lookup.mjs");
  let worst = 0;
  let worstAt = "";
  for (const s of data.spots) {
    if (typeof s.lp !== "number") continue;
    const got = lpIndex(s.lat, s.lon);
    const diff = Math.abs(got - s.lp);
    if (diff > worst) {
      worst = diff;
      worstAt = `${s.pref} ${s.name} 記録${s.lp} 実測${got}`;
    }
  }
  ok(worst <= 1, "記録した光害の値が、いまのラスタと一致する", `最大差 ${worst}: ${worstAt}`);
}

/* ---- まとめ ---- */
const count = {};
for (const s of data.spots) count[s.verdict] = (count[s.verdict] || 0) + 1;
if (warnings.length) {
  console.log(`\n要確認(落としてはいないが、人が見直すこと) ${warnings.length} 件:`);
  for (const w of warnings) console.log(`  ・${w}`);
}

console.log(
  `\n候補 ${data.spots.length} 件: ` +
    VERDICTS.map((v) => `${v} ${count[v] || 0}`).join(" / ")
);
console.log(`\n${checks - failed} / ${checks} 件通過${failed ? "(失敗あり)" : "(全通過)"}`);
process.exit(failed ? 1 : 0);
