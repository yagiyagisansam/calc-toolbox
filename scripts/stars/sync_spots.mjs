#!/usr/bin/env node
/*
 * 承認済みスポットを取り込んで、検索エンジンとJavaScript無効の環境でも
 * 読める形にする開発用スクリプト。
 * 使い方: node scripts/stars/sync_spots.mjs
 *
 * 出力:
 *   stars/data/spots.json   取り込んだ内容(確認・履歴用)
 *   stars/list.html         @spots ブロックに地方ごとの一覧を再注入
 *
 * サイト自体は開いたときに Supabase から直接読むので、これを実行しなくても
 * 表示は最新になる。このスクリプトは「JavaScript を動かさない読み手」
 * (検索エンジンのクローラなど)に中身を届けるためのもの。
 * スポットを承認したあと、気が向いたときに実行して push すればよい。
 *
 * 認証は要らない(承認済みだけを返す公開関数を呼ぶだけ)。
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// 接続情報は統計ツールと共用のものを読む(anonキーは公開前提)
function readConfig() {
  const src = readFileSync(path.join(ROOT, "tools", "poll", "config.js"), "utf8");
  const url = src.match(/url:\s*"([^"]+)"/);
  const key = src.match(/anonKey:\s*"([^"]+)"/);
  if (!url || !key || !url[1] || !key[1]) {
    throw new Error("tools/poll/config.js から接続情報を読めませんでした");
  }
  return { url: url[1].replace(/\/+$/, ""), anonKey: key[1] };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

const START = "<!-- @spots start -->";
const END = "<!-- @spots end -->";

function buildBlock(spots) {
  if (!spots.length) {
    return [
      START,
      "  <noscript>",
      "    <p>掲載中のスポットはまだありません。</p>",
      "  </noscript>",
      END
    ].join("\n");
  }

  // 地方ごとにまとめる(表の並びと同じ考え方)
  const byRegion = new Map();
  for (const s of spots) {
    if (!byRegion.has(s.region)) byRegion.set(s.region, []);
    byRegion.get(s.region).push(s);
  }

  const lines = [
    START,
    "  <!-- ここは scripts/stars/sync_spots.mjs が生成します。手で編集しないこと。 -->",
    '  <section class="stars-seo-list">',
    `    <h2>掲載中のスポット（${spots.length}件）</h2>`
  ];

  for (const [region, list] of byRegion) {
    lines.push("    <details>");
    lines.push(`      <summary>${escapeHtml(region)}（${list.length}件）</summary>`);
    lines.push("      <ul>");
    for (const s of list) {
      const where = [s.pref, s.elevation_m ? `標高${s.elevation_m}m` : null]
        .filter(Boolean)
        .join(" / ");
      lines.push(
        `        <li><a href="./spot.html?id=${encodeURIComponent(s.spot_id)}">` +
          `${escapeHtml(s.name)}</a>（${escapeHtml(where)}）</li>`
      );
    }
    lines.push("      </ul>");
    lines.push("    </details>");
  }

  lines.push("  </section>");
  lines.push(END);
  return lines.join("\n");
}

async function main() {
  const conf = readConfig();
  console.log("承認済みスポットを取得しています…");

  const res = await fetch(`${conf.url}/rest/v1/rpc/stars_public_spots`, {
    method: "POST",
    headers: {
      apikey: conf.anonKey,
      Authorization: `Bearer ${conf.anonKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ p_region: null })
  });
  if (!res.ok) {
    throw new Error(`取得に失敗しました (HTTP ${res.status}) ${await res.text()}`);
  }
  const spots = await res.json();
  console.log(`  ${spots.length} 件`);

  writeFileSync(
    path.join(ROOT, "stars", "data", "spots.json"),
    JSON.stringify({ generatedAt: new Date().toISOString(), spots }, null, 2) + "\n"
  );

  const listPath = path.join(ROOT, "stars", "list.html");
  const html = readFileSync(listPath, "utf8");
  const from = html.indexOf(START);
  const to = html.indexOf(END);
  if (from < 0 || to < 0) {
    throw new Error(`list.html に ${START} / ${END} が見つかりません`);
  }
  writeFileSync(listPath, html.slice(0, from) + buildBlock(spots) + html.slice(to + END.length));

  console.log("  stars/data/spots.json を更新");
  console.log("  stars/list.html の @spots ブロックを更新");
}

main().catch((e) => {
  console.error("エラー:", e.message);
  process.exit(1);
});
