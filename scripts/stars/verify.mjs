#!/usr/bin/env node
/*
 * 星見スポットのページをブラウザで開いて動作を確認する開発用スクリプト。
 * 使い方: node scripts/stars/verify.mjs [--headed] [--shot 出力先.png]
 *
 * 確認すること:
 *   - JavaScript のエラーが出ないこと
 *   - CSP 違反が出ないこと(この方針のサイトでは違反=バグ)
 *   - 光害ラスタが読めて、色分けの canvas が実際に塗られていること
 *   - 時刻スライダーを動かすと描き直され、その所要時間が実用的であること
 *
 * 注意: この検証環境では外部のタイルサーバーに繋がらないことがある。
 * タイルが出なくても、色分けと操作が動くことを合格条件にしている。
 */
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = 8788;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

/* 公開時と同じ相対パスで読めるよう、リポジトリのルートをそのまま配信する */
function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        let rel = decodeURIComponent(req.url.split("?")[0]);
        if (rel.endsWith("/")) rel += "index.html";
        const file = path.join(ROOT, rel);
        if (!file.startsWith(ROOT)) {
          res.writeHead(403).end();
          return;
        }
        const info = await stat(file);
        if (info.isDirectory()) {
          res.writeHead(404).end();
          return;
        }
        const body = await readFile(file);
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
        res.end(body);
      } catch (e) {
        res.writeHead(404).end("not found");
      }
    });
    server.listen(PORT, () => resolve(server));
  });
}

const argv = process.argv.slice(2);
const headed = argv.includes("--headed");
const shotIndex = argv.indexOf("--shot");
const shotPath = shotIndex >= 0 ? argv[shotIndex + 1] : null;

let failed = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
}

const server = await serve();

/*
 * この実行環境では外向きの通信がプロキシ経由になっている。ブラウザは
 * HTTPS_PROXY 環境変数を見ないので、起動時に渡してやる必要がある。
 * 検証用サーバー(127.0.0.1)はプロキシを通さない。
 * 通常の開発機ではプロキシ設定が無いので、そのまま直結になる。
 */
/*
 * この検証環境のブラウザは外部へ出られない(タイル配信も天気APIも届かない)。
 * 天気は下の page.route で差し替えるので通信は不要。地図の下地は届かないままだが、
 * 「下地が無くても色分けは動く」ことこそ確かめたい挙動なので、それでよい。
 */
const browser = await chromium.launch({ headless: !headed });
const page = await browser.newPage({ viewport: { width: 430, height: 860 } }); // iPhone に近い縦長

/*
 * 天気予報の応答を差し替える。
 *
 * 外部サービスの状態に左右されず、決まった入力に対して決まった色分けが
 * 出ることを確かめたいので、既定では作り物の予報を返す。
 * --live を付けたときだけ本物の Open-Meteo に問い合わせる。
 *
 * 作り物の中身は「北ほど曇り、南ほど快晴」という分かりやすい傾斜にしてあり、
 * 地図に南北の階調が出れば、格子の補間と色分けが効いていることになる。
 */
/*
 * 掲載スポットの応答も差し替える。
 * 実際のデータベースの中身に左右されず、一覧と詳細が正しく組み立つかを見たいため。
 * 2件だけ返す(暗い山と明るい都心)。
 */
const STUB_SPOTS = [
  {
    spot_id: "11111111-1111-4111-8111-111111111111",
    name: "乗鞍畳平",
    name_kana: "のりくらたたみだいら",
    pref: "岐阜県",
    region: "中部",
    lat: 36.12,
    lon: 137.55,
    elevation_m: 2702,
    access: "夏季はシャトルバスのみ。マイカー規制あり。",
    facilities: "トイレあり",
    note: "国内でも指折りの暗さ。",
    source_url: "https://example.com/norikura"
  },
  {
    spot_id: "22222222-2222-4222-8222-222222222222",
    name: "都心の公園",
    name_kana: null,
    pref: "東京都",
    region: "関東",
    lat: 35.69,
    lon: 139.7,
    elevation_m: 30,
    access: null,
    facilities: null,
    note: null,
    source_url: null
  }
];

