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

  // ヤード・フィートの定義値(1959年の国際協定): 1ヤード = 0.9144m、1フィート = 0.3048m
  var YD_M = 0.9144;
  var FT_M = 0.3048;

  /**
   * 距離を km・マイル・海里・ヤード・フィートの5単位すべてに換算する。
   * 換算値はすべて定義値: 1マイル=1.609344km、1海里=1.852km、
   * 1ヤード=0.9144m、1フィート=0.3048m。
   * 丸め: 小数第4位で四捨五入。
   * @param {number} value 数値
   * @param {string} unit 入力の単位 "km"|"mile"|"nm"|"yd"|"ft"
   * @returns {{ok:true, km:number, mile:number, nm:number, yd:number, ft:number}
   *          |{ok:false, code:string}} code: "invalid_value"|"invalid_unit"
   */
  function convertAll(value, unit) {
    if (typeof value !== "number" || !isFinite(value) || value <= 0 || value > 1e9) {
      return { ok: false, code: "invalid_value" };
    }
    var km;
    if (unit === "km") km = value;
    else if (unit === "mile") km = value * MILE_KM;
    else if (unit === "nm") km = value * NM_KM;
    else if (unit === "yd") km = value * YD_M / 1000;
    else if (unit === "ft") km = value * FT_M / 1000;
    else return { ok: false, code: "invalid_unit" };
    return {
      ok: true,
      km: round4(km),
      mile: round4(km / MILE_KM),
      nm: round4(km / NM_KM),
      yd: round4(km * 1000 / YD_M),
      ft: round4(km * 1000 / FT_M)
    };
  }

  /**
   * 速度を mph(マイル毎時)・km/h・ノットの3つに相互換算する。
   * 1mph = 1.609344km/h(定義値)、1ノット = 1.852km/h(定義値。1時間に1海里進む速さ)。
   * アメリカの制限速度標識(mph)や、船・飛行機の速度(ノット)の読み替えに。
   * 丸め: 小数第4位で四捨五入。
   * @param {number} value 数値
   * @param {string} unit 入力の単位 "mph"|"kmh"|"kt"
   * @returns {{ok:true, mph:number, kmh:number, kt:number}|{ok:false, code:string}}
   */
  function convertSpeed(value, unit) {
    if (typeof value !== "number" || !isFinite(value) || value <= 0 || value > 1e9) {
      return { ok: false, code: "invalid_value" };
    }
    var kmh;
    if (unit === "kmh") kmh = value;
    else if (unit === "mph") kmh = value * MILE_KM;
    else if (unit === "kt") kmh = value * NM_KM;
    else return { ok: false, code: "invalid_unit" };
    return {
      ok: true,
      kmh: round4(kmh),
      mph: round4(kmh / MILE_KM),
      kt: round4(kmh / NM_KM)
    };
  }

  var api = {
    convertSpeed: convertSpeed,
    convertAll: convertAll, convert: convert, MILE_KM: MILE_KM, NM_KM: NM_KM };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.MileCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
