#!/usr/bin/env node
/*
 * 本番のデータベースに入っている掲載スポットで、画面が壊れていないかを見る。
 *
 * verify.mjs との違い:
 *   verify.mjs は決め打ちの5件を差し替えて、作りそのものを確かめる。
 *   入力が決まっているから、点数や並びまで検算できる。
 *   そのぶん「乗鞍畳平が1件だけ出る」といった、差し替えた中身に依存した
 *   判定になっていて、本物のデータでは通らない(通ってはいけない)。
 *
 *   こちらは逆に、中身が何であっても言えることだけを見る:
 *     ・掲載した件数ぶん出るか
 *     ・除外したものが出ていないか
 *     ・全件に「気をつけること」が出ているか
 *     ・詳細ページが開くか
 *     ・JavaScript のエラーと CSP 違反が無いか
 *
 * 読み取りだけ。データベースには何も書かない。
 * 天気は本番のサーバー側キャッシュ(stars_weather_cache)を読む。
 * Open-Meteo を直接叩くことはない(叩くのは日に数回の取り込み側だけ)。
 *
 * 使い方:
 *   node scripts/stars/verify_live.mjs [--expect=30] [--width=390] [--shot-dir 出力先/]
 */
import path from "node:path";
import { loadChromium, serve, launch, relayExternal } from "./harness.mjs";

const chromium = await loadChromium();
const PORT = 8789;

const argv = process.argv.slice(2);
const num = (name, fallback) => {
  const v = Number((argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
const EXPECT = num("expect", 30);
const VIEW_W = num("width", 390);
const shotDirIndex = argv.indexOf("--shot-dir");
const shotDir = shotDirIndex >= 0 ? argv[shotDirIndex + 1] : null;

/* 掲載しないと決めたもの。名前で名指しして、出ていないことを見る */
const MUST_NOT_APPEAR = ["椿山"];

/* 座標を取り直した3件。1桁ずれても画面は正常に見えるので、機械で見る */
const COORDS = [
  ["大山まきばみるくの里", 35.3778565, 133.5107365],
  ["大川山キャンプ場", 34.1148979, 133.9416574],
  ["輝北うわば公園キャンプ場", 31.5936, 130.827]
];

let failed = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
}

let shotNo = 0;
async function capture(page, name) {
  if (!shotDir) return;
  shotNo++;
  const file = path.join(shotDir, `${String(shotNo).padStart(2, "0")}_live-${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  (画面を保存: ${file})`);
}

const server = await serve(PORT);
const browser = await launch(chromium, argv.includes("--headed"));
const page = await browser.newPage({ viewport: { width: VIEW_W, height: 860 } });

// 本物のデータベースと本物の地図タイルを見る(ブラウザは外に出られないので Node 経由)
await relayExternal(page, ["**://tiles.openfreemap.org/**", "**://*.supabase.co/**"]);

const errors = [];
const cspViolations = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  const t = m.text();
  if (/Content Security Policy|Refused to/i.test(t)) cspViolations.push(t);
});

