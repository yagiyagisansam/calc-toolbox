#!/usr/bin/env node
/*
 * 掲載候補を入れた状態のサイトを、実際にブラウザで開いて画面を保存する。
 *
 * 何のためか:
 *   公開してから「一覧はこう見えるのか」と気づいても遅い。
 *   承認前に、本番と同じ見た目を紙で確認できるようにする。
 *   データベースには一切書き込まない ── 候補は page.route で差し込むだけ。
 *
 * 使い方:
 *   node scripts/stars/preview.mjs [--out 出力先ディレクトリ]
 *   node scripts/stars/preview.mjs --pref 長野県   (詳細ページに出すスポットを選ぶ)
 *
 * 天気は「その日らしい」値を作って入れる。実際の予報ではないので、
 * 点数そのものではなく画面の作りを見るために使うこと。
 */
import { createServer } from "node:http";
import { readFile, stat, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

async function loadChromium() {
  try {
    return (await import("playwright")).chromium;
  } catch (e) {
    /* 次を試す */
  }
  try {
    const root = execFileSync("npm", ["root", "-g"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      shell: process.platform === "win32"
    }).trim();
    if (root) {
      return (await import(pathToFileURL(path.join(root, "playwright", "index.mjs")).href)).chromium;
    }
  } catch (e) {
    /* 下の案内へ */
  }
  console.error("Playwright が見つかりません。scripts/stars/README.md を参照してください。");
  process.exit(2);
}

const chromium = await loadChromium();

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const PORT = 8791;

const argv = process.argv.slice(2);
const outIdx = argv.indexOf("--out");
const OUT = outIdx >= 0 ? argv[outIdx + 1] : path.join(HERE, "shots");
const prefIdx = argv.indexOf("--pref");
const WANT_PREF = prefIdx >= 0 ? argv[prefIdx + 1] : "長野県";

/* ---- 掲載候補を、公開用RPCが返す形に整える ---- */
const raw = JSON.parse(readFileSync(path.join(HERE, "spot-candidates.json"), "utf8"));
const candidates = raw.spots || raw;

/*
 * spot_id は毎回同じものが出るように、都道府県名から決める。
 * 実行のたびに変わると、画面を見比べたときに別物に見えてしまう。
 */
function idOf(i) {
  const h = String(i + 1).padStart(12, "0");
  return `00000000-0000-4000-8000-${h}`;
}

const SPOTS = candidates.map((s, i) => ({
  spot_id: idOf(i),
  name: s.name,
  name_kana: null,
  pref: s.pref,
  city: s.city,
  region: regionOf(s.pref),
  lat: s.lat,
  lon: s.lon,
  elevation_m: null,
  access: s.access,
  facilities: /トイレ/.test(s.access) ? "トイレあり" : null,
  // 調査で拾った注意は caution へ。note(ひとこと)とは分けて出す。
  caution: s.caution,
  note: s.note || null,
  source_url: /^https:/.test(s.src) ? s.src : null
}));

function regionOf(pref) {
  const m = {
    北海道: "北海道",
    青森県: "東北", 岩手県: "東北", 宮城県: "東北", 秋田県: "東北", 山形県: "東北", 福島県: "東北",
    茨城県: "関東", 栃木県: "関東", 群馬県: "関東", 埼玉県: "関東", 千葉県: "関東", 東京都: "関東", 神奈川県: "関東",
    新潟県: "中部", 富山県: "中部", 石川県: "中部", 福井県: "中部", 山梨県: "中部", 長野県: "中部",
    岐阜県: "中部", 静岡県: "中部", 愛知県: "中部",
    三重県: "近畿", 滋賀県: "近畿", 京都府: "近畿", 大阪府: "近畿", 兵庫県: "近畿", 奈良県: "近畿", 和歌山県: "近畿",
    鳥取県: "中国", 島根県: "中国", 岡山県: "中国", 広島県: "中国", 山口県: "中国",
    徳島県: "四国", 香川県: "四国", 愛媛県: "四国", 高知県: "四国",
    福岡県: "九州・沖縄", 佐賀県: "九州・沖縄", 長崎県: "九州・沖縄", 熊本県: "九州・沖縄",
    大分県: "九州・沖縄", 宮崎県: "九州・沖縄", 鹿児島県: "九州・沖縄", 沖縄県: "九州・沖縄"
  };
  return m[pref] || "中部";
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml"
};

function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        let rel = decodeURIComponent(req.url.split("?")[0]);
        if (rel.endsWith("/")) rel += "index.html";
        const file = path.join(ROOT, rel);
        if (!file.startsWith(ROOT)) return res.writeHead(403).end();
        if ((await stat(file)).isDirectory()) return res.writeHead(404).end();
        res.writeHead(200, {
          "Content-Type": TYPES[path.extname(file)] || "application/octet-stream"
        });
        res.end(await readFile(file));
      } catch (e) {
        res.writeHead(404).end("not found");
      }
    });
    server.listen(PORT, () => resolve(server));
  });
}

