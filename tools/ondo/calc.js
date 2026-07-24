/*
 * 温度換算ロジック(摂氏⇔華氏⇔ケルビン)
 *
 * 計算方法(定義式):
 * - 華氏(°F) = 摂氏(°C) × 1.8 + 32
 * - ケルビン(K) = 摂氏(°C) + 273.15
 * - 絶対零度(-273.15°C / -459.67°F / 0K)未満はエラー
 * - 表示は小数第2位で四捨五入
 */
(function (global) {
  "use strict";

  var ABS_ZERO = { c: -273.15, f: -459.67, k: 0 };
  var EPS = 1e-9;

  function round2(x) {
    return Math.round(x * 100) / 100;
  }

  /**
   * 温度を3単位すべてに換算する。
   * @param {number} value 温度の値
   * @param {string} unit 入力の単位 "c" | "f" | "k"
   * @returns {{ok: true, c: number, f: number, k: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_value" | "invalid_unit" | "below_absolute_zero"
   */
  function convert(value, unit) {
    if (typeof value !== "number" || !isFinite(value)) {
      return { ok: false, code: "invalid_value" };
    }
    if (unit !== "c" && unit !== "f" && unit !== "k") {
      return { ok: false, code: "invalid_unit" };
    }
    if (value < ABS_ZERO[unit] - EPS) {
      return { ok: false, code: "below_absolute_zero" };
    }
    var c = unit === "c" ? value : unit === "f" ? (value - 32) / 1.8 : value - 273.15;
    return {
      ok: true,
      c: round2(c),
      f: round2(c * 1.8 + 32),
      k: round2(c + 273.15)
    };
  }

  var api = {
    convert: convert,
    ABS_ZERO: ABS_ZERO
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.OndoCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
