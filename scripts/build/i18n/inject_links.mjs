// 翻訳版が存在するページに hreflang と言語スイッチャを注入する
// - 対象はファイル走査で自動判定(ハードコードなし)。翻訳版を追加して再実行するだけで全言語に反映される
// - 冪等: マーカー(@hreflang / @langsw)の中身を毎回作り直す
// 使い方: node scripts/build/i18n/inject_links.mjs
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ORIGIN, LANGS, SWITCH_LABEL } from "./langs.mjs";

const ROOT = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const ALT_LANGS = LANGS.filter((l) => l.code !== "ja");

// 言語ディレクトリ内の対象HTMLを列挙(test.html は対象外)
function listPages(base) {
  const out = [];
  (function walk(dir, rel) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        // 言語ディレクトリ自身の入れ子(ja基準走査時の en/zh/ko)は除外
        if (rel === "" && ALT_LANGS.some((l) => l.dir === name)) continue;
        walk(p, rel ? rel + "/" + name : name);
      } else if (name.endsWith(".html") && name !== "test.html") {
        out.push(rel ? rel + "/" + name : name);
      }
    }
  })(base, "");
  return out;
}

// ページの相対パス → 公開URLパス(index.htmlは/で終える)
function urlPath(langDir, rel) {
  const prefix = langDir ? "/" + langDir : "";
  if (rel === "index.html") return prefix + "/";
  if (rel.endsWith("/index.html")) return prefix + "/" + rel.slice(0, -"index.html".length);
  return prefix + "/" + rel;
}

// 既存のブロックを取り除いてから、アンカーの直後に入れ直す。
// (挿入位置を変えたときに古い場所に残らないようにするため)
function replaceBlock(html, name, block, anchorRe) {
  const re = new RegExp(`[ \\t]*<!-- @${name} start -->[\\s\\S]*?<!-- @${name} end -->\\n?`, "g");
  const stripped = html.replace(re, "");
  const m = stripped.match(anchorRe);
  if (!m) return null;
  const at = m.index + m[0].length;
  return stripped.slice(0, at) + block + stripped.slice(at);
}

// 翻訳版が1つ以上あるページを言語横断でグループ化
const groups = new Map(); // rel → Set(langCode)
for (const lang of ALT_LANGS) {
  const base = join(ROOT, lang.dir);
  if (!existsSync(base)) continue;
  for (const rel of listPages(base)) {
    if (!groups.has(rel)) groups.set(rel, new Set());
    groups.get(rel).add(lang.code);
  }
}

let changed = 0;
for (const [rel, langSet] of [...groups.entries()].sort()) {
  const versions = LANGS.filter(
    (l) => l.code === "ja" ? existsSync(join(ROOT, rel)) : langSet.has(l.code)
  );
  if (versions.length < 2) continue;
  const jaExists = versions.some((l) => l.code === "ja");

  for (const lang of versions) {
    const file = join(ROOT, lang.dir, rel);
    let html = readFileSync(file, "utf8");

    // hreflang(相互リンク+x-default=ja)
    const links = versions.map(
      (l) => `  <link rel="alternate" hreflang="${l.code}" href="${ORIGIN}${urlPath(l.dir, rel)}">`
    );
    if (jaExists) links.push(`  <link rel="alternate" hreflang="x-default" href="${ORIGIN}${urlPath("", rel)}">`);
    const hreflangBlock = `  <!-- @hreflang start -->\n${links.join("\n")}\n  <!-- @hreflang end -->\n`;
    let next = replaceBlock(html, "hreflang", hreflangBlock, /<!-- @meta end -->\n/);
    if (next === null) { console.error(`skip(hreflangの挿入位置なし): ${file}`); continue; }

    // 言語スイッチャ(ページ最上部・現在言語はリンクにしない)
    const items = versions.map((l) =>
      l.code === lang.code
        ? `<span class="lang-current">${l.label}</span>`
        : `<a href="${urlPath(l.dir, rel)}" lang="${l.htmlLang}" hreflang="${l.code}">${l.label}</a>`
    );
    const globe = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 2.6 15 0 18M12 3c-2.6 2.6-2.6 15 0 18"/></svg>';
    const swBlock = `<!-- @langsw start -->
<div class="lang-bar">
  <nav class="lang-switch" aria-label="${SWITCH_LABEL[lang.code]}"><span class="lang-label">${globe}Language</span>${items.join("")}</nav>
</div>
<!-- @langsw end -->
`;
    next = replaceBlock(next, "langsw", swBlock, /<body>\n/);
    if (next === null) { console.error(`skip(bodyなし): ${file}`); continue; }

    if (next !== html) { writeFileSync(file, next); changed++; }
  }
}
console.log(`対象ページグループ: ${groups.size} / 更新ファイル: ${changed}`);