if (!argv.includes("--live")) {
  await page.route("**://*.supabase.co/rest/v1/rpc/stars_public_spots", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(STUB_SPOTS)
    });
  });

  await page.route("**://api.open-meteo.com/**", async (route) => {
    const url = new URL(route.request().url());
    const lats = url.searchParams.get("latitude").split(",").map(Number);
    const lons = url.searchParams.get("longitude").split(",").map(Number);
    const vars = url.searchParams.get("hourly").split(",");
    const startMs = Date.parse(url.searchParams.get("start_hour") + ":00Z");
    const endMs = Date.parse(url.searchParams.get("end_hour") + ":00Z");
    const times = [];
    for (let t = startMs; t <= endMs; t += 3600000) times.push(t / 1000);

    const body = lats.map((lat, i) => {
      const hourly = { time: times };
      // 緯度で 0〜100% に変化させる(北 46度=曇り / 南 24度=快晴)
      const cloud = Math.round(((lat - 24) / 22) * 100);
      vars.forEach((v) => {
        const value =
          v === "cloud_cover" ? cloud
            : v === "precipitation_probability" ? Math.round(cloud / 2)
              : v === "visibility" ? 20000
                : v === "relative_humidity_2m" ? 60
                  : 0;
        hourly[v] = times.map(() => value);
      });
      return { latitude: lat, longitude: lons[i], timezone: "GMT", hourly };
    });

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body)
    });
  });
}

const errors = [];
const cspViolations = [];
const failedRequests = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  const t = m.text();
  if (/Content Security Policy|Refused to/i.test(t)) cspViolations.push(t);
});
page.on("requestfailed", (r) => failedRequests.push(r.url().slice(0, 90) + " : " + (r.failure()?.errorText || "")));

