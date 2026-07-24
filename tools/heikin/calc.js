/*
 * 平均値・中央値計算ロジック
 *
 * 計算方法:
 * - 平均値 = 合計 ÷ 個数(小数第2位で四捨五入)
 * - 中央値 = 昇順に並べた中央の値(偶数個のときは中央2つの平均)
 * - 合計・平均は浮動小数点誤差を避けるため小数第2位で四捨五入
 */
(function (global) {
  "use strict";

  var MAX_N = 10000;

  function round2(x) { return Math.round(x * 100) / 100; }

  /**
   * 数値リストの基本統計量を計算する。
   * @param {number[]} list 数値の配列(1〜10,000個)
   * @returns {{ok: true, n: number, sum: number, mean: number, median: number,
   *            min: number, max: number}|{ok: false, code: string}}
   *   code: "invalid_list" | "invalid_value"
   */
  function stats(list) {
    if (!Array.isArray(list) || list.length < 1 || list.length > MAX_N) {
      return { ok: false, code: "invalid_list" };
    }
    var sum = 0;
    for (var i = 0; i < list.length; i++) {
      if (typeof list[i] !== "number" || !isFinite(list[i])) {
        return { ok: false, code: "invalid_value" };
      }
      sum += list[i];
    }
    var sorted = list.slice().sort(function (a, b) { return a - b; });
    var n = sorted.length;
    var median = n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
    return {
      ok: true,
      n: n,
      sum: round2(sum),
      mean: round2(sum / n),
      median: round2(median),
      min: sorted[0],
      max: sorted[n - 1]
    };
  }

  var api = { stats: stats, MAX_N: MAX_N };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.HeikinCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
