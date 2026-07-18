/*
 * ガソリン代・燃費 計算ロジック
 *
 * 計算式:
 * - 使用燃料(L) = 走行距離(km) ÷ 燃費(km/L)
 * - ガソリン代(円) = 使用燃料(L) × ガソリン単価(円/L)
 *
 * 前提(ページにも明記):
 * - カタログ燃費(WLTCモード等)と実燃費は運転条件により異なるため概算
 * - 使用燃料は小数第2位、金額は円未満を四捨五入
 */
(function (global) {
  "use strict";

  var DISTANCE_MIN_KM = 0.1;
  var DISTANCE_MAX_KM = 10000;
  var EFFICIENCY_MIN = 1;
  var EFFICIENCY_MAX = 60;
  var PRICE_MIN = 50;
  var PRICE_MAX = 500;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * ガソリン代を計算する。
   * @param {number} distanceKm 走行距離(km)
   * @param {number} kmPerL 燃費(km/L)
   * @param {number} pricePerL ガソリン単価(円/L)
   * @returns {{ok: true, fuelL: number, costYen: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_distance" | "invalid_efficiency" | "invalid_price"
   */
  function calculate(distanceKm, kmPerL, pricePerL) {
    if (!isFiniteNumber(distanceKm) || distanceKm < DISTANCE_MIN_KM || distanceKm > DISTANCE_MAX_KM) {
      return { ok: false, code: "invalid_distance" };
    }
    if (!isFiniteNumber(kmPerL) || kmPerL < EFFICIENCY_MIN || kmPerL > EFFICIENCY_MAX) {
      return { ok: false, code: "invalid_efficiency" };
    }
    if (!isFiniteNumber(pricePerL) || pricePerL < PRICE_MIN || pricePerL > PRICE_MAX) {
      return { ok: false, code: "invalid_price" };
    }
    var fuel = distanceKm / kmPerL;
    return {
      ok: true,
      fuelL: Math.round(fuel * 100) / 100,
      costYen: Math.round(fuel * pricePerL)
    };
  }

  var api = {
    calculate: calculate,
    DISTANCE_MIN_KM: DISTANCE_MIN_KM,
    DISTANCE_MAX_KM: DISTANCE_MAX_KM,
    EFFICIENCY_MIN: EFFICIENCY_MIN,
    EFFICIENCY_MAX: EFFICIENCY_MAX,
    PRICE_MIN: PRICE_MIN,
    PRICE_MAX: PRICE_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.FuelCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
