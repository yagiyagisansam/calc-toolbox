/*
 * 目標心拍数計算ロジック(カルボーネン法)
 *
 * 計算方法:
 * - 最大心拍数の推定 = 220 − 年齢
 * - 予備心拍数 = 最大心拍数 − 安静時心拍数
 * - 目標心拍数 = 予備心拍数 × 運動強度(%) + 安静時心拍数(カルボーネン法)
 * - 強度40〜60%が健康づくり・脂肪燃焼の目安、60〜70%が持久力向上の目安
 */
(function (global) {
  "use strict";

  /**
   * 目標心拍数ゾーンを計算する。
   * @param {number} age 年齢(15〜100)
   * @param {number} restHr 安静時心拍数(30〜120拍/分)
   * @returns {{ok: true, maxHr: number, reserve: number,
   *            z40: number, z50: number, z60: number, z70: number}
   *          |{ok: false, code: string}}  code: "invalid_age" | "invalid_rest"
   */
  function zones(age, restHr) {
    if (typeof age !== "number" || !isFinite(age) || age < 15 || age > 100) {
      return { ok: false, code: "invalid_age" };
    }
    if (typeof restHr !== "number" || !isFinite(restHr) || restHr < 30 || restHr > 120) {
      return { ok: false, code: "invalid_rest" };
    }
    var max = 220 - age;
    var reserve = max - restHr;
    function z(p) { return Math.round(reserve * p + restHr); }
    return { ok: true, maxHr: Math.round(max), reserve: Math.round(reserve),
      z40: z(0.4), z50: z(0.5), z60: z(0.6), z70: z(0.7) };
  }

  var api = { zones: zones };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.ShinpakuCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
