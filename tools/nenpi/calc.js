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

  /**
   * 実燃費がカタログ燃費の何%出ているかを計算する。
   * 実燃費はカタログ値(WLTCモード等)より低くなるのが普通で、
   * 7〜8割程度なら一般的な範囲。割合は小数第1位で四捨五入。
   * @param {number} actualKmPerL 実燃費(km/L・1〜60)
   * @param {number} catalogKmPerL カタログ燃費(km/L・1〜60)
   * @returns {{ok: true, percent: number}|{ok: false, code: string}}
   *   code: "invalid_actual" | "invalid_catalog"
   */
  function catalogRatio(actualKmPerL, catalogKmPerL) {
    if (typeof actualKmPerL !== "number" || !isFinite(actualKmPerL) ||
        actualKmPerL < 1 || actualKmPerL > 60) {
      return { ok: false, code: "invalid_actual" };
    }
    if (typeof catalogKmPerL !== "number" || !isFinite(catalogKmPerL) ||
        catalogKmPerL < 1 || catalogKmPerL > 60) {
      return { ok: false, code: "invalid_catalog" };
    }
    return { ok: true, percent: Math.round(actualKmPerL / catalogKmPerL * 1000) / 10 };
  }

  /**
   * 2台の車の年間ガソリン代を比較する(買い替え判断の目安)。
   * 年間ガソリン代 = 年間走行距離 ÷ 燃費 × 単価(円未満四捨五入)。
   * diffYen = 車Aの年間費 − 車Bの年間費(正なら車Bのほうが安い)。
   * @param {number} kmPerLA 車Aの燃費(km/L・1〜60)
   * @param {number} kmPerLB 車Bの燃費(km/L・1〜60)
   * @param {number} annualKm 年間走行距離(km・100〜100,000)
   * @param {number} pricePerL ガソリン単価(円/L・0超〜1,000)
   * @returns {{ok: true, costA: number, costB: number, diffYen: number,
   *            fuelLA: number, fuelLB: number}
   *          |{ok: false, code: string}}
   *   fuelLA/fuelLB: 年間使用燃料(L・小数第1位)
   *   code: "invalid_efficiency_a" | "invalid_efficiency_b" | "invalid_distance" | "invalid_price"
   */
  function compareCars(kmPerLA, kmPerLB, annualKm, pricePerL) {
    if (typeof kmPerLA !== "number" || !isFinite(kmPerLA) || kmPerLA < 1 || kmPerLA > 60) {
      return { ok: false, code: "invalid_efficiency_a" };
    }
    if (typeof kmPerLB !== "number" || !isFinite(kmPerLB) || kmPerLB < 1 || kmPerLB > 60) {
      return { ok: false, code: "invalid_efficiency_b" };
    }
    if (typeof annualKm !== "number" || !isFinite(annualKm) || annualKm < 100 || annualKm > 100000) {
      return { ok: false, code: "invalid_distance" };
    }
    if (typeof pricePerL !== "number" || !isFinite(pricePerL) || pricePerL <= 0 || pricePerL > 1000) {
      return { ok: false, code: "invalid_price" };
    }
    var fuelA = annualKm / kmPerLA;
    var fuelB = annualKm / kmPerLB;
    var costA = Math.round(fuelA * pricePerL);
    var costB = Math.round(fuelB * pricePerL);
    return {
      ok: true,
      costA: costA,
      costB: costB,
      diffYen: costA - costB,
      fuelLA: Math.round(fuelA * 10) / 10,
      fuelLB: Math.round(fuelB * 10) / 10
    };
  }

  var api = {
    compareCars: compareCars,
    catalogRatio: catalogRatio,
    calc: calc
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.NenpiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
