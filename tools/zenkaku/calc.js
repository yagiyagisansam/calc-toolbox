/*
 * 全角⇔半角変換ロジック(英数字・記号・スペース)
 *
 * 変換方法:
 * - 全角英数字・記号(U+FF01〜FF5E)は対応する半角(U+0021〜007E)とコードポイントが
 *   0xFEE0 ずれている(Unicodeの対応関係)ため、その差分で相互変換する
 * - 全角スペース(U+3000)⇔ 半角スペース(U+0020)も変換する
 * - ひらがな・カタカナ・漢字は変換しない(半角カナは対象外)
 */
(function (global) {
  "use strict";

  var MAX = 100000;

  /**
   * 全角英数字・記号・スペースを半角に変換する。
   * @param {string} text 対象テキスト
   * @returns {{ok: true, text: string, changed: number}|{ok: false, code: string}}
   *   changed: 変換した文字数 / code: "invalid_text" | "too_long"
   */
  function toHankaku(text) {
    if (typeof text !== "string") return { ok: false, code: "invalid_text" };
    if (text.length > MAX) return { ok: false, code: "too_long" };
    var changed = 0;
    var out = text.replace(/[\uFF01-\uFF5E\u3000]/g, function (ch) {
      changed++;
      if (ch === "\u3000") return " ";
      return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0);
    });
    return { ok: true, text: out, changed: changed };
  }

  /**
   * 半角英数字・記号・スペースを全角に変換する。
   */
  function toZenkaku(text) {
    if (typeof text !== "string") return { ok: false, code: "invalid_text" };
    if (text.length > MAX) return { ok: false, code: "too_long" };
    var changed = 0;
    var out = text.replace(/[!-~ ]/g, function (ch) {
      changed++;
      if (ch === " ") return "\u3000";
      return String.fromCharCode(ch.charCodeAt(0) + 0xFEE0);
    });
    return { ok: true, text: out, changed: changed };
  }

  var api = { toHankaku: toHankaku, toZenkaku: toZenkaku, MAX: MAX };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.ZenkakuCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
