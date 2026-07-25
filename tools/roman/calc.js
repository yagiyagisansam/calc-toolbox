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

  /**
   * カンマ・読点・改行区切りのテキストを、1件ずつまとめてローマ数字⇔数字変換する。
   * 各項目は自動判定: 数字だけなら「数字→ローマ数字」、それ以外は「ローマ数字→数字」。
   *
   * 時計文字盤表記(clockFace=true): 時計の文字盤では伝統的に4をIVではなくIIIIと
   * 書く慣習があるため、4→IIIIで出力し、入力IIIIも4として受け付ける。
   * それ以外の数(9=IXなど)は標準表記のまま。
   *
   * @param {string} text 区切りテキスト(最大20件)
   * @param {boolean} clockFace 時計文字盤表記(4をIIIIとする)
   * @returns {{ok:true, count:number, items:Array<{input:string, ok:boolean, output:string}>}
   *          |{ok:false, code:string}} code: "empty" | "too_many"
   */
  function convertMany(text, clockFace) {
    if (typeof text !== "string") return { ok: false, code: "empty" };
    var parts = text.split(/[\n,、]+/).map(function (p) { return p.trim(); })
      .filter(function (p) { return p !== ""; });
    if (parts.length === 0) return { ok: false, code: "empty" };
    if (parts.length > 20) return { ok: false, code: "too_many" };
    var items = parts.map(function (p) {
      if (/^[0-9]+$/.test(p)) {
        var n = parseInt(p, 10);
        var r = toRoman(n);
        if (!r.ok) return { input: p, ok: false, output: "" };
        return { input: p, ok: true, output: (clockFace && n === 4) ? "IIII" : r.roman };
      }
      if (clockFace && p.toUpperCase() === "IIII") {
        return { input: p, ok: true, output: "4" };
      }
      var r2 = fromRoman(p);
      if (!r2.ok) return { input: p, ok: false, output: "" };
      return { input: p, ok: true, output: String(r2.value) };
    });
    return { ok: true, count: items.length, items: items };
  }

  /**
   * 年月日をそれぞれローマ数字にする(記念日の刻印などの表記用)。
   * 実在する日付かどうかを検証する(2月30日などはエラー)。
   * @param {number} y 西暦年(1〜3999)
   * @param {number} m 月(1〜12)
   * @param {number} d 日(1〜31)
   * @returns {{ok:true, year:string, month:string, day:string}|{ok:false, code:string}}
   *   code: "invalid_date"
   */
  function dateToRoman(y, m, d) {
    if (typeof y !== "number" || typeof m !== "number" || typeof d !== "number" ||
        y !== Math.floor(y) || m !== Math.floor(m) || d !== Math.floor(d) ||
        y < 1 || y > 3999 || m < 1 || m > 12 || d < 1 || d > 31) {
      return { ok: false, code: "invalid_date" };
    }
    var dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) {
      return { ok: false, code: "invalid_date" };
    }
    return {
      ok: true,
      year: toRoman(y).roman,
      month: toRoman(m).roman,
      day: toRoman(d).roman
    };
  }

  var api = {
    dateToRoman: dateToRoman,
    convertMany: convertMany, toRoman: toRoman, fromRoman: fromRoman };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.RomanCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
