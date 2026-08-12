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
if (!argv.includes("--live")) {
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
