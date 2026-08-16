/*
 * ブラウザでの検証に共通で要るもの。
 *
 * なぜ分けたか:
 *   verify.mjs(作り込みの検証)と verify_live.mjs(本番データの検証)で、
 *   ブラウザの用意と静的配信と中継は同じものが要る。
 *   コピーすると、片方だけ直った状態で「両方で確かめた」と言うことになる。
 *
 * ここには判定を置かない。土台だけを置く。
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

/**
 * Playwright を見つける。
 *
 * 以前はこの環境の絶対パスを直接書いていた。手元では動くが、
 * 他の誰かが新規に checkout しても動かない。Windows では動きようがない。
 * 検証スクリプトが特定の1台でしか走らないのでは「検証してある」と言えない。
 *
 * 順番: 1) ふつうに import  2) グローバルに入っている場所を npm に聞く
 */
export async function loadChromium() {
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

/** 公開時と同じ相対パスで読めるよう、リポジトリのルートをそのまま配信する */
export function serve(port) {
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
    server.listen(port, () => resolve(server));
  });
}

/** ブラウザを起動する。実体が無いときは、何をすればよいかを示して止める */
export async function launch(chromium, headed) {
  try {
    return await chromium.launch({ headless: !headed });
  } catch (err) {
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
}

/**
 * 外への問い合わせを Node 経由で通す。
 *
 * この検証環境ではブラウザが外に出られないが、Node は出られる。
 * 本物のタイル・本物のデータベースを見たいときだけ使う。
 */
export async function relayExternal(page, patterns) {
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