try {
  console.log("地図ページ (stars/index.html):");
  await page.goto(`http://127.0.0.1:${PORT}/stars/`, { waitUntil: "load", timeout: 60000 });

  // 天気の取得と最初の描画が終わるまで待つ
  const ready = await page
    .waitForFunction(() => window.StarsApp && (window.StarsApp.state.ready || window.StarsApp.state.error), {
      timeout: 60000
    })
    .then(() => true)
    .catch(() => false);

  const appState = await page.evaluate(() => {
    if (!window.StarsApp) {
      return {
        ready: false,
        error: "StarsApp が読み込まれていません(スクリプトの読み込み失敗)",
        times: 0,
        renderMs: null,
        canvas: null
      };
    }
    return {
      ready: window.StarsApp.state.ready,
      error: window.StarsApp.state.error,
      times: window.StarsApp.state.times.length,
      renderMs: window.StarsApp.state.lastRenderMs,
      canvas:
        window.StarsMap && window.StarsMap.canvas()
          ? { w: window.StarsMap.canvas().width, h: window.StarsMap.canvas().height }
          : null
    };
  });

  check("初期化が完了する", ready && appState.ready, appState.error || "");
  check("今夜の時間帯が取れる", appState.times > 0, `${appState.times} 時点`);
  check("ラスタ用の canvas が作られる", !!appState.canvas, appState.canvas ? `${appState.canvas.w}x${appState.canvas.h}` : "");

  // canvas が実際に塗られているか(全部同じ色ではないこと=色分けが効いていること)
  const painted = await page.evaluate(() => {
    const c = window.StarsMap && window.StarsMap.canvas();
    if (!c) return null;
    const ctx = c.getContext("2d");
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    let opaque = 0;
    for (let i = 0; i < d.length; i += 4 * 997) {
      if (d[i + 3] > 0) opaque++;
      seen.add(`${d[i]},${d[i + 1]},${d[i + 2]}`);
    }
    return { opaque, colors: seen.size };
  });
  check("canvas が塗られている", painted && painted.opaque > 0, painted ? `${painted.opaque} 標本` : "");
  check("複数の段階が描き分けられている", painted && painted.colors >= 2, painted ? `${painted.colors} 色` : "");

  check("描画時間が実用的", appState.renderMs !== null && appState.renderMs < 400, `${Math.round(appState.renderMs)} ms`);

  /*
   * 緯度経度を指定して、そこに塗られた段階が期待どおりかを見る。
   * 光害ラスタは緯度が等間隔、地図はメルカトルなので、変換を1か所でも
   * 間違えると南北がずれる。見た目では気づきにくいのでここで押さえる。
   * 差し替えた予報は「北ほど曇り・南ほど快晴」なので、北端は最低・南端は最高になる。
   */
  if (!argv.includes("--live")) {
    const bandsAt = await page.evaluate(() => {
      const c = window.StarsMap.canvas();
      const ctx = c.getContext("2d");
      const b = window.StarsLP.raw().meta.bbox;
      const RAD = Math.PI / 180;
      const mercY = (la) => Math.log(Math.tan(Math.PI / 4 + (la * RAD) / 2));
      const yTop = mercY(b.north);
      const yBot = mercY(b.south);
      const rgbs = window.StarsPalette.BAND_RGB.map((v) => v.join(","));
      const at = (lat, lon) => {
        const x = Math.min(Math.round(((lon - b.west) / (b.east - b.west)) * c.width), c.width - 1);
        const y = Math.min(Math.round(((mercY(lat) - yTop) / (yBot - yTop)) * c.height), c.height - 1);
        const d = ctx.getImageData(x, y, 1, 1).data;
        const i = rgbs.indexOf(`${d[0]},${d[1]},${d[2]}`);
        return i < 0 ? null : window.StarsScore.BANDS[i].key;
      };
      return {
        wakkanai: at(45.4, 141.7), // 北端(作り物の予報では曇り100%)
        ishigaki: at(24.4, 124.2), // 南端(快晴)
        tokyo: at(35.7, 139.8) // 光害が最も強い場所
      };
    });
    check("北端は最低の段階になる", bandsAt.wakkanai === "none", String(bandsAt.wakkanai));
    check("南端(快晴・暗所)は最高の段階になる", bandsAt.ishigaki === "excellent", String(bandsAt.ishigaki));
    check("都心は低い段階になる", ["none", "bad"].includes(bandsAt.tokyo), String(bandsAt.tokyo));
  }

  // 凡例
  const legendRows = await page.locator(".legend-row").count();
  check("凡例が6段階ぶん出る", legendRows === 6, `${legendRows} 行`);

  // 時刻スライダーを動かすと描き直される
  const slider = page.locator("#time-slider");
  const maxIndex = Number(await slider.getAttribute("max"));
  if (maxIndex > 0) {
    const before = await page.locator("#time-label").textContent();
    await slider.fill(String(Math.min(3, maxIndex)));
    await page.waitForTimeout(400);
    const after = await page.locator("#time-label").textContent();
    const renderMs = await page.evaluate(() => (window.StarsApp ? window.StarsApp.state.lastRenderMs : null));
    check("時刻を変えると表示が変わる", before !== after, `${before} → ${after}`);
    check("描き直しも実用的な速さ", renderMs < 400, `${Math.round(renderMs)} ms`);
  }

  // 月の表示
  const moon = await page.locator("#moon-label").textContent();
  check("月の情報が出る", /月齢/.test(moon), moon);

  // 夜の時間帯の表示
  const night = await page.locator("#night-range").textContent();
  check("今夜の時間帯が表示される", /の夜/.test(night), night);

  if (shotPath) {
    await page.screenshot({ path: shotPath, fullPage: false });
    console.log(`\nスクリーンショット: ${shotPath}`);
  }

  // ---- 申請ページ ----
  console.log("\n申請ページ (stars/submit.html):");
  await page.goto(`http://127.0.0.1:${PORT}/stars/submit.html`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.StarsSubmit, { timeout: 30000 }).catch(() => {});

  const prefCount = await page.locator("#f-pref option").count();
  check("都道府県が47件そろう", prefCount === 48, `${prefCount - 1} 件(先頭の案内を除く)`);

  const groupCount = await page.locator("#f-pref optgroup").count();
  check("地方ごとにまとまっている", groupCount === 8, `${groupCount} 区分`);

  // 未入力のまま送ると、何が足りないか教えてくれる
  await page.locator("#submit-button").click();
  await page.waitForTimeout(200);
  const emptyMsg = await page.locator("#submit-message").textContent();
  check("場所未選択のまま送ると案内が出る", /場所を選/.test(emptyMsg), emptyMsg);

  // 地図をタップした代わりに、地点を直接指定する
  await page.evaluate(() => window.StarsSubmit.pick(36.12, 137.55)); // 乗鞍畳平
  await page.waitForTimeout(300);
  const readout = await page.locator("#pick-readout").textContent();
  check("選んだ地点の座標が出る", /36\.12/.test(readout), readout);

  const darkness = await page.locator("#pick-darkness").textContent();
  check("選んだ地点の暗さの目安が出る", /空の暗さ/.test(darkness), darkness);

  // 範囲外は受け付けない
  await page.evaluate(() => window.StarsSubmit.pick(48.9, 2.35)); // パリ
  await page.waitForTimeout(200);
  const outMsg = await page.locator("#submit-message").textContent();
  check("日本の範囲外は断る", /日本国内/.test(outMsg), outMsg);

  // 名前が無いまま送ると教えてくれる
  await page.evaluate(() => window.StarsSubmit.pick(36.12, 137.55));
  await page.locator("#submit-button").click();
  await page.waitForTimeout(200);
  const nameMsg = await page.locator("#submit-message").textContent();
  check("スポット名が無いと案内が出る", /スポット名/.test(nameMsg), nameMsg);

  // URL の形式
  await page.locator("#f-name").fill("乗鞍畳平");
  await page.locator("#f-pref").selectOption("岐阜県");
  await page.locator("#f-url").fill("http://example.com");
  await page.locator("#submit-button").click();
  await page.waitForTimeout(200);
  const urlMsg = await page.locator("#submit-message").textContent();
  check("http:// のURLは断る", /https/.test(urlMsg), urlMsg);

  // ---- 一覧ページ ----
  console.log("\n一覧ページ (stars/list.html):");
  await page.goto(`http://127.0.0.1:${PORT}/stars/list.html`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.StarsList && window.StarsList.state.ready, { timeout: 30000 })
    .catch(() => {});

  const tabCount = await page.locator(".stars-tab").count();
  check("地方タブが9個(全国+8地方)", tabCount === 9, `${tabCount} 個`);

  const listNight = await page.locator("#night-range").textContent();
  check("今夜の時間帯が出る", /の夜の予報/.test(listNight), listNight);

  const rowCount = await page.locator("#spot-rows tr").count();
  check("スポットが表に並ぶ", rowCount === 2, `${rowCount} 行`);

  // 差し替えた予報では南ほど快晴。乗鞍(暗い山)が都心より上に来るはず
  const firstRow = await page.locator("#spot-rows tr").first().textContent();
  check("星見レベル順で暗い場所が上に来る", /乗鞍/.test(firstRow), firstRow.slice(0, 40));

  // 地方タブでの絞り込み
  await page.getByRole("button", { name: "関東" }).click();
  await page.waitForTimeout(200);
  const kantoRows = await page.locator("#spot-rows tr").count();
  const kantoText = await page.locator("#spot-rows").textContent();
  check("地方タブで絞り込める", kantoRows === 1 && /都心/.test(kantoText), `${kantoRows} 行`);

  // 掲載の無い地方は、その旨を出す
  await page.getByRole("button", { name: "四国" }).click();
  await page.waitForTimeout(200);
  const shikoku = await page.locator("#status").textContent();
  check("掲載の無い地方は案内を出す", /四国/.test(shikoku), shikoku);

  // 並べ替え
  await page.getByRole("button", { name: "全国" }).click();
  await page.locator("#sort-select").selectOption("name");
  await page.waitForTimeout(200);
  const byName = await page.locator("#spot-rows tr").first().textContent();
  check("名前順に並べ替えできる", /乗鞍|都心/.test(byName), byName.slice(0, 20));

  // ---- スポット詳細 ----
  console.log("\nスポット詳細 (stars/spot.html):");
  await page.goto(`http://127.0.0.1:${PORT}/stars/spot.html`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(400);
  const noId = await page.locator("#status").textContent();
  check("id が無いときは案内を出す", /指定されて/.test(noId), noId);

  await page.goto(
    `http://127.0.0.1:${PORT}/stars/spot.html?id=${STUB_SPOTS[0].spot_id}`,
    { waitUntil: "load", timeout: 60000 }
  );
  await page.waitForFunction(() => window.StarsSpot && window.StarsSpot.state.ready, { timeout: 30000 })
    .catch(() => {});

  const spotName = await page.locator("#spot-name").textContent();
  check("スポット名が出る", spotName === "乗鞍畳平", spotName);

  const hourRows = await page.locator("#hourly-rows tr").count();
  check("時間別予報が並ぶ", hourRows > 0, `${hourRows} 時点`);

  const bestRows = await page.locator("#hourly-rows tr.is-best").count();
  check("ベスト時刻がちょうど1つ示される", bestRows === 1, `${bestRows} 行`);

  const factMoon = await page.locator("#fact-moon").textContent();
  check("月の情報が出る", /月齢/.test(factMoon), factMoon);

  const detailAccess = await page.locator("#detail-access").textContent();
  check("アクセス情報が出る", /シャトルバス/.test(detailAccess), detailAccess.slice(0, 30));

  // 未登録の項目は「登録なし」と出す(空欄のままにしない)
  await page.goto(
    `http://127.0.0.1:${PORT}/stars/spot.html?id=${STUB_SPOTS[1].spot_id}`,
    { waitUntil: "load", timeout: 60000 }
  );
  await page.waitForFunction(() => window.StarsSpot && window.StarsSpot.state.ready, { timeout: 30000 })
    .catch(() => {});
  const emptyAccess = await page.locator("#detail-access").textContent();
  check("未登録の項目は登録なしと出る", emptyAccess === "登録なし", emptyAccess);

  // 存在しない id
  await page.goto(`http://127.0.0.1:${PORT}/stars/spot.html?id=deadbeef`, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(600);
  const missing = await page.locator("#status").textContent();
  check("見つからない id は案内を出す", /見つかりません/.test(missing), missing);

  // ---- 説明ページ ----
  console.log("\n説明ページ (stars/about.html):");
  await page.goto(`http://127.0.0.1:${PORT}/stars/about.html`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll("#ref-rows tr").length > 0, { timeout: 20000 })
    .catch(() => {});

  const bandRows = await page.locator(".stars-band-row").count();
  check("段階の説明が6段ぶん出る", bandRows === 6, `${bandRows} 行`);

  const refRows = await page.locator("#ref-rows tr").count();
  check("校正に使った地点が表になる", refRows >= 5, `${refRows} 件`);

  const lpMeta = await page.locator("#lp-meta").textContent();
  check("光害データの作成情報が出る", /現在のデータ/.test(lpMeta), lpMeta.slice(0, 80));

  // 説明の数値が実データと一致していること(説明だけ古くなるのを防ぐ)
  const refMatches = await page.evaluate(async () => {
    const meta = await (await fetch("./data/lp-japan.json")).json();
    const rows = [...document.querySelectorAll("#ref-rows tr")];
    return rows.every((tr, i) => {
      const cells = tr.querySelectorAll("td");
      return (
        tr.querySelector("th").textContent === meta.references[i].name &&
        cells[0].textContent === String(meta.references[i].value)
      );
    });
  });
  check("表の値が実データと一致する", refMatches === true, String(refMatches));

  console.log("\nページのエラー:");
  check("JavaScript のエラーが無い", errors.length === 0, errors.slice(0, 3).join(" / "));
  check("CSP 違反が無い", cspViolations.length === 0, cspViolations.slice(0, 3).join(" / "));

  // 外部への接続失敗は、この環境では起こりうるので落とさず出すだけにする
  const external = failedRequests.filter((u) => !u.includes("127.0.0.1"));
  const internal = failedRequests.filter((u) => u.includes("127.0.0.1"));
  check("自サイト内の読み込みがすべて成功", internal.length === 0, internal.slice(0, 3).join(" / "));
  if (external.length) {
    console.log(`  info 外部への接続が ${external.length} 件失敗(この検証環境では起こりうる)`);
    external.slice(0, 3).forEach((u) => console.log("       " + u));
  }
} finally {
  await browser.close();
  server.close();
}

console.log(failed === 0 ? "\nすべて通過" : `\n${failed} 件失敗`);
process.exit(failed === 0 ? 0 : 1);
