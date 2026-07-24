/*
 * 身長フィート・インチ換算ロジック
 *
 * 計算方法(定義値):
 * - 1インチ = 2.54cm、1フィート = 12インチ = 30.48cm
 * - cm→フィート表記: インチに直してから12で割り、余りのインチは四捨五入
 *   (四捨五入で12インチになったらフィートへ繰り上げ)
 * - フィート表記→cm: (フィート×12+インチ)×2.54(小数第2位で四捨五入)
 */
(function (global) {
  "use strict";

  var INCH_CM = 2.54;

  function round2(x) { return Math.round(x * 100) / 100; }

  /**
   * cm をフィート・インチ表記に換算する。
   * @param {number} cm 身長(cm)
   * @returns {{ok: true, feet: number, inches: number, totalInches: number}
   *          |{ok: false, code: string}}
   *   inches: 表記用に四捨五入したインチ / totalInches: 換算値そのもの(小数2位)
   */
  function toFeet(cm) {
    if (typeof cm !== "number" || !isFinite(cm) || cm < 30 || cm > 300) {
      return { ok: false, code: "invalid_cm" };
    }
    var inch = cm / INCH_CM;
    var feet = Math.floor(inch / 12);
    var rem = Math.round(inch - feet * 12);
    if (rem === 12) { feet++; rem = 0; }
    return { ok: true, feet: feet, inches: rem, totalInches: round2(inch) };
  }

  /**
   * フィート・インチを cm に換算する。
   */
  function toCm(feet, inches) {
    if (typeof feet !== "number" || !isFinite(feet) || feet !== Math.floor(feet) || feet < 1 || feet > 9) {
      return { ok: false, code: "invalid_feet" };
    }
    if (typeof inches !== "number" || !isFinite(inches) || inches < 0 || inches >= 12) {
      return { ok: false, code: "invalid_inches" };
    }
    return { ok: true, cm: round2((feet * 12 + inches) * INCH_CM) };
  }

  var api = { toFeet: toFeet, toCm: toCm, INCH_CM: INCH_CM };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.ShinchoCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