const server = await serve();
const browser = await chromium.launch({ headless: true });

await mkdir(OUT, { recursive: true });

/*
 * 天気の作り物。
 * 実際の予報ではないので、南ほど晴れるという単純な傾斜にしておく。
 * ここを本物にしたい場合は verify.mjs --relay --live を使う。
 */
function weatherBody() {
  const meta = { south: 24, north: 46, west: 123, east: 146, step: 1, hours: 78, parts: 6 };
  const rows = (meta.north - meta.south) / meta.step + 1;
  const cols = (meta.east - meta.west) / meta.step + 1;
  /*
   * 見本では夜の前半も描くため、いまより12時間前から予報を始める。
   * updated_at は実際の作成時刻にして、古いキャッシュの警告とは区別する。
   */
  const base = Math.floor(Date.now() / 3600000) * 3600 - 12 * 3600;
  const times = [];
  for (let h = 0; h < meta.hours; h++) times.push(base + h * 3600);

  const cloud = [], precip = [], visibility = [], humidity = [];
  for (let r = 0; r < rows; r++) {
    const lat = meta.north - r * meta.step;
    // 南ほど晴れる。加えて時刻でも少し動かし、ベスト時刻が地点ごとに変わるようにする
    const c0 = Math.max(0, Math.min(100, Math.round(((lat - meta.south) / (meta.north - meta.south)) * 70)));
    for (let k = 0; k < cols; k++) {
      const lon = meta.west + k * meta.step;
      const phase = ((r * 7 + k * 3) % 12) / 12;
      const series = times.map((t, h) => {
        const wave = Math.sin((h / 6 + phase) * Math.PI * 2) * 18;
        return Math.max(0, Math.min(100, Math.round(c0 + wave)));
      });
      cloud.push(series);
      precip.push(series.map((v) => Math.round(v / 3)));
      visibility.push(times.map(() => 24000));
      humidity.push(times.map(() => 55));
    }
  }
  return [{
    payload: { times, cloud, precip, visibility, humidity },
    meta: { ...meta, points: rows * cols },
    updated_at: new Date().toISOString()
  }];
}

async function newPage(width, height) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route("**://*.supabase.co/rest/v1/rpc/stars_public_spots", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SPOTS) })
  );
  await page.route("**://*.supabase.co/rest/v1/stars_weather_cache**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(weatherBody()) })
  );
  // 地図タイルはこの環境から届かない。届かなくても一覧・詳細の作りは確認できる。
  return page;
}

const shots = [];
async function shot(page, name, opts = {}) {
  const file = path.join(OUT, name + ".png");
  await page.screenshot({ path: file, ...opts });
  shots.push(file);
  console.log("  保存:", file);
}

/* ---- iPhone に近い縦長(主環境) ---- */
console.log("iPhone 相当 (430×860):");
{
  const page = await newPage(430, 860);
  await page.goto(`http://127.0.0.1:${PORT}/stars/list.html`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.StarsList && window.StarsList.state.ready, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, "01_一覧_iPhone_先頭");
  await shot(page, "02_一覧_iPhone_全体", { fullPage: true });

  // 地方で絞り込んだところ
  await page.getByRole("button", { name: "中部" }).click().catch(() => {});
  await page.waitForTimeout(300);
  await shot(page, "03_一覧_iPhone_中部で絞り込み");

  // 地名で探して近い順にしたところ
  await page.getByRole("button", { name: "全国" }).click().catch(() => {});
  await page.locator("#place-search").click();
  await page.locator("#place-search").fill("秩父");
  await page
    .waitForFunction(() => {
      const box = document.getElementById("place-results");
      return box && !box.hidden && box.children.length > 0;
    }, { timeout: 20000 })
    .catch(() => {});
  await shot(page, "06_一覧_地名の候補");
  await page.locator("#place-results .stars-suggest-item").first().click().catch(() => {});
  await page.waitForTimeout(400);
  await shot(page, "07_一覧_近い順");

  const target = SPOTS.find((s) => s.pref === WANT_PREF) || SPOTS[0];
  await page.goto(
    `http://127.0.0.1:${PORT}/stars/spot.html?id=${target.spot_id}`,
    { waitUntil: "load", timeout: 60000 }
  );
  await page.waitForFunction(() => window.StarsSpot && window.StarsSpot.state.ready, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, "04_詳細_iPhone_全体", { fullPage: true });
  await page.close();
}

/* ---- PC 幅 ---- */
console.log("PC 相当 (1280×900):");
{
  const page = await newPage(1280, 900);
  await page.goto(`http://127.0.0.1:${PORT}/stars/list.html`, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => window.StarsList && window.StarsList.state.ready, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(600);
  await shot(page, "05_一覧_PC_全体", { fullPage: true });
  await page.close();
}

console.log(`\n${SPOTS.length} 件の候補を入れて ${shots.length} 枚を保存しました。`);
console.log("※ データベースには何も書き込んでいません(応答を差し替えているだけ)。");

await browser.close();
server.close();
