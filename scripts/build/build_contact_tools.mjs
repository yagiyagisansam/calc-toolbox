// contact.html(お問い合わせフォーム)の種別リストを data.js から再生成する
// 使い方: node scripts/build/build_contact_tools.mjs
// ツールを追加したら実行すること(手書きの一覧を持たないための生成スクリプト)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const dataSrc = readFileSync(ROOT + "/scripts/build/data.js", "utf8");
const TOOLS = JSON.parse(dataSrc.slice(dataSrc.indexOf("= ") + 2).replace(/;\s*$/, ""));

const CAT_ORDER = ["健康", "お金", "日付", "変換"];
const CAT_LABEL = { "健康": "健康・からだ", "お金": "お金", "日付": "日付・時間", "変換": "暮らし・変換" };

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const groups = CAT_ORDER.map((cat) => {
  const items = TOOLS.filter((t) => t.cat === cat).sort((a, b) => a.name.localeCompare(b.name, "ja"));
  if (!items.length) return "";
  const opts = items.map((t) => `          <option value="${esc(t.slug)}">${esc(t.name)}</option>`).join("\n");
  return `        <optgroup label="${esc(CAT_LABEL[cat] || cat)}">\n${opts}\n        </optgroup>`;
}).filter(Boolean).join("\n");

const block = `        <option value="">選んでください</option>\n${groups}\n        <option value="other">その他(ご意見・ご要望・サイト全体のこと)</option>`;

const file = ROOT + "/contact.html";
const html = readFileSync(file, "utf8");
const re = /(<!-- @tools start[^>]*-->\n)[\s\S]*?(\n\s*<!-- @tools end -->)/;
if (!re.test(html)) throw new Error("contact.html に @tools のマーカーが見つかりません");
writeFileSync(file, html.replace(re, (m, head, tail) => head + block + tail), "utf8");
console.log(`contact.html: ${TOOLS.length} ツールの種別リストを生成しました`);
