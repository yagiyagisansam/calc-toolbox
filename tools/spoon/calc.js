/*
 * 大さじ・小さじ・カップ換算ロジック(容量)
 *
 * 計算方法(日本の計量器具の規格):
 * - 小さじ1 = 5ml / 大さじ1 = 15ml(小さじ3杯) / 1カップ = 200ml
 * - すべて容量(ml)に直してから各単位に換算する
 * - 表示は小数第2位で四捨五入
 */
(function (global) {
  "use strict";

  var ML = { tsp: 5, tbsp: 15, cup: 200, ml: 1 };

  function round2(x) { return Math.round(x * 100) / 100; }

  /**
   * 容量を全単位に換算する。
   * @param {number} value 数値
   * @param {string} unit "tsp"(小さじ) | "tbsp"(大さじ) | "cup"(カップ) | "ml"
   * @returns {{ok: true, ml: number, tsp: number, tbsp: number, cup: number}
   *          |{ok: false, code: string}}  code: "invalid_value" | "invalid_unit"
   */
  function convert(value, unit) {
    if (typeof value !== "number" || !isFinite(value) || value <= 0 || value > 100000) {
      return { ok: false, code: "invalid_value" };
    }
    if (!ML.hasOwnProperty(unit)) return { ok: false, code: "invalid_unit" };
    var ml = value * ML[unit];
    return {
      ok: true,
      ml: round2(ml),
      tsp: round2(ml / ML.tsp),
      tbsp: round2(ml / ML.tbsp),
      cup: round2(ml / ML.cup)
    };
  }

  var api = { convert: convert, ML: ML };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.SpoonCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
