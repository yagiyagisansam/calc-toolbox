/*
 * 燃費計算ロジック(満タン法: 走行距離÷給油量)
 *
 * 計算方法:
 * - 燃費(km/L) = 走行距離(km) ÷ 給油量(L)
 * - 欧州式表記 L/100km = 100 ÷ 燃費(km/L)
 * - ガソリン単価を入れると 給油代 = 給油量×単価、1kmあたり燃料費 = 単価÷燃費 も計算
 * - 表示は小数第2位で四捨五入(給油代は円単位で四捨五入)
 */
(function (global) {
  "use strict";

  function round2(x) {
    return Math.round(x * 100) / 100;
  }

  /**
   * 満タン法で燃費を計算する。
   * @param {number} distanceKm 走行距離(km)
   * @param {number} liters 給油量(L)
   * @param {number} [pricePerL] ガソリン単価(円/L・省略可)
   * @returns {{ok: true, kmPerL: number, lPer100km: number,
   *            fuelCost?: number, costPerKm?: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_distance" | "invalid_liters" | "invalid_price"
   */
  function calc(distanceKm, liters, pricePerL) {
    if (typeof distanceKm !== "number" || !isFinite(distanceKm) || distanceKm <= 0 || distanceKm > 10000) {
      return { ok: false, code: "invalid_distance" };
    }
    if (typeof liters !== "number" || !isFinite(liters) || liters <= 0 || liters > 500) {
      return { ok: false, code: "invalid_liters" };
    }
    var kmPerL = distanceKm / liters;
    var out = {
      ok: true,
      kmPerL: round2(kmPerL),
      lPer100km: round2(100 / kmPerL)
    };
    if (pricePerL !== undefined && pricePerL !== null) {
      if (typeof pricePerL !== "number" || !isFinite(pricePerL) || pricePerL <= 0 || pricePerL > 1000) {
        return { ok: false, code: "invalid_price" };
      }
      out.fuelCost = Math.round(liters * pricePerL);
      out.costPerKm = round2(pricePerL / kmPerL);
    }
    return out;
  }

  var api = {
    calc: calc
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.NenpiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
