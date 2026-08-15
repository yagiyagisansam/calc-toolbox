#!/usr/bin/env node
/*
 * 星見スポットのページをブラウザで開いて動作を確認する開発用スクリプト。
 * 使い方: node scripts/stars/verify.mjs [--headed] [--shot 出力先.png]
 *          node scripts/stars/verify.mjs --relay --shot-dir 出力先/
 *            → 地図タイルと天気を Node 経由で中継し、本番と同じ絵を各ページぶん保存する
 *
 * 確認すること:
 *   - JavaScript のエラーが出ないこと
 *   - CSP 違反が出ないこと(この方針のサイトでは違反=バグ)
 *   - 光害ラスタが読めて、色分けの canvas が実際に塗られていること
 *   - 時刻スライダーを動かすと描き直され、その所要時間が実用的であること
 *
 * 注意: この検証環境では外部のタイルサーバーに繋がらないことがある。
 * タイルが出なくても、色分けと操作が動くことを合格条件にしている。
 *
 * Playwright の入れ方は scripts/stars/README.md を参照。
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

/*
 * Playwright を見つける。
 *
 * 以前はこの環境の絶対パス(/opt/node22/lib/node_modules/playwright/index.mjs)を
 * 直接書いていた。手元では動くが、他の誰かが新規に checkout しても動かない。
 * Windows では動きようがない。検証スクリプトが特定の1台でしか走らないのでは
 * 「検証してある」と言えないので、普通の解決に直した。
 *
 * 順番:
 *   1. ふつうに import する(リポジトリ内の node_modules、または npm link 済み)
 *   2. グローバルに入っている場所を npm に聞く(-g で入れた場合)
 * どちらも駄目なら、入れ方を示して終わる。
 */
async function loadChromium() {
  try {
    return (await import("playwright")).chromium;
  } catch (e) {
    /* 次を試す */
  }

  try {
    const root = execFileSync("npm", ["root", "-g"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      shell: process.platform === "win32" // Windows の npm は npm.cmd
    }).trim();
    if (root) {
      // パスに空白や日本語が入っていても壊れないよう、必ず file:// URL に直す
      const entry = pathToFileURL(path.join(root, "playwright", "index.mjs")).href;
      return (await import(entry)).chromium;
    }
  } catch (e) {
    /* 下の案内へ */
  }

  console.error(
    [
      "Playwright が見つかりません。次のどちらかで入れてください。",
      "",
      "  リポジトリの中に入れる場合:",
      "    npm install --no-save playwright",
      "    npx playwright install chromium",
      "",
      "  端末全体に入れる場合:",
      "    npm install -g playwright",
      "    npx playwright install chromium",
      "",
      "詳しくは scripts/stars/README.md を参照してください。"
    ].join("\n")
  );
  process.exit(2);
}

const chromium = await loadChromium();

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
const shotDirIndex = argv.indexOf("--shot-dir");
const shotDir = shotDirIndex >= 0 ? argv[shotDirIndex + 1] : null;

/* 各ページの見た目を保存する(--shot-dir を付けたときだけ) */
let shotNo = 0;
async function capture(name) {
  if (!shotDir) return;
  shotNo++;
  const file = path.join(shotDir, `${String(shotNo).padStart(2, "0")}_${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  (画面を保存: ${file})`);
}

let failed = 0;
function check(name, ok, detail) {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
}

const server = await serve();

/*
 * この検証環境のブラウザは外部へ出られない(タイル配信も天気APIも届かない)。
 * 天気とスポットは下の page.route で差し替えるので通信は不要。
 * 地図の下地は届かないままだが、「下地が無くても色分けは動く」ことこそ
 * 確かめたい挙動なので、それでよい。
 */
let browser;
try {
  browser = await chromium.launch({ headless: !headed });
} catch (err) {
  /*
   * Playwright は入っているが、対応するブラウザの実体が無い。
   * 素の例外だと何をすればよいか分からないので、手順を示して止める。
   * (Playwright を入れ直すと、対応するブラウザの版も変わる。
   *  すでに別の場所にブラウザがあるなら PLAYWRIGHT_BROWSERS_PATH で指せる。)
   */
  console.error(
    [
      "ブラウザを起動できませんでした。",
      "",
      String(err && err.message ? err.message : err).split("\n")[0],
      "",
      "次で入れてください:",
      "  npx playwright install chromium",
      "",
      "別の場所に入れてある場合は PLAYWRIGHT_BROWSERS_PATH で指定できます。",
      "詳しくは scripts/stars/README.md を参照してください。"
    ].join("\n")
  );
  process.exit(2);
}
/*
 * 画面の幅。既定は iPhone に近い縦長(Hiroさんの主環境がそれなので)。
 * --width で変えられる。狭い端末・タブレット・机上の3つで通しておくと、
 * 選択欄が縦積みになる・並びが折り返す、といった崩れに気づける。
 */
const widthArg = Number((argv.find((a) => a.startsWith("--width=")) || "").split("=")[1]);
const VIEW_W = Number.isFinite(widthArg) && widthArg > 0 ? widthArg : 430;
const page = await browser.newPage({ viewport: { width: VIEW_W, height: 860 } });

/*
 * 外部からの応答を差し替える。
 *
 * 外部サービスの状態や、データベースの実際の中身に左右されず、
 * 決まった入力に対して決まった結果が出ることを確かめたい。
 * --live を付けたときだけ本物に問い合わせる。
 *
 * 天気は「北ほど曇り、南ほど快晴」という分かりやすい傾斜にしてあり、
 * 地図に南北の階調が出れば、格子の補間と色分けが効いていることになる。
 * スポットは3件(暗い山・危険なURL・明るい都心)。
 */
