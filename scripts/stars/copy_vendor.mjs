#!/usr/bin/env node
/*
 * 地図ライブラリ(MapLibre GL JS)を stars/vendor/ に取り込む開発用スクリプト。
 * 使い方: node scripts/stars/copy_vendor.mjs
 *
 * なぜ自前で持つのか:
 *   このサイトは CSP を default-src 'none' から必要な分だけ開ける方針で、
 *   script-src は 'self' のまま維持したい。CDN から読むと外部オリジンを
 *   許可することになるうえ、配信元が変われば表示が壊れる。
 *   最後の晩餐アプリ(App リポジトリ)も同じ理由で node_modules から
 *   コピーする方式を採っている。
 *
 * なぜ v5 の "csp" ビルドなのか:
 *   - v6 は ESM のみで、このリポジトリの「グローバルに公開する素の <script>」
 *     という書き方と合わない。v5 は UMD を配っている。
 *   - 通常ビルドは Web Worker を blob URL で作るため CSP に worker-src blob:
 *     が必要になる。csp ビルドは worker を実ファイルの URL から読むので
 *     worker-src 'self' のままで済む。転送量は増えるが一度読めばキャッシュされる。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VENDOR = path.join(ROOT, "stars", "vendor");

const PACKAGE = "maplibre-gl";
const VERSION = "5.24.0";

// dist/ から取り込むファイル
const FILES = [
  "dist/maplibre-gl-csp.js",
  "dist/maplibre-gl-csp-worker.js",
  "dist/maplibre-gl.css",
  "LICENSE.txt"
];

const tmp = mkdtempSync(path.join(os.tmpdir(), "stars-vendor-"));
try {
  console.log(`${PACKAGE}@${VERSION} を取得中…`);
  const out = execFileSync("npm", ["pack", `${PACKAGE}@${VERSION}`, "--silent"], {
    cwd: tmp,
    encoding: "utf8"
  });
  const tgz = out.trim().split("\n").pop();
  execFileSync("tar", ["xzf", tgz], { cwd: tmp });

  mkdirSync(VENDOR, { recursive: true });
  for (const rel of FILES) {
    const src = path.join(tmp, "package", rel);
    const dst = path.join(VENDOR, path.basename(rel));
    copyFileSync(src, dst);
    const kb = Math.round(readFileSync(src).length / 1024);
    console.log(`  ${path.basename(rel)}  ${kb} KB`);
  }

  writeFileSync(
    path.join(VENDOR, "VERSION.txt"),
    [
      `${PACKAGE} ${VERSION}`,
      "BSD-3-Clause (LICENSE.txt を同梱)",
      "取り込み: node scripts/stars/copy_vendor.mjs",
      `更新日: ${new Date().toISOString().slice(0, 10)}`,
      ""
    ].join("\n")
  );
  console.log(`\nstars/vendor/ に取り込み完了`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
