/*
 * パーセント計算ロジック
 *
 * 計算式:
 * - AはBの何%か: A ÷ B × 100
 * - AのB%はいくつか: A × B ÷ 100
 * - AからBへの増減率: (B − A) ÷ A × 100
 *
 * 前提(ページにも明記):
 * - 結果は小数第2位までの四捨五入(端数処理による差が出ることがある)
 */
(function (global) {
  "use strict";

  var VALUE_MAX = 1000000000;
  var PERCENT_MAX = 10000;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  function validPositive(v) {
    return isFiniteNumber(v) && v > 0 && v <= VALUE_MAX;
  }

  /**
   * AはBの何%か。
   * @returns {{ok: true, percent: number}|{ok: false, code: "invalid_part"|"invalid_whole"}}
   */
  function whatPercent(part, whole) {
    if (!isFiniteNumber(part) || part < 0 || part > VALUE_MAX) return { ok: false, code: "invalid_part" };
    if (!validPositive(whole)) return { ok: false, code: "invalid_whole" };
    return { ok: true, percent: round2(part / whole * 100) };
  }

  /**
   * AのB%はいくつか。
   * @returns {{ok: true, value: number}|{ok: false, code: "invalid_value"|"invalid_percent"}}
   */
  function percentOf(value, percent) {
    if (!validPositive(value)) return { ok: false, code: "invalid_value" };
    if (!isFiniteNumber(percent) || percent < 0 || percent > PERCENT_MAX) {
      return { ok: false, code: "invalid_percent" };
    }
    return { ok: true, value: round2(value * percent / 100) };
  }

  /**
   * AからBへの増減率(%)。増加は正、減少は負。
   * @returns {{ok: true, rate: number}|{ok: false, code: "invalid_from"|"invalid_to"}}
   */
  function changeRate(from, to) {
    if (!validPositive(from)) return { ok: false, code: "invalid_from" };
    if (!isFiniteNumber(to) || to < 0 || to > VALUE_MAX) return { ok: false, code: "invalid_to" };
    return { ok: true, rate: round2((to - from) / from * 100) };
  }

  var api = {
    whatPercent: whatPercent,
    percentOf: percentOf,
    changeRate: changeRate,
    VALUE_MAX: VALUE_MAX,
    PERCENT_MAX: PERCENT_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.PercentCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