const STUB_SPOTS = [
  {
    spot_id: "11111111-1111-4111-8111-111111111111",
    name: "乗鞍畳平",
    city: "高山市",
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
    // 表示側が危険なURLをリンクにしないことを確かめるための1件。
    // データベース側のトリガは https:// しか通さないが、表示側でも守れているか見る。
    spot_id: "33333333-3333-4333-8333-333333333333",
    name: "危険なURLの検査用",
    city: "佐久市",
    name_kana: null,
    pref: "長野県",
    region: "中部",
    lat: 36.2,
    lon: 138.0,
    elevation_m: null,
    access: null,
    facilities: null,
    note: null,
    source_url: "javascript:alert(1)"
  },
  {
    spot_id: "22222222-2222-4222-8222-222222222222",
    name: "都心の公園",
    city: "千代田区",
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
  },
  /*
   * 南北に離れた2件。日付の変わり目に「今夜」がどの日かは地点ごとに変わるので、
   * 一覧と詳細が同じ夜を見ているかは、離れた地点でこそ確かめる必要がある
   * (8月15日 4時の時点で、稚内は既に15日の夜・石垣島はまだ14日の夜)。
   */
  {
    spot_id: "44444444-4444-4444-8444-444444444444",
    name: "稚内の丘",
    city: "稚内市",
    name_kana: "わっかないのおか",
    pref: "北海道",
    region: "北海道",
    lat: 45.42,
    lon: 141.67,
    elevation_m: 80,
    access: null,
    facilities: null,
    note: null,
    source_url: null
  },
  {
    spot_id: "55555555-5555-4555-8555-555555555555",
    name: "石垣島の浜",
    city: "石垣市",
    name_kana: "いしがきじまのはま",
    pref: "沖縄県",
    region: "九州・沖縄",
    lat: 24.34,
    lon: 124.16,
    elevation_m: 5,
    access: null,
    facilities: null,
    note: null,
    source_url: null
  }
];

/*
 * --relay: 本番と同じ絵を撮るためのモード。
 *
 * この環境ではブラウザが外に出られないが、Node は出られる。そこで外部への
 * 問い合わせだけ Node の fetch で取ってきてブラウザに返す。
 * 公開前に実際の見た目を確認したいときに使う。
 *
 * --live と併せると、天気は本物のサーバー側キャッシュ(stars_weather_cache)、
 * 掲載スポットも本物のデータベースの中身になる。
 * --relay だけなら地図タイルだけ本物で、天気とスポットは下の差し替えを使う。
 */
const relay = argv.includes("--relay");
if (relay) {
  const patterns = ["**://tiles.openfreemap.org/**"];
  if (argv.includes("--live")) patterns.push("**://*.supabase.co/**");
  for (const pattern of patterns) {
    await page.route(pattern, async (route) => {
      const req = route.request();
      try {
        // apikey などの認証ヘッダをそのまま渡す(Supabase はこれが無いと弾く)
        const headers = { ...req.headers() };
        delete headers.host;
        delete headers["content-length"];
        const res = await fetch(req.url(), {
          method: req.method(),
          headers,
          body: req.postData() ?? undefined
        });
        const body = Buffer.from(await res.arrayBuffer());
        await route.fulfill({
          status: res.status,
          contentType: res.headers.get("content-type") || "application/octet-stream",
          body
        });
      } catch (e) {
        await route.abort();
      }
    });
  }
}

/*
 * --stub-spots: 掲載スポットだけ差し替える。
 * 公開前の見た目確認で「本物の天気 × 中身のある一覧」を見たいときに使う
 * (データベースにまだ承認済みのスポットが無くても、一覧と詳細の絵が撮れる)。
 */
if (!argv.includes("--live") || argv.includes("--stub-spots")) {
  await page.route("**://*.supabase.co/rest/v1/rpc/stars_public_spots", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(STUB_SPOTS)
    });
  });
}

