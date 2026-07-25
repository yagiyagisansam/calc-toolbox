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

  var ITEMS_MAX = 6;

  /**
   * 複数の家電の電気代をまとめて計算する。
   * 単価は calculate と同じ(既定31円/kWh: 全国家庭電気製品公正取引協議会の目安単価)。
   * 丸めも calculate と同じ方針: kWhは小数第2位、1日は小数第1位、月(30日)・年(365日)は
   * 円未満四捨五入。合計は丸め前の値を合算してから丸める。
   * sharePercent は1日の電気代に占める割合(小数第1位)。
   * savePerHourMonth は「1日の使用時間を1時間減らした場合に月いくら安くなるか」(円未満四捨五入)。
   * @param {{watts: number, hours: number}[]} items 家電ごとの消費電力(W)と1日の使用時間(h)。1〜6件
   * @param {number} [pricePerKwh=31] 料金単価(円/kWh)
   * @returns {{ok: true,
   *            items: {kwhPerDay: number, costPerDay: number, costPerMonth: number,
   *                    costPerYear: number, sharePercent: number, savePerHourMonth: number}[],
   *            total: {kwhPerDay: number, costPerDay: number, costPerMonth: number, costPerYear: number}}
   *          |{ok: false, code: string}}
   *   code: "invalid_items" | "invalid_watts" | "invalid_hours" | "invalid_price"
   */
  function calculateMulti(items, pricePerKwh) {
    var price = pricePerKwh === undefined ? DEFAULT_PRICE_PER_KWH : pricePerKwh;
    if (!isFiniteNumber(price) || price < PRICE_MIN || price > PRICE_MAX) {
      return { ok: false, code: "invalid_price" };
    }
    if (!Array.isArray(items) || items.length < 1 || items.length > ITEMS_MAX) {
      return { ok: false, code: "invalid_items" };
    }
    var raws = [];
    var totalKwh = 0;
    for (var i = 0; i < items.length; i++) {
      var w = items[i] && items[i].watts;
      var h = items[i] && items[i].hours;
      if (!isFiniteNumber(w) || w < WATTS_MIN || w > WATTS_MAX) {
        return { ok: false, code: "invalid_watts" };
      }
      if (!isFiniteNumber(h) || h < HOURS_MIN || h > HOURS_MAX) {
        return { ok: false, code: "invalid_hours" };
      }
      var kwh = w * h / 1000;
      totalKwh += kwh;
      raws.push({ kwh: kwh, watts: w });
    }
    var out = [];
    for (var j = 0; j < raws.length; j++) {
      var costDay = raws[j].kwh * price;
      out.push({
        kwhPerDay: Math.round(raws[j].kwh * 100) / 100,
        costPerDay: Math.round(costDay * 10) / 10,
        costPerMonth: Math.round(costDay * 30),
        costPerYear: Math.round(costDay * 365),
        sharePercent: Math.round(raws[j].kwh / totalKwh * 1000) / 10,
        savePerHourMonth: Math.round(raws[j].watts / 1000 * price * 30)
      });
    }
    var totalCostDay = totalKwh * price;
    return {
      ok: true,
      items: out,
      total: {
        kwhPerDay: Math.round(totalKwh * 100) / 100,
        costPerDay: Math.round(totalCostDay * 10) / 10,
        costPerMonth: Math.round(totalCostDay * 30),
        costPerYear: Math.round(totalCostDay * 365)
      }
    };
  }

  var api = {
    calculateMulti: calculateMulti,
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
