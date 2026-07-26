/*
 * 英語住所変換ロジック(日本の住所 → 英語表記の並び替え・整形)
 *
 * 根拠(一次情報):
 * - 日本郵便「国際郵便 宛名の記入方法」: 英語表記は 建物・部屋 → 番地 町域 → 市区町村 → 都道府県 郵便番号 → 国名 の順
 *   https://www.post.japanpost.jp/int/use/writing/normal.html
 * - 郵便番号・住所・カナ読みのデータは日本郵便「郵便番号データ」(shared/postal/、ページ側で取得)
 *
 * 前提:
 * - ローマ字はカナからの機械変換(生成器: scripts/build/gen_postal_data.py)。ページ側で手修正できる
 * - 京都の通り名(「〜通上ル」等)・大口事業所の個別郵便番号は町域データに無いことがある(手入力で補える)
 */
(function (global) {
  "use strict";

  var ZEN_NUM = "０１２３４５６７８９";

  function toHalf(s) {
    var out = "";
    for (var i = 0; i < s.length; i++) {
      var idx = ZEN_NUM.indexOf(s[i]);
      if (idx >= 0) out += String(idx);
      else if (s[i] === "−" || s[i] === "ー" || s[i] === "‐" || s[i] === "―" || s[i] === "-") out += "-";
      else out += s[i];
    }
    return out;
  }

  /**
   * 郵便番号の正規化。「〒100-0014」「1000014」「100 0014」等を受け付ける。
   * @returns {{ok:true, zip3:string, zip4:string, zip:string}|{ok:false, code:"invalid_zip"}}
   */
  function normalizeZip(input) {
    if (typeof input !== "string") return { ok: false, code: "invalid_zip" };
    var digits = toHalf(input).replace(/[^0-9]/g, "");
    if (digits.length !== 7) return { ok: false, code: "invalid_zip" };
    return { ok: true, zip3: digits.slice(0, 3), zip4: digits.slice(3), zip: digits.slice(0, 3) + "-" + digits.slice(3) };
  }

  /**
   * 丁目・番地・号を英語住所用の「1-2-3」形式へ。
   * 「1丁目2番3号」「1丁目2-3」「一丁目」の漢数字は対象外(数字のみ対応)。
   * @returns {{ok:true, banchi:string}|{ok:false, code:"invalid_banchi"}}
   */
  function normalizeBanchi(input) {
    if (typeof input !== "string") return { ok: false, code: "invalid_banchi" };
    var s = toHalf(input).trim();
    if (s === "") return { ok: true, banchi: "" };
    s = s.replace(/丁目|番地|番/g, "-").replace(/号/g, "");
    s = s.replace(/[\s]+/g, "");
    s = s.replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!/^[0-9][0-9-]*$/.test(s)) return { ok: false, code: "invalid_banchi" };
    return { ok: true, banchi: s };
  }

  /**
   * 英語表記の住所を組み立てる。
   * @param {{zip:string, pref:string, city:string, neighborhood:string, banchi:string, building:string}} p
   *   pref/city/neighborhood はローマ字。banchi は normalizeBanchi 済みの値。building は任意
   * @returns {{ok:true, lines:string[], single:string}|{ok:false, code:"missing_area"}}
   */
  function englishAddress(p) {
    if (!p || !p.pref || !p.city) return { ok: false, code: "missing_area" };
    var street = [];
    if (p.banchi) street.push(p.banchi);
    if (p.neighborhood) street.push(p.neighborhood);
    var lines = [];
    if (p.building) lines.push(p.building);
    if (street.length) lines.push(street.join(" "));
    lines.push(p.city);
    lines.push(p.pref + (p.zip ? " " + p.zip : ""));
    lines.push("JAPAN");
    return { ok: true, lines: lines, single: lines.join(", ") };
  }

  var api = {
    normalizeZip: normalizeZip,
    normalizeBanchi: normalizeBanchi,
    englishAddress: englishAddress
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.JushoCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
