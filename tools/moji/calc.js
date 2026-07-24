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

  var api = { count: count, MAX: MAX };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.MojiCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
