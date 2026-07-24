/*
 * 文字数カウントロジック
 *
 * 計算方法:
 * - 文字数はUnicodeコードポイント単位で数える(絵文字等のサロゲートペアを1文字と数える)
 * - 「文字数」= 改行を除いた文字数(スペース込み)
 * - 「スペース除く」= さらに半角/全角スペース・タブを除いた文字数
 * - 原稿用紙換算 = 文字数(スペース込み)÷ 400 の切り上げ
 */
(function (global) {
  "use strict";

  var MAX = 1000000;

  /**
   * テキストの文字数を数える。
   * @param {string} text 対象テキスト
   * @returns {{ok: true, chars: number, charsNoSpace: number, lines: number, genkoyoshi: number}
   *          |{ok: false, code: string}}
   *   chars: 文字数(スペース込み・改行除く) / charsNoSpace: スペース・タブも除く
   *   lines: 行数 / genkoyoshi: 400字詰め原稿用紙の枚数(切り上げ)
   *   code: "invalid_text" | "too_long"
   */
  function count(text) {
    if (typeof text !== "string") return { ok: false, code: "invalid_text" };
    if (text.length > MAX) return { ok: false, code: "too_long" };
    var cps = Array.from(text);
    var chars = 0;
    var noSpace = 0;
    for (var i = 0; i < cps.length; i++) {
      var c = cps[i];
      if (c === "\n" || c === "\r") continue;
      chars++;
      if (c !== " " && c !== "\u3000" && c !== "\t") noSpace++;
    }
    var lines = text === "" ? 0 : text.split("\n").length;
    return {
      ok: true,
      chars: chars,
      charsNoSpace: noSpace,
      lines: lines,
      genkoyoshi: Math.ceil(chars / 400)
    };
  }

  /**
   * HTMLソースからタグ・script/style・コメントを取り除き、本文だけの文字数を数える。
   * @param {string} html HTMLソース
   * @returns {{ok:true, chars:number, charsNoSpace:number, lines:number, genkoyoshi:number, stripped:string}
   *          |{ok:false, code:string}}
   */
  function countHtmlStripped(html) {
    if (typeof html !== "string") return { ok: false, code: "invalid_text" };
    if (html.length > MAX) return { ok: false, code: "too_long" };
    var s = html;
    s = s.replace(/<script[\s\S]*?<\/script\s*>/gi, "");
    s = s.replace(/<style[\s\S]*?<\/style\s*>/gi, "");
    s = s.replace(/<!--[\s\S]*?-->/g, "");
    s = s.replace(/<![^>]*>/g, "");
    s = s.replace(/<\/?[a-zA-Z][^>]*>/g, "");
    s = s.replace(/&#x([0-9a-fA-F]+);/g, function (m, h) { return String.fromCodePoint(parseInt(h, 16)); });
    s = s.replace(/&#(\d+);/g, function (m, d) { return String.fromCodePoint(parseInt(d, 10)); });
    s = s.replace(/&nbsp;/gi, " ").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
         .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&amp;/gi, "&");
    var r = count(s);
    if (!r.ok) return r;
    return {
      ok: true,
      chars: r.chars,
      charsNoSpace: r.charsNoSpace,
      lines: r.lines,
      genkoyoshi: r.genkoyoshi,
      stripped: s
    };
  }

  /**
   * 目標字数に対する残り/超過を判定する。
   * @param {string} text 対象テキスト
   * @param {number} limit 目標字数(1以上の整数)
   * @param {string} basis "chars"(スペース込み・既定) | "noSpace"(スペース除く)
   * @returns {{ok:true, count:number, limit:number, remaining:number, over:number, within:boolean}
   *          |{ok:false, code:string}}
   *   code: "invalid_text" | "too_long" | "invalid_limit"
   */
  function checkTarget(text, limit, basis) {
    var r = count(text);
    if (!r.ok) return r;
    if (typeof limit !== "number" || !isFinite(limit) || limit < 1 || Math.floor(limit) !== limit) {
      return { ok: false, code: "invalid_limit" };
    }
    var c = basis === "noSpace" ? r.charsNoSpace : r.chars;
    return {
      ok: true,
      count: c,
      limit: limit,
      remaining: Math.max(0, limit - c),
      over: Math.max(0, c - limit),
      within: c <= limit
    };
  }

  /**
   * 英文の単語数を数える(空白区切りで、英数字を含むかたまりのみを1語と数える)。
   * 日本語だけの文章では0になる。
   * @param {string} text 対象テキスト
   * @returns {{ok:true, words:number}|{ok:false, code:string}}
   */
  function wordCount(text) {
    if (typeof text !== "string") return { ok: false, code: "invalid_text" };
    if (text.length > MAX) return { ok: false, code: "too_long" };
    var words = text.split(/[\s　]+/).filter(function (w) {
      return /[A-Za-z0-9]/.test(w);
    });
    return { ok: true, words: words.length };
  }

  var api = {
    checkTarget: checkTarget, wordCount: wordCount,
    countHtmlStripped: countHtmlStripped, count: count, MAX: MAX };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.MojiCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
