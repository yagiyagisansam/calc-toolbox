/*
 * マイル⇔km換算ロジック
 *
 * 計算方法(定義値):
 * - 1マイル(国際マイル) = 1.609344 km(正確な定義値)
 * - 1海里(国際海里) = 1.852 km(正確な定義値)
 * - 表示は小数第4位で四捨五入
 */
(function (global) {
  "use strict";

  var MILE_KM = 1.609344;
  var NM_KM = 1.852;

  function round4(x) { return Math.round(x * 10000) / 10000; }

  /**
   * 距離を km・マイル・海里すべてに換算する。
   * @param {number} value 数値
   * @param {string} unit 入力の単位 "km" | "mile" | "nm"
   * @returns {{ok: true, km: number, mile: number, nm: number}|{ok: false, code: string}}
   *   code: "invalid_value" | "invalid_unit"
   */
  function convert(value, unit) {
    if (typeof value !== "number" || !isFinite(value) || value <= 0 || value > 1e9) {
      return { ok: false, code: "invalid_value" };
    }
    var km;
    if (unit === "km") km = value;
    else if (unit === "mile") km = value * MILE_KM;
    else if (unit === "nm") km = value * NM_KM;
    else return { ok: false, code: "invalid_unit" };
    return { ok: true, km: round4(km), mile: round4(km / MILE_KM), nm: round4(km / NM_KM) };
  }

  var api = { convert: convert, MILE_KM: MILE_KM, NM_KM: NM_KM };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.MileCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
