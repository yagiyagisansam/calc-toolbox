#!/usr/bin/env node
/*
 * 地名の索引(stars/data/places.json)と、その引き方(stars/places.js)を検査する。
 *
 * なぜ要るか:
 *   独立検証で「富士山と打つと、千葉県と神奈川県の小さな丘だけが出る」
 *   と指摘された。原因は索引を作るときに火山(VLC)を落としていたことで、
 *   日本最高峰が索引に一度も入っていなかった。
 *   画面を見ても「そういうデータなのだろう」としか見えず、
 *   誰かが実際に「富士山」と打つまで誰も気づけない類の壊れ方だった。
 *
 *   期待値は「その地点の実際の標高・所在地」であって、実装の出力ではない。
 *
 * 使い方: node scripts/stars/places.test.mjs
 * ネットワークには出ない。
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");

const Places = require(path.join(ROOT, "stars", "places.js"));
const data = JSON.parse(readFileSync(path.join(ROOT, "stars", "data", "places.json"), "utf8"));
Places.adopt(data);

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

const show = (r) => `${r.name}(${r.pref}・${r.kind})`;

/* ---- 1. 代表的な地点が、代表として先頭に出る ---------------------------- */
{
  /*
   * 期待値の出どころ:
   *   標高・所在地は国土地理院の値として広く知られているもの。
   *   ここで見たいのは「その名前で最初に出るのがどれか」なので、
   *   座標そのものではなく、都道府県と種別と順位で押さえる。
   */
  const cases = [
    { q: "富士山", pref: "山梨県", why: "日本最高峰3776m。千葉・神奈川の丘(167m/288m)ではない" },
    { q: "阿蘇山", pref: "熊本県", why: "一峰の名前である中岳が選ばれていた" },
    { q: "槍ヶ岳", pref: "長野県", why: "GeoNames に漢字名がなく索引から漏れていた" },
    { q: "妙高山", pref: "新潟県", why: "同上" },
    { q: "鳥海山", pref: "山形県", why: "2236m。青森県の同名の山(1486m)ではない" },
    { q: "琵琶湖", pref: "滋賀県", why: "GeoNames に漢字名がなく索引から漏れていた" },
    { q: "阿智村", pref: "長野県", why: "星空で知られる村。市区町村としてそのまま当たること" },
    { q: "河口湖", pref: "山梨県", why: "都道府県が空のままだった" },
    { q: "父島", pref: "東京都", why: "同上(小笠原)" }
  ];

  for (const c of cases) {
    const hits = Places.search(c.q, 5);
    const top = hits[0];
    ok(
      top && top.name === c.q && top.pref === c.pref,
      `「${c.q}」の先頭が ${c.pref} の ${c.q} になる`,
      `${c.why} / 実際: ${hits.slice(0, 3).map(show).join(" , ") || "0件"}`
    );
  }
}

/* ---- 2. 読みでも引ける ---------------------------------------------------- */
{
  for (const [q, want] of [
    ["あちむら", "阿智村"],
    ["アチムラ", "阿智村"]
  ]) {
    const hits = Places.search(q, 5);
    ok(
      hits.some((h) => h.name === want),
      `「${q}」で ${want} が出る`,
      hits.slice(0, 3).map(show).join(" , ") || "0件"
    );
  }
}

/* ---- 2-b. ヶ を含む地名が引ける ------------------------------------------ */
{
  /*
   * カタカナをひらがなへ寄せる処理が ヶ(U+30F6)まで変換していたため、
   * 「八ヶ岳」が「八ゖ岳」になり、索引の側は「ヶ」のままで一致しなかった。
   * 日本の地名では ヶ がよく出るので、まとめて引けなくなっていた。
   */
  for (const q of ["八ヶ岳", "槍ヶ岳", "霧ヶ峰"]) {
    const hits = Places.search(q, 5);
    ok(hits.length > 0, `「${q}」で結果が出る(ヶ を潰していないか)`, `${hits.length} 件`);
  }
  ok(
    Places.normalize("八ヶ岳") === "八ヶ岳",
    "ヶ は変換しない",
    JSON.stringify(Places.normalize("八ヶ岳"))
  );
  ok(
    Places.normalize("ヤツガタケ") === "やつがたけ",
    "カタカナはひらがなに寄せる",
    JSON.stringify(Places.normalize("ヤツガタケ"))
  );
}

/* ---- 3. 前方一致が、完全一致の代表地点を押しのけない -------------------- */
{
  const hits = Places.search("富士山", 8);
  const fuji = hits.findIndex((h) => h.name === "富士山" && h.pref === "山梨県");
  const park = hits.findIndex((h) => h.name.length > 3 && h.name.indexOf("富士山") === 0);
  ok(fuji === 0, "富士山そのものが先頭", `位置 ${fuji}`);
  ok(
    park < 0 || park > fuji,
    "「富士山こどもの国」のような前方一致が富士山より先に来ない",
    `富士山 ${fuji} / 前方一致 ${park}`
  );
}

/* ---- 4. 索引そのものの検査 ------------------------------------------------ */
{
  const blank = data.places.filter((r) => !data.prefs[r[2]]);
  ok(
    blank.length === 0,
    "都道府県が空の地点が無い",
    `${blank.length} 件: ${blank.slice(0, 5).map((r) => r[0]).join(" ")}`
  );

  const prefRows = data.places.filter((r) => data.kinds[r[3]] === "都道府県");
  ok(prefRows.length === 47, "都道府県が47件ある", `${prefRows.length} 件`);

  // 簡体字が混ざっていないこと(以前 東京都 が 东京都 になった)
  const SIMPLIFIED = /[东广岛滨泽县阳长龙华关门马鸟冈乡团园图泷苏达边张岭样业检欢汉济尔观见军单岁归录时]/;
  const bad = data.places.filter((r) => SIMPLIFIED.test(r[0]));
  ok(bad.length === 0, "簡体字の地名が混ざっていない", bad.slice(0, 5).map((r) => r[0]).join(" "));

  // 座標が日本の範囲に収まっていること
  const outside = data.places.filter(
    (r) => !(r[4] > 20 && r[4] < 46 && r[5] > 122 && r[5] < 154)
  );
  ok(
    outside.length === 0,
    "座標が日本の範囲に収まっている",
    outside.slice(0, 5).map((r) => `${r[0]} ${r[4]},${r[5]}`).join(" / ")
  );

  ok(data.license === "CC BY 4.0", "ライセンスが記録されている", String(data.license));
  ok(
    typeof data.licenseUrl === "string" && data.licenseUrl.indexOf("creativecommons.org") >= 0,
    "ライセンスの URL が記録されている",
    String(data.licenseUrl)
  );
}

console.log(`地名: ${data.places.length} 件 / ${data.prefs.length} 都道府県 / ${data.kinds.length} 種別`);
console.log(`\n${checks - failed} / ${checks} 件通過${failed ? "(失敗あり)" : "(全通過)"}`);
process.exit(failed ? 1 : 0);
