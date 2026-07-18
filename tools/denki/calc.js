/*
 * 電気代 計算ロジック
 *
 * 計算式と単価の根拠(一次情報):
 * - 消費電力量(kWh) = 消費電力(W) × 使用時間(h) ÷ 1000
 * - 電気代 = 消費電力量(kWh) × 料金単価(円/kWh)
 * - 単価の既定値 31円/kWh(税込) は公益社団法人 全国家庭電気製品公正取引協議会の
 *   「電力料金の目安単価」(2022年7月改定)
 *   出典: https://www.eftc.or.jp/qa/
 *
 * 前提(ページにも明記):
 * - 実際の電気料金は契約プラン(基本料金・段階料金・燃料費調整等)により異なる概算
 * - 月=30日・年=365日で換算
 */
(function (global) {
  "use strict";

  var WATTS_MIN = 0.1;
  var WATTS_MAX = 20000;
  var HOURS_MIN = 0.1;
  var HOURS_MAX = 24;
  var PRICE_MIN = 1;
  var PRICE_MAX = 100;
  var DEFAULT_PRICE_PER_KWH = 31;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 電気代を計算する。
   * @param {number} watts 消費電力(W)
   * @param {number} hoursPerDay 1日の使用時間(h)
   * @param {number} [pricePerKwh=31] 料金単価(円/kWh)。省略時は目安単価31円
   * @returns {{ok: true, kwhPerDay: number, costPerDay: number, costPerMonth: number, costPerYear: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_watts" | "invalid_hours" | "invalid_price"
   */
  function calculate(watts, hoursPerDay, pricePerKwh) {
    var price = pricePerKwh === undefined ? DEFAULT_PRICE_PER_KWH : pricePerKwh;
    if (!isFiniteNumber(watts) || watts < WATTS_MIN || watts > WATTS_MAX) {
      return { ok: false, code: "invalid_watts" };
    }
    if (!isFiniteNumber(hoursPerDay) || hoursPerDay < HOURS_MIN || hoursPerDay > HOURS_MAX) {
      return { ok: false, code: "invalid_hours" };
    }
    if (!isFiniteNumber(price) || price < PRICE_MIN || price > PRICE_MAX) {
      return { ok: false, code: "invalid_price" };
    }
    var kwh = watts * hoursPerDay / 1000;
    return {
      ok: true,
      kwhPerDay: Math.round(kwh * 100) / 100,
      costPerDay: Math.round(kwh * price * 10) / 10,
      costPerMonth: Math.round(kwh * price * 30),
      costPerYear: Math.round(kwh * price * 365)
    };
  }

  var api = {
    calculate: calculate,
    WATTS_MIN: WATTS_MIN,
    WATTS_MAX: WATTS_MAX,
    HOURS_MIN: HOURS_MIN,
    HOURS_MAX: HOURS_MAX,
    PRICE_MIN: PRICE_MIN,
    PRICE_MAX: PRICE_MAX,
    DEFAULT_PRICE_PER_KWH: DEFAULT_PRICE_PER_KWH
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.DenkiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
