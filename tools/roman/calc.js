/*
 * ローマ数字変換ロジック(1〜3999)
 *
 * 変換方法:
 * - 標準的な減算則(IV=4, IX=9, XL=40, XC=90, CD=400, CM=900)を用いる
 * - ローマ数字→数値は、変換後に再度ローマ数字へ戻して一致するか検証し、
 *   IIII のような非標準表記はエラーにする
 */
(function (global) {
  "use strict";

  var TABLE = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
  ];
  var VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

  /**
   * 数値をローマ数字に変換する(1〜3999)。
   * @returns {{ok: true, roman: string}|{ok: false, code: string}}  code: "out_of_range"
   */
  function toRoman(n) {
    if (typeof n !== "number" || !isFinite(n) || n !== Math.floor(n) || n < 1 || n > 3999) {
      return { ok: false, code: "out_of_range" };
    }
    var out = "";
    var rest = n;
    for (var i = 0; i < TABLE.length; i++) {
      while (rest >= TABLE[i][0]) {
        out += TABLE[i][1];
        rest -= TABLE[i][0];
      }
    }
    return { ok: true, roman: out };
  }

  /**
   * ローマ数字を数値に変換する(大文字・小文字どちらも可)。
   * @returns {{ok: true, value: number}|{ok: false, code: string}}  code: "invalid_roman"
   */
  function fromRoman(s) {
    if (typeof s !== "string" || s.trim() === "") return { ok: false, code: "invalid_roman" };
    var up = s.trim().toUpperCase();
    var total = 0;
    for (var i = 0; i < up.length; i++) {
      var v = VALUES[up[i]];
      if (!v) return { ok: false, code: "invalid_roman" };
      var next = VALUES[up[i + 1]] || 0;
      total += v < next ? -v : v;
    }
    var back = toRoman(total);
    if (!back.ok || back.roman !== up) return { ok: false, code: "invalid_roman" };
    return { ok: true, value: total };
  }

  var api = { toRoman: toRoman, fromRoman: fromRoman };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.RomanCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