if (!argv.includes("--live")) {
  /*
   * 天気はサーバー側のキャッシュ(stars_weather_cache)から読むようになったので、
   * その1行を差し替える。中身は「北ほど曇り、南ほど快晴」という分かりやすい傾斜。
   * 地図に南北の階調が出れば、格子の補間と色分けが効いていることになる。
   */
  await page.route("**://*.supabase.co/rest/v1/stars_weather_cache**", async (route) => {
    // 本番の stars_grid_def() と同じ値にしておく(日付の切り替えまで検証するため)
    const meta = { south: 24, north: 46, west: 123, east: 146, step: 1, hours: 78, parts: 6 };
    const rows = (meta.north - meta.south) / meta.step + 1;
    const cols = (meta.east - meta.west) / meta.step + 1;

    // いまの時刻を丸めた点から meta.hours ぶん
    const base = Math.floor(Date.now() / 3600000) * 3600;
    const times = [];
    for (let h = 0; h < meta.hours; h++) times.push(base + h * 3600);

    const cloud = [];
    const precip = [];
    const visibility = [];
    const humidity = [];
    for (let r = 0; r < rows; r++) {
      const lat = meta.north - r * meta.step;
      const c = Math.round(((lat - meta.south) / (meta.north - meta.south)) * 100);
      for (let k = 0; k < cols; k++) {
        cloud.push(times.map(() => c));
        precip.push(times.map(() => Math.round(c / 2)));
        visibility.push(times.map(() => 20000));
        humidity.push(times.map(() => 60));
      }
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        {
          payload: { times, cloud, precip, visibility, humidity },
          meta: { ...meta, points: rows * cols },
          updated_at: new Date(base * 1000).toISOString()
        }
      ])
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
  // 中継モードや --live では本物の天気になるため、作り物の傾斜を前提にした検算は飛ばす
  if (!relay && !argv.includes("--live")) {
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

  /*
   * 絵を保存する前に下地のタイルが出そろうのを待つ。
   * 中継モードは1タイルずつ Node を経由するので遅く、待たずに撮ると
   * 「海が塗り分けられていない」ように見える絵になってしまう(実際は読み込み中)。
   */
  if (shotDir) {
    await page
      .waitForFunction(() => {
        const m = window.StarsMap && window.StarsMap.map();
        return !!m && m.areTilesLoaded();
      }, { timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(600);
  }
  await capture("map");

  // 凡例
  const legendRows = await page.locator(".legend-row").count();
  check("凡例が6段階ぶん出る", legendRows === 6, `${legendRows} 行`);

  /*
   * 現在地ボタンが、凡例などの重なる部品に隠されていないこと。
   * 地図の操作ボタンは右下に積まれるので、凡例を画面の右端まで広げると
   * 上に覆いかぶさって押せなくなる。目で見ても気づきにくい壊れ方なので、
   * その座標にいる最前面の要素を実際に調べる。
   */
  const geoHit = await page.evaluate(() => {
    const b = document.querySelector(".maplibregl-ctrl-geolocate");
    if (!b) return { found: false };
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { found: true, covered: !b.contains(top) && top !== b };
  });
  check("現在地ボタンが他の部品に隠れていない", geoHit.found && !geoHit.covered, geoHit.found ? "" : "ボタンが無い");

  /*
   * 表示する項目の切り替え(総合・空の暗さ・天気)。
   *
   * 見るべきは「切り替えると絵が変わること」だけではない。
   * ・空の暗さ … 天気を含まないので、作り物の南北の傾斜が消えて
   *              稚内(曇り100%)でも都心より良くなるはず
   * ・天気     … 光害を含まないので、都心と奥多摩が同じ段階になるはず
   * ここを間違えると「切り替わっているように見えて中身は総合のまま」に気づけない。
   */
  const layerTabCount = await page.locator(".stars-layer-tab").count();
  check("表示する項目のタブが3つ出る", layerTabCount === 3, `${layerTabCount} 個`);
  const layerTabOn = await page.locator(".stars-layer-tab.is-on").textContent();
  check("既定は総合", layerTabOn === "総合", String(layerTabOn));

  const sampleBands = () =>
    page.evaluate(() => {
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
        return rgbs.indexOf(`${d[0]},${d[1]},${d[2]}`); // 0が最良・5が最悪
      };
      return { wakkanai: at(45.4, 141.7), tokyo: at(35.7, 139.8), okutama: at(35.83, 139.0) };
    });

  const totalBands = await sampleBands();

  await page.getByRole("button", { name: "空の暗さ" }).click();
  await page.waitForTimeout(400);
  const skyBands = await sampleBands();
  await capture("map-sky");
  check(
    "空の暗さでは天気の影響が消える",
    skyBands.wakkanai < totalBands.wakkanai && skyBands.wakkanai < skyBands.tokyo,
    `稚内 総合${totalBands.wakkanai}→暗さ${skyBands.wakkanai} / 都心${skyBands.tokyo}`
  );

  await page.getByRole("button", { name: "天気" }).click();
  await page.waitForTimeout(400);
  const weatherBands = await sampleBands();
  await capture("map-weather");
  /*
   * 総合は「天気 × 光害」なので、光害を外した天気だけの段階が総合より
   * 悪くなることはない。そして都心と奥多摩は同じ天気の格子なので、
   * 光害を外せば段階がほぼ揃う(総合では光害の差で大きく開く)。
   * 本物の天気では偶然の一致に頼れないので、開きが縮むことで見る。
   */
  const gapTotal = Math.abs(totalBands.tokyo - totalBands.okutama);
  const gapWeather = Math.abs(weatherBands.tokyo - weatherBands.okutama);
  check(
    "天気では光害の影響が消える",
    weatherBands.tokyo <= totalBands.tokyo && gapWeather <= gapTotal && gapWeather <= 1,
    `都心${weatherBands.tokyo} / 奥多摩${weatherBands.okutama}(総合は ${totalBands.tokyo} と ${totalBands.okutama})`
  );

  const note = await page.locator("#layer-note").textContent();
  check("項目の説明が入れ替わる", /雲量/.test(note), note.slice(0, 24));

  await page.getByRole("button", { name: "総合" }).click();
  await page.waitForTimeout(400);

  /*
   * 月の減点が地点ごとに掛かるか。
   *
   * 以前は地図の中心1点で求めた係数を全画素へ掛けていた。日本の南北で
   * 月の高度は20度以上違うので、これは沖縄の点数を2割ほど過大にし、
   * 北海道には無いはずの減点を付けていた。さらに、地図を動かすだけで
   * 同じ場所の点数が変わるという、閲覧者に説明のつかない振る舞いになる。
   *
   * ここでは3つを見る:
   *   1. 地図が使う係数が、その地点で直に計算した値と一致すること
   *   2. 同じ時刻で、南北の係数が別々に出ていること
   *   3. 地図を動かしてから描き直しても、同じ地点の係数が変わらないこと
   *
   * 差し替えた予報の日付によっては新月に近く、南北の開きが小さいことがある。
   * だから「◯以上ひらく」では見ない。地点ごとに計算しているかどうかだけを見る。
   */
  const moonSpread = await page.evaluate(() => {
    const times = window.StarsApp.state.grid.times;
    const direct = (k, lat, lon) =>
      window.StarsScore.moonFactor(
        window.StarsSky.brightness(new Date(times[k] * 1000), lat, lon)
      );

    // 月が全国で地平線の下の時刻もあるので、78時間ぶんの中で差が最大の時刻を探す
    let best = { spread: -1, index: 0, north: 1, south: 1 };
    for (let k = 0; k < times.length; k++) {
      const north = window.StarsMap.moonFactorAt(k, 45.4, 141.7);
      const south = window.StarsMap.moonFactorAt(k, 24.3, 124.2);
      const spread = Math.abs(north - south);
      if (spread > best.spread) best = { spread: spread, index: k, north: north, south: south };
    }

    // 格子は1度刻みなので、補間した値と直の値の差はごく小さいはず
    let worst = 0;
    for (const [lat, lon] of [[45.4, 141.7], [35.7, 139.8], [24.3, 124.2], [33.2, 130.8]]) {
      const d = Math.abs(window.StarsMap.moonFactorAt(best.index, lat, lon) - direct(best.index, lat, lon));
      if (d > worst) worst = d;
    }
    return { best: best, worstVsDirect: worst };
  });
  check(
    "地図の月の減点が、その地点で直に計算した値と一致する",
    moonSpread.worstVsDirect < 0.01,
    `最大の差 ${moonSpread.worstVsDirect.toFixed(4)}`
  );
  check(
    "月の減点が南北で別々に掛かる",
    moonSpread.best.north !== moonSpread.best.south,
    `最大の開き ${moonSpread.best.spread.toFixed(4)}(稚内 ${moonSpread.best.north.toFixed(4)} / 石垣 ${moonSpread.best.south.toFixed(4)})`
  );

  const moonAfterPan = await page.evaluate(async () => {
    const k = window.StarsApp.state.timeIndex || 0;
    const before = window.StarsMap.moonFactorAt(k, 24.3, 124.2);
    const map = window.StarsMap.map();
    map.jumpTo({ center: [141.7, 45.4] }); // 石垣島から遠く離れた稚内へ寄せる
    window.StarsMap.render(k); // 動かしたあとに描き直す
    const after = window.StarsMap.moonFactorAt(k, 24.3, 124.2);
    map.jumpTo({ center: [138, 36] });
    return { before: before, after: after };
  });
  check(
    "地図を動かしても同じ地点の月の減点が変わらない",
    moonAfterPan.before === moonAfterPan.after,
    `${moonAfterPan.before} → ${moonAfterPan.after}`
  );

  /*
   * どの夜を見るか(今夜・明日・明後日)。
   * キャッシュは78時間ぶん持っているので、切り替えても通信は起きず、
   * 切り出す時刻の範囲だけが変わる。見出しの日付が1日進むことで確かめる。
   */
  const dayTabs = await page.locator(".stars-day-tab").count();
  check("夜を選ぶタブが3つ出る", dayTabs === 3, `${dayTabs} 個`);
  const nightBefore = await page.locator("#night-range").textContent();
  await page.getByRole("button", { name: "明日" }).click();
  await page.waitForTimeout(700);
  const nightAfter = await page.locator("#night-range").textContent();
  const dayOffset = await page.evaluate(() => window.StarsApp.state.dayOffset);
  check(
    "明日を選ぶと対象の夜が1日進む",
    dayOffset === 1 && nightBefore !== nightAfter,
    `${(nightBefore || "").slice(0, 12)} → ${(nightAfter || "").slice(0, 12)}`
  );
  await page.getByRole("button", { name: "今夜" }).click();
  await page.waitForTimeout(700);

  /*
   * 画面の状態がURLに残り、そのURLで開き直すと同じ画面になること。
   * 「この夜のこの時刻のこの場所」を人に送れないと、せっかく見つけた条件を
   * 共有できない。再読み込みで初期表示に戻ってしまうのも同じ問題。
   */
  await page.getByRole("button", { name: "空の暗さ" }).click();
  // 予報の時間数は日によって変わる(更新が滞れば数時間しか無い)ので、端に寄せる
  const sliderMax = Number(await page.locator("#time-slider").getAttribute("max"));
  const wantTime = Math.min(2, Math.max(0, sliderMax));
  await page.locator("#time-slider").fill(String(wantTime));
  await page.waitForTimeout(500);
  const shared = page.url();
  check(
    "画面の状態がURLに残る",
    /#.*d=0/.test(shared) && /layer=sky/.test(shared) && shared.includes("t=" + wantTime),
    shared.slice(shared.indexOf("#"))
  );

  await page.goto(shared, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.StarsApp && window.StarsApp.state.ready, { timeout: 60000 });
  const restored = await page.evaluate(() => ({
    t: window.StarsApp.state.timeIndex,
    layer: window.StarsMap.layer()
  }));
  check(
    "URLを開き直すと同じ画面に戻る",
    restored.t === wantTime && restored.layer === "sky",
    `時刻${restored.t} / ${restored.layer}`
  );

  await page.getByRole("button", { name: "総合" }).click();
  await page.waitForTimeout(400);

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
  check("月の情報が出る", /光っている/.test(moon), moon);

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

  /*
   * 地図も枠(pick.html)の中で動くこと。
   * MapLibre をこの画面に置くと Trusted Types を強制できない。
   * 申請フォームは利用者の入力をそのまま扱う画面なので、そこは落とせない。
   */
  {
    const hasFrame = await page
      .frameLocator("#pick-map iframe")
      .locator("#pick-map canvas")
      .first()
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    check("申請の地図が枠の中で出る", hasFrame, String(hasFrame));

    const tt = await page.evaluate(() => {
      try {
        document.createElement("div").innerHTML = "<b>試し</b>";
        return false;
      } catch (e) {
        return true;
      }
    });
    check("申請でも Trusted Types が効いている", tt, tt ? "" : "止まらずに書けてしまった");

    const leaked = await page.evaluate(() => typeof window.maplibregl !== "undefined");
    check("地図が申請の文書に入り込んでいない", !leaked, `maplibregl=${leaked}`);

    // こちらで決めた場所に、枠の中の印が合っていること
    const inner = page.frames().find((f) => f.url().includes("pick.html"));
    const markAt = await inner.evaluate(() => {
      const m = window.StarsPick.marker();
      if (!m || !m._map) return null;
      const p = m.getLngLat();
      return { lat: p.lat, lon: p.lng };
    });
    check(
      "枠の中の印がこちらの選んだ場所に合う",
      markAt && Math.abs(markAt.lat - 36.12) < 0.001 && Math.abs(markAt.lon - 137.55) < 0.001,
      markAt ? `${markAt.lat}, ${markAt.lon}` : "印が無い"
    );

    /*
     * 印を範囲外へドラッグされた場合。
     * 枠の中は良し悪しを決めないので、いったん海の向こうまで動く。
     * こちらが断ったら、印を「いま受け付けている場所」へ戻すこと ──
     * 戻さないと、印だけが範囲外に残って画面と申請内容が食い違う。
     */
    await inner.evaluate(() => {
      const m = window.StarsPick.marker();
      m.setLngLat([2.35, 48.9]); // パリ
      m.fire("dragend");
    });
    await page.waitForTimeout(400);
    const afterDrag = await inner.evaluate(() => {
      const p = window.StarsPick.marker().getLngLat();
      return { lat: p.lat, lon: p.lng };
    });
    const dragMsg = await page.locator("#submit-message").textContent();
    check(
      "範囲外へドラッグされたら印を戻す",
      /日本国内/.test(dragMsg) && Math.abs(afterDrag.lat - 36.12) < 0.001,
      `${dragMsg} / 印 ${afterDrag.lat}, ${afterDrag.lon}`
    );
    const readoutAfter = await page.locator("#pick-readout").textContent();
    check("範囲外へドラッグされても座標欄は変わらない", /36\.12/.test(readoutAfter), readoutAfter);
  }
  await capture("submit");

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
  check("スポットが表に並ぶ", rowCount === STUB_SPOTS.length, `${rowCount} 行`);
  await capture("list");

  /*
   * 全スポットの「ベスト時刻・点数・詳細へのリンク」を控えておき、
   * あとで1件ずつ詳細ページと突き合わせる。
   *
   * リンクは自分で組み立てずに、一覧が実際に出しているものをそのまま使う。
   * 一覧が詳細へ「どの夜か」を渡せているかも、これで一緒に確かめられる。
   */
  const listBests = [];
  for (const stub of STUB_SPOTS) {
    const row = page.locator("#spot-rows tr", { hasText: stub.name });
    if ((await row.count()) === 0) continue;
    const joined = (await row.locator("td, th").allTextContents()).join(" ");
    const href = await row.locator("th a").getAttribute("href");
    listBests.push({
      name: stub.name,
      href: href,
      score: (joined.match(/([\d.]+)点/) || [])[1],
      at: (joined.match(/(\d{2}:\d{2})/) || [])[1],
      // 「良い条件が N 時間続く」か「良い条件の時間なし」。後者は 0 とみなす
      run: /良い条件の時間なし/.test(joined)
        ? 0
        : Number((joined.match(/良い条件が約([\d.]+)時間続く/) || [])[1])
    });
  }
  const listBest = listBests.find((b) => b.name === "乗鞍畳平") || null;

  check(
    "一覧の詳細リンクが「どの夜か」を渡している",
    listBests.length > 0 && listBests.every((b) => /[?&]night=\d{4}-\d{2}-\d{2}/.test(b.href || "")),
    listBests.map((b) => b.href).join(" / ")
  );

  // 同じ天気なら暗い場所が上に来る。乗鞍(暗い山)と都心の並びで見る。
  if (!relay && !argv.includes("--live")) {
    const names = await page.locator("#spot-rows tr th a").allTextContents();
    const norikura = names.indexOf("乗鞍畳平");
    const toshin = names.indexOf("都心の公園");
    check(
      "星見レベル順で暗い場所が明るい場所より上に来る",
      norikura >= 0 && toshin >= 0 && norikura < toshin,
      names.join(" > ")
    );
  }

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

  // ---- 地名でさがす / 絞り込み / 近い順 ----
  await page.getByRole("button", { name: "全国" }).click();
  await page.waitForTimeout(150);

  // 都道府県のしぼりこみ
  await page.locator("#pref-select").selectOption("岐阜県");
  await page.waitForTimeout(200);
  {
    const names = await page.locator("#spot-rows tr th a").allTextContents();
    check("都道府県でしぼりこめる", names.length === 1 && names[0] === "乗鞍畳平", names.join(" / "));
  }

  // 市区町村のしぼりこみ(その県にあるものだけが選択肢に出る)
  {
    const cities = await page.locator("#city-select option").allTextContents();
    check(
      "市区町村の選択肢がその県のものになる",
      cities.length === 2 && cities[1] === "高山市",
      cities.join(" / ")
    );
    await page.locator("#city-select").selectOption("高山市");
    await page.waitForTimeout(200);
    const names = await page.locator("#spot-rows tr th a").allTextContents();
    check("市区町村でしぼりこめる", names.length === 1 && names[0] === "乗鞍畳平", names.join(" / "));
  }

  // 地方タブを押すと県の絞り込みは外れる(同時に効かせると何も出なくなるため)
  await page.getByRole("button", { name: "関東" }).click();
  await page.waitForTimeout(200);
  {
    const prefValue = await page.locator("#pref-select").inputValue();
    const names = await page.locator("#spot-rows tr th a").allTextContents();
    check(
      "地方タブを押すと都道府県のしぼりこみが外れる",
      prefValue === "" && names.length === 1 && names[0] === "都心の公園",
      `県=${prefValue || "(なし)"} / ${names.join(" / ")}`
    );
  }
  await page.getByRole("button", { name: "全国" }).click();
  await page.waitForTimeout(150);

  // 地名の検索。索引(places.json)を読んで候補を出す
  await page.locator("#place-search").click();
  await page.locator("#place-search").fill("石垣");
  await page.waitForFunction(
    () => {
      const box = document.getElementById("place-results");
      return box && !box.hidden && box.children.length > 0;
    },
    { timeout: 20000 }
  ).catch(() => {});
  {
    const items = await page.locator("#place-results .stars-suggest-name").allTextContents();
    check("地名の候補が出る", items.length > 0 && items.some((t) => /石垣/.test(t)), items.slice(0, 4).join(" / "));
  }

  // かなで打っても当たること(iPhone の予測変換はカナが出やすい)
  await page.locator("#place-search").fill("ちちぶ");
  await page.waitForTimeout(400);
  {
    const items = await page.locator("#place-results .stars-suggest-name").allTextContents();
    check("かなでも地名を探せる", items.some((t) => /秩父/.test(t)), items.slice(0, 4).join(" / "));
  }

  /*
   * 有名な地点が代表として出ること。
   * 「富士山」は索引に日本最高峰が入っておらず、千葉と神奈川の丘だけが
   * 出ていた(火山という分類を索引から落としていたため)。
   * 「八ヶ岳」はカナをひらがなへ寄せる処理が ヶ まで変換していて0件だった。
   */
  /*
   * 部分一致でも出ること。
   * 「星野」は合併で消えた村の名前で、旧市町村を索引に入れるまで0件だった。
   * 人はいつまでも旧町村の名前で場所を呼ぶ。
   */
  for (const [q, want] of [["星野", "星野村"], ["望岳", "望岳台"], ["秩父", "秩父市"]]) {
    await page.locator("#place-search").fill(q);
    await page.waitForTimeout(500);
    const items = await page.locator("#place-results .stars-suggest-name").allTextContents();
    check(
      `「${q}」(部分)で ${want} が出る`,
      items.some((t) => t === want),
      items.slice(0, 4).join(" / ") || "0件"
    );
  }

  /*
   * 主の索引に無い字(あざ)の名前。
   * 集落の索引(別ファイル)を後から読んで拾えること。
   * 大きいので、当たらなかったときだけ取りに行く作りになっている。
   */
  {
    const before = await page.evaluate(() => window.StarsPlaces.isLocalReady());
    check("集落の索引は当たるうちは読まない", before === false, `読み込み済み=${before}`);

    await page.locator("#place-search").fill("六呂師");
    await page.waitForFunction(
      () => {
        const box = document.getElementById("place-results");
        return box && !box.hidden && box.querySelector(".stars-suggest-name");
      },
      { timeout: 30000 }
    ).catch(() => {});
    const items = await page.locator("#place-results .stars-suggest-name").allTextContents();
    check(
      "字(あざ)の名前は集落の索引から拾う",
      items.some((t) => /六呂師/.test(t)),
      items.slice(0, 3).join(" / ") || "0件"
    );
    const after = await page.evaluate(() => window.StarsPlaces.isLocalReady());
    check("そのとき集落の索引を読みに行っている", after === true, `読み込み済み=${after}`);
  }

  // どこにも無い地名は、黙って閉じずにそう言う
  await page.locator("#place-search").fill("ぬるぽ砂漠");
  await page.waitForTimeout(800);
  {
    const note = await page.locator("#place-results .stars-suggest-note").textContent().catch(() => "");
    check("見つからないときは、その旨を出す", /見つかりませんでした/.test(note || ""), String(note));
  }

  for (const [q, want] of [["富士山", "山梨県"], ["八ヶ岳", "長野県"], ["阿蘇山", "熊本県"]]) {
    await page.locator("#place-search").fill(q);
    await page.waitForTimeout(400);
    const first = await page.locator("#place-results .stars-suggest-item").first().textContent();
    check(
      `「${q}」の先頭が ${want} になる`,
      new RegExp(want).test(first || ""),
      (first || "0件").replace(/\s+/g, " ").trim()
    );
  }

  // 候補を選ぶと基準点になり、そこから近い順に並ぶ
  await page.locator("#place-search").fill("石垣市");
  await page.waitForTimeout(400);
  await page.locator("#place-results .stars-suggest-item").first().click();
  await page.waitForTimeout(300);
  {
    const sortValue = await page.locator("#sort-select").inputValue();
    const origin = await page.locator("#origin-label").textContent();
    const names = await page.locator("#spot-rows tr th a").allTextContents();
    check(
      "地名を選ぶと近い順に切り替わる",
      sortValue === "near" && /石垣/.test(origin || ""),
      `並び=${sortValue} / ${origin}`
    );
    check(
      "石垣島の浜がいちばん近い",
      names[0] === "石垣島の浜",
      names.join(" / ")
    );
    check(
      "稚内の丘がいちばん遠い",
      names[names.length - 1] === "稚内の丘",
      names[names.length - 1]
    );
  }

  // 距離が表に出る
  {
    const firstRow = await page.locator("#spot-rows tr").first().textContent();
    check("直線距離が表に出る", /直線 約\d+km/.test(firstRow), (firstRow.match(/直線 約\d+km/) || ["なし"])[0]);
  }

  // 基準点を解除すると元の並びに戻る
  await page.locator("#origin-clear").click();
  await page.waitForTimeout(250);
  {
    const sortValue = await page.locator("#sort-select").inputValue();
    const hidden = await page.locator("#origin-current").isHidden();
    check("基準点を解除できる", sortValue === "score" && hidden, `並び=${sortValue} / 表示=${hidden ? "消えた" : "残った"}`);
  }

  // 地図で選ぶ(地図そのものはこの環境ではタイルが来ないが、開けることを見る)
  await page.getByRole("button", { name: "地図で選ぶ" }).click();
  await page.waitForTimeout(1200);
  {
    const shown = await page.locator("#pick-map-wrap").isVisible();
    const frame = page.frameLocator(".stars-pickmap-frame");
    const hasCanvas = await frame
      .locator("#pick-map canvas")
      .first()
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    check("地図で選ぶが開く", shown && hasCanvas, `表示=${shown} / 枠の中の地図=${hasCanvas}`);
    /*
     * 地図が一覧の文書に入り込んでいないこと。
     * 入り込むと Trusted Types を強制できなくなる(それで一度外していた)。
     */
    const leaked = await page.evaluate(() => ({
      maplibre: typeof window.maplibregl !== "undefined",
      canvasOutsideFrame: document.querySelectorAll("#pick-map > canvas").length
    }));
    check(
      "地図が一覧の文書に入り込んでいない",
      !leaked.maplibre && leaked.canvasOutsideFrame === 0,
      `maplibregl=${leaked.maplibre} / 直置きcanvas=${leaked.canvasOutsideFrame}`
    );

    /*
     * Trusted Types が本当に効いているか。
     * meta タグに書いてあるだけでは分からないので、実際に禁じられた書き込みを
     * 試して、ブラウザが止めることを見る。地図を分けた意味がここにある。
     */
    const tt = await page.evaluate(() => {
      const div = document.createElement("div");
      try {
        div.innerHTML = "<b>試し書き</b>";
        return { blocked: false, wrote: div.innerHTML };
      } catch (e) {
        return { blocked: true, name: e.name };
      }
    });
    check(
      "一覧では Trusted Types が効いている(innerHTML が止められる)",
      tt.blocked,
      tt.blocked ? tt.name : `止まらずに書けてしまった: ${tt.wrote}`
    );
  }
  await capture("list-search");
  await page.getByRole("button", { name: "地図を閉じる" }).click();
  await page.waitForTimeout(200);

  // 並べ替え
  await page.getByRole("button", { name: "全国" }).click();
  await page.locator("#sort-select").selectOption("name");
  await page.waitForTimeout(200);
  const byName = await page.locator("#spot-rows tr th a").allTextContents();
  // 読み(name_kana)の五十音順。「いしがきじま」がいちばん先。
  check("名前順に並べ替えできる", byName[0] === "石垣島の浜", byName.join(" > "));

  /*
   * 検索欄に一度も触れず、地図だけを使った場合。
   *
   * 索引の読み込みは検索欄に触れたときにしか始まっていなかったので、
   * この順番だと地点を選んでも地名が出ず、座標のままになっていた。
   * しかも、あとから索引が届いても座標のままだった。
   * ページを読み直して、その順番をそのまま再現する。
   */
  await page.goto(`http://127.0.0.1:${PORT}/stars/list.html`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.StarsList && window.StarsList.state.ready, { timeout: 30000 });
  {
    const touched = await page.evaluate(() => window.StarsPlaces.isReady());
    check("開いただけでは地名の索引を読み込まない", touched === false, `読み込み済み=${touched}`);
  }
  await page.getByRole("button", { name: "地図で選ぶ" }).click();
  await page.waitForTimeout(1200);
  {
    // 地図の click を人手でなぞる(この環境ではタイルが来ないので座標で起こす)
    const frame = page.frameLocator(".stars-pickmap-frame");
    await frame.locator("#pick-map canvas").first().waitFor({ timeout: 20000 });
    const inner = page.frames().find((f) => f.url().includes("pick.html"));
    await inner.evaluate(() => {
      window.StarsPick.map().fire("click", { lngLat: { lat: 35.44, lng: 137.68 } });
    });
  }
  await page.waitForFunction(
    () => {
      const t = document.getElementById("origin-label");
      return t && t.textContent && !/\d+\.\d+, \d+\.\d+/.test(t.textContent);
    },
    { timeout: 20000 }
  ).catch(() => {});
  {
    const label = await page.locator("#origin-label").textContent();
    check(
      "検索欄に触れず地図だけを使っても地名が出る",
      /付近/.test(label || "") && !/\d+\.\d+, \d+\.\d+/.test(label || ""),
      String(label)
    );
  }

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

  /*
   * ベスト時刻が「暗い時間帯」の中に入っていること。
   * 予報は1時間刻みなので取得は外側の丸い時刻まで広げているが、その両端は
   * まだ(もう)暗くない。以前はそこまで候補に入れてしまい、薄明が始まった後の
   * 時刻がベストに選ばれて、一覧ページの結果ともずれていた。
   */
  const bestAt = await page.locator("#best-at").textContent();
  const nightText = await page.locator("#fact-night").textContent();
  const toMin = (s) => {
    const [h, m] = s.split(":").map(Number);
    return h * 60 + m;
  };
  const bestHm = (bestAt.match(/(\d{2}:\d{2})/) || [])[1];
  const span = nightText.match(/(\d{2}:\d{2})〜(\d{2}:\d{2})/);
  let inWindow = false;
  if (bestHm && span) {
    // 夜は日をまたぐので、開始を0分とした経過分に直してから比べる
    const wrap = (t) => (toMin(t) - toMin(span[1]) + 1440) % 1440;
    inWindow = wrap(bestHm) <= wrap(span[2]);
  }
  check("ベスト時刻が暗い時間帯の中にある", inWindow, `${bestHm} / ${span ? span[0] : nightText}`);

  // 一覧の「ベスト時刻」と詳細の「今夜のベスト」は同じ計算のはずなので一致する
  const bestScore = (await page.locator("#best-score").textContent()).trim();
  check(
    "一覧と詳細でベストが一致する",
    listBest !== null && bestHm === listBest.at && bestScore.startsWith(listBest.score),
    `一覧 ${listBest ? listBest.at + " " + listBest.score : "—"} / 詳細 ${bestHm} ${bestScore}`
  );

  /*
   * 良い条件が続く長さ。最高点だけだと「1時間だけ晴れる夜」と
   * 「一晩中晴れる夜」が同じに見えるので、続き具合も出している。
   * 一覧と詳細で別々に数えているので、食い違わないことを見る。
   */
  {
    const good = listBests.filter((b) => Number.isFinite(b.run));
    check(
      "良い条件が続く時間が全スポットの一覧に出る",
      good.length === listBests.length,
      listBests.map((b) => `${b.name}:${b.run}`).join(" / ")
    );
  }

  /*
   * 全スポットで一致するか。一覧が出したリンクをそのまま辿る。
   *
   * 一覧と詳細が別々に「今夜がどの日か」を判定していたころは、日付の変わり目に
   * 南北で食い違った(8月15日 4時の時点で、稚内は15日の夜・石垣島は14日の夜)。
   * 稚内から石垣島まで並べて、全部一致することを見る。
   */
  {
    const mismatched = [];
    for (const b of listBests) {
      await page.goto(`http://127.0.0.1:${PORT}/stars/${b.href.replace(/^\.\//, "")}`, {
        waitUntil: "load",
        timeout: 60000
      });
      await page
        .waitForFunction(() => window.StarsSpot && window.StarsSpot.state.ready, { timeout: 30000 })
        .catch(() => {});
      const score = (await page.locator("#best-score").textContent()).trim();
      const atText = await page.locator("#best-at").textContent();
      const at = (atText.match(/(\d{2}:\d{2})/) || [])[1];
      // 続く時間。詳細は 0 のとき何も書かないので、書いていなければ 0 とみなす
      const run = Number((atText.match(/続けて約\s*([\d.]+)\s*時間/) || [])[1] || 0);
      if (at !== b.at || !score.startsWith(b.score)) {
        mismatched.push(`${b.name}: 一覧 ${b.at} ${b.score}点 / 詳細 ${at} ${score}`);
      }
      if (run !== b.run) {
        mismatched.push(`${b.name}: 続く時間が 一覧 ${b.run} / 詳細 ${run}`);
      }
    }
    check(
      `一覧と詳細が全スポットで一致する (${listBests.length}件・点数と続く時間)`,
      mismatched.length === 0,
      mismatched.join(" / ") || "全件一致"
    );

    // 上の繰り返しで別のスポットを開いたままなので、乗鞍へ戻す(以降の検査はこれを見る)
    await page.goto(
      `http://127.0.0.1:${PORT}/stars/spot.html?id=${STUB_SPOTS[0].spot_id}`,
      { waitUntil: "load", timeout: 60000 }
    );
    await page
      .waitForFunction(() => window.StarsSpot && window.StarsSpot.state.ready, { timeout: 30000 })
      .catch(() => {});
  }

  const factMoon = await page.locator("#fact-moon").textContent();
  check("月の情報が出る", /光っている/.test(factMoon), factMoon);
  check(
    "月が一晩中どうしているかが分かる",
    /月の出|月の入り|一晩中/.test(factMoon),
    factMoon
  );

  const detailAccess = await page.locator("#detail-access").textContent();
  check("アクセス情報が出る", /シャトルバス/.test(detailAccess), detailAccess.slice(0, 30));

  // 場所の地図も枠の中で動く(詳細ページも Trusted Types を強制したまま)
  {
    const hasFrame = await page
      .frameLocator("#spot-map iframe")
      .locator("#pick-map canvas")
      .first()
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    check("場所の地図が枠の中で出る", hasFrame, String(hasFrame));
    const tt = await page.evaluate(() => {
      try {
        document.createElement("div").innerHTML = "<b>試し</b>";
        return false;
      } catch (e) {
        return true;
      }
    });
    check("詳細でも Trusted Types が効いている", tt, tt ? "" : "止まらずに書けてしまった");
  }
  await capture("spot");

  // 未登録の項目は「登録なし」と出す(空欄のままにしない)
  await page.goto(
    `http://127.0.0.1:${PORT}/stars/spot.html?id=${STUB_SPOTS[2].spot_id}`,
    { waitUntil: "load", timeout: 60000 }
  );
  await page.waitForFunction(() => window.StarsSpot && window.StarsSpot.state.ready, { timeout: 30000 })
    .catch(() => {});
  const emptyAccess = await page.locator("#detail-access").textContent();
  check("未登録の項目は登録なしと出る", emptyAccess === "登録なし", emptyAccess);

  // https 以外のURLはリンクにしない
  await page.goto(
    `http://127.0.0.1:${PORT}/stars/spot.html?id=${STUB_SPOTS[1].spot_id}`,
    { waitUntil: "load", timeout: 60000 }
  );
  await page.waitForFunction(() => window.StarsSpot && window.StarsSpot.state.ready, { timeout: 30000 })
    .catch(() => {});
  const unsafeLinks = await page.locator("#detail-source a").count();
  const unsafeText = await page.locator("#detail-source").textContent();
  check("https 以外のURLはリンクにしない", unsafeLinks === 0 && /javascript/.test(unsafeText), `${unsafeLinks} 個のリンク`);

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

  /*
   * 判定の限界を伏せないこと。星見レベルは学会や気象機関の尺度ではなく
   * このサイトが決めた指数なので、そう書いてあることを検査でも守る。
   */
  const aboutText = await page.locator("main").textContent();
  check(
    "星見レベルが独自の指数だと明記されている",
    /独自に決めた指数/.test(aboutText) && /相対的な比較/.test(aboutText),
    /独自に決めた指数/.test(aboutText) ? "明記あり" : "明記なし"
  );
  check(
    "下地が読めないときは海にも色が乗ることを書いている",
    /下地が読み込めなかったときは海にも色が乗ります/.test(aboutText),
    /海にも色が乗ります/.test(aboutText) ? "明記あり" : "明記なし"
  );
  check(
    "予報モデルを Best Match と正しく書いている",
    /Best Match/.test(aboutText) && !/気象庁/.test(aboutText),
    /気象庁/.test(aboutText) ? "気象庁モデルと書いたままになっている" : "Best Match と明記"
  );

  const lpMeta = await page.locator("#lp-meta").textContent();
  check("光害データの作成情報が出る", /現在のデータ/.test(lpMeta), lpMeta.slice(0, 80));
  await capture("about");

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

  /*
   * 枠(iframe)の中で開かれたら中身を見せないこと。
   * GitHub Pages では frame-ancestors / X-Frame-Options を送れない
   * (frame-ancestors は <meta> では無視される)ので、guard.js で塞いでいる。
   * 効いているかは目で見て分からないので、実際に枠に入れて確かめる。
   */
  console.log("\nクリックジャッキング対策 (stars/guard.js):");
  {
    const outer = await browser.newPage();
    await outer.setContent(
      `<!doctype html><title>枠の検査</title>
       <iframe id="f" src="http://127.0.0.1:${PORT}/stars/list.html" width="300" height="200"></iframe>`,
      { waitUntil: "load" }
    );
    await outer.waitForTimeout(2500);
    // 枠から抜け出せていれば、外側のページ自体が対象ページへ移動している
    const brokeOut = outer.url().includes("/stars/list.html");
    // 抜け出せない場合に備えて、中身が隠されているかも見る
    let hidden = false;
    try {
      const frame = outer.frames().find((f) => f.url().includes("/stars/list.html"));
      if (frame) {
        hidden = await frame.evaluate(() => getComputedStyle(document.documentElement).display === "none");
      }
    } catch (e) {
      hidden = true; // 枠が消えている = 抜け出した
    }
    check("枠の中では表示しない", brokeOut || hidden, brokeOut ? "枠から抜け出した" : hidden ? "中身を隠した" : "枠の中で表示されている");
    await outer.close();
  }

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