try {
  // ---- 一覧 ----
  console.log(`本番データでの確認 (幅 ${VIEW_W}px / 掲載 ${EXPECT} 件のはず):\n`);
  console.log("一覧ページ:");
  await page.goto(`http://127.0.0.1:${PORT}/stars/list.html`, { waitUntil: "load", timeout: 60000 });
  await page
    .waitForFunction(() => window.StarsList && window.StarsList.state.ready, { timeout: 60000 })
    .catch(() => {});

  const spots = await page.evaluate(() =>
    (window.StarsList.state.spots || []).map((s) => ({
      name: s.name,
      pref: s.pref,
      city: s.city,
      lat: Number(s.lat),
      lon: Number(s.lon),
      caution: (s.caution || "").trim(),
      source: s.source_url || "",
      id: s.spot_id
    }))
  );

  check(`掲載スポットが ${EXPECT} 件読み込まれる`, spots.length === EXPECT, `${spots.length} 件`);

  for (const banned of MUST_NOT_APPEAR) {
    const hit = spots.filter((s) => s.name.includes(banned)).map((s) => s.name);
    check(`「${banned}」を含むスポットが出ていない`, hit.length === 0, hit.join(" / "));
  }

  const noCaution = spots.filter((s) => s.caution === "").map((s) => `${s.pref}${s.name}`);
  check("全件に「気をつけること」が入っている", noCaution.length === 0, noCaution.join(" / "));

  const badSource = spots
    .filter((s) => !s.source.startsWith("https://"))
    .map((s) => `${s.pref}${s.name}: ${s.source || "(無し)"}`);
  check("全件の出典が https", badSource.length === 0, badSource.join(" / "));

  /* 都道府県が47のうち何県ぶんあるか(掲載の広がりの記録。判定はしない) */
  const prefs = new Set(spots.map((s) => s.pref));
  console.log(`  info ${prefs.size} 都道府県ぶん`);

  for (const [name, lat, lon] of COORDS) {
    const s = spots.find((x) => x.name === name);
    check(
      `${name} の座標が候補どおり`,
      !!s && s.lat === lat && s.lon === lon,
      s ? `${s.lat}, ${s.lon}` : "見つからない"
    );
  }

  // 表に出ている行数と、「気をつけること」が出ている行数
  const rowCount = await page.locator("#spot-rows tr").count();
  check(`表に ${EXPECT} 行並ぶ`, rowCount === EXPECT, `${rowCount} 行`);
  const cautionCells = await page.locator("#spot-rows .stars-cell-caution").count();
  check(`表の ${EXPECT} 行すべてに「気をつけること」が出る`, cautionCells === EXPECT, `${cautionCells} 件`);

  /* 画面の幅からはみ出していないか(狭い端末で読めなくなる) */
  const overflow = await page.evaluate(() => {
    const bad = [];
    for (const e of document.querySelectorAll("#spot-rows .stars-cell-caution")) {
      const r = e.getBoundingClientRect();
      if (r.left < 0 || r.right > window.innerWidth + 1 || r.height === 0) {
        bad.push(e.textContent.slice(0, 12));
      }
    }
    return bad;
  });
  check("「気をつけること」が画面の幅に収まる", overflow.length === 0, overflow.join(" / "));
  await capture(page, "list");

  // 地方タブでの絞り込みが、本物の都道府県でも効くか
  await page.getByRole("button", { name: "九州・沖縄" }).click();
  await page.waitForTimeout(300);
  const kyushu = await page.locator("#spot-rows tr").count();
  const kyushuExpect = spots.filter((s) =>
    ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"].includes(s.pref)
  ).length;
  check("地方タブで絞り込める(九州・沖縄)", kyushu === kyushuExpect, `${kyushu} 行 / ${kyushuExpect} 件のはず`);
  await page.getByRole("button", { name: "全国" }).click();
  await page.waitForTimeout(200);

  // ---- 詳細 ----
  // 全件ぶん開く。1件でも開けないページがあれば、そこへ来た人には何も出ない。
  console.log("\nスポット詳細(掲載ぶん全部):");
  const broken = [];
  const noCautionDetail = [];
  for (const s of spots) {
    await page.goto(`http://127.0.0.1:${PORT}/stars/spot.html?id=${encodeURIComponent(s.id)}`, {
      waitUntil: "load",
      timeout: 60000
    });
    await page
      .waitForFunction(() => window.StarsSpot && window.StarsSpot.state.ready, { timeout: 30000 })
      .catch(() => {});
    const shown = await page.locator("#spot-name").textContent();
    if ((shown || "").trim() !== s.name) broken.push(`${s.name} → "${(shown || "").trim()}"`);
    const c = await page.locator("#detail-caution").textContent();
    if (!c || c.trim() === "" || c.trim() === "—" || c.trim() === "特にありません") {
      noCautionDetail.push(s.name);
    }
  }
  check(`${spots.length} 件すべての詳細ページが開く`, broken.length === 0, broken.join(" / "));
  check("詳細ページに「気をつけること」が出る", noCautionDetail.length === 0, noCautionDetail.join(" / "));
  await capture(page, "spot");

  // ---- 地図 ----
  console.log("\n地図ページ:");
  await page.goto(`http://127.0.0.1:${PORT}/stars/`, { waitUntil: "load", timeout: 60000 });
  await page
    .waitForFunction(() => window.StarsApp && (window.StarsApp.state.ready || window.StarsApp.state.error), {
      timeout: 90000
    })
    .catch(() => {});
  const appErr = await page.evaluate(() => (window.StarsApp ? window.StarsApp.state.error : "起動していない"));
  check("地図が読み込める", !appErr, String(appErr || ""));

  /*
   * ピンは地図が動きだしてから足される。
   * 待たずに数えると 0 のこともある(数えた直後に開けるので、
   * 「ピンは無いがカードは出る」というありえない結果になっていた)。
   */
  await page.locator(".stars-pin").first().waitFor({ timeout: 30000 }).catch(() => {});
  const pins = await page.locator(".stars-pin").count();
  /* 3桁目まで同じ地点は1つのピンにまとまるので「以下」で見る */
  check(`ピンが立つ(${pins} 個 / 掲載 ${EXPECT} 件)`, pins > 0 && pins <= EXPECT, `${pins} 個`);
  const pinPositions = await page.locator(".stars-pin").evaluateAll((elements) =>
    [...new Set(elements.map((element) => getComputedStyle(element).position))]
  );
  check(
    "ピンはMapLibreの絶対配置を保つ",
    pinPositions.length === 1 && pinPositions[0] === "absolute",
    pinPositions.join(", ")
  );
  const panelLayout = await page.evaluate(() => {
    const topbar = document.querySelector(".stars-topbar").getBoundingClientRect();
    const legend = document.querySelector(".stars-legend").getBoundingClientRect();
    return {
      overlap: !(
        topbar.right <= legend.left ||
        legend.right <= topbar.left ||
        topbar.bottom <= legend.top ||
        legend.bottom <= topbar.top
      ),
      legendHeight: legend.height
    };
  });
  check("日時パネルと凡例が重ならない", !panelLayout.overlap, JSON.stringify(panelLayout));

  await page.locator(".stars-legend-summary").click();
  const collapsedLegend = await page.locator(".stars-legend").evaluate((legend) => ({
    open: legend.open,
    height: legend.getBoundingClientRect().height
  }));
  check(
    "凡例を折りたたんで地図を確認できる",
    !collapsedLegend.open && collapsedLegend.height < panelLayout.legendHeight,
    JSON.stringify(collapsedLegend)
  );
  await page.locator(".stars-legend-summary").click();

  // 適当な1件を開いて、カードに「気をつけること」が出るか
  const first = spots[0];
  const pin = page.locator(`.stars-pin[aria-label*="${first.name}"]`);
  if ((await pin.count()) > 0) {
    /*
     * 先に地図をその地点へ寄せる。
     * 寄せずに押すと、狭い画面では凡例の下にピンが隠れて押せないことがある
     * (本物の座標なので、どこに出るかは日本地図のどこかで決まる)。
     * flyTo は詳細カードに隠れないよう少し上へずらしてくれる。
     */
    await page.evaluate(([lat, lon]) => window.StarsMap.flyTo(lat, lon), [first.lat, first.lon]);
    await page.waitForTimeout(1200);
    await pin.first().click({ timeout: 15000 });
    await page.waitForTimeout(400);
    const cardName = await page.locator("#spot-name").textContent();
    const cardCaution = await page.locator("#spot-caution").textContent();
    check(
      "地図のカードに「気をつけること」が出る",
      (cardName || "").includes(first.name) && (cardCaution || "").trim().length > 0,
      `${cardName} / ${(cardCaution || "").slice(0, 24)}`
    );
    await capture(page, "map");
  } else {
    check("地図のカードに「気をつけること」が出る", false, `${first.name} のピンが見つからない`);
  }

  // ---- エラー ----
  console.log("\nページのエラー:");
  check("JavaScript のエラーが無い", errors.length === 0, errors.slice(0, 3).join(" / "));
  check("CSP 違反が無い", cspViolations.length === 0, cspViolations.slice(0, 3).join(" / "));
} finally {
  await browser.close();
  server.close();
}

console.log("");
if (failed === 0) {
  console.log("すべて通過");
} else {
  console.log(`${failed} 件失敗`);
  process.exitCode = 1;
}
