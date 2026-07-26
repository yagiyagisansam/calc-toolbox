// sitemap.xml をファイル走査で再生成する(ページ追加・多言語化のたびに手編集しない)
// 収録ルール:
// - すべての .html を対象に、404.html / test.html / noindex 指定ページを除外
// - index.html は末尾スラッシュのディレクトリURLにする
// - lastmod は各ファイルの最終コミット日(未コミットは今日)
// 使い方: node scripts/build/build_sitemap.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const ORIGIN = "https://quick-calc.site";
const SKIP_DIRS = new Set([".git", "scripts", "shared", "node_modules"]);

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p);
    } else if (name.endsWith(".html") && name !== "test.html" && name !== "404.html") {
      files.push(p);
    }
  }
})(ROOT);

function lastmod(file) {
  try {
    const d = execFileSync("git", ["log", "-1", "--format=%cs", "--", file], { cwd: ROOT }).toString().trim();
    if (d) return d;
  } catch {}
  return new Date().toISOString().slice(0, 10);
}

const urls = [];
for (const f of files.sort()) {
  const html = readFileSync(f, "utf8");
  if (/<meta[^>]+name="robots"[^>]+noindex/i.test(html)) continue;
  let rel = relative(ROOT, f).replace(/\\/g, "/");
  if (rel.endsWith("index.html")) rel = rel.slice(0, -"index.html".length);
  urls.push(`  <url><loc>${ORIGIN}/${rel}</loc><lastmod>${lastmod(f)}</lastmod></url>`);
}

const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
writeFileSync(join(ROOT, "sitemap.xml"), xml);
console.log(`sitemap.xml: ${urls.length} URL`);
