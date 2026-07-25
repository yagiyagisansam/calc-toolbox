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

  /**
   * 加重平均(重み付き平均)を計算する。
   * 加重平均 = Σ(値 × 重み) ÷ Σ(重み)。
   * 例: 中間(重み2)90点と期末(重み3)70点 → (90×2+70×3)÷5 = 78点。
   * 丸め: 小数第2位で四捨五入。
   * @param {Array<[number, number]>} pairs [値, 重み] の配列(1〜10,000組)。重みは0以上で合計が0より大きいこと
   * @returns {{ok:true, n:number, weightSum:number, mean:number}
   *          |{ok:false, code:string}} code: "invalid_list"|"invalid_value"|"invalid_weight"
   */
  function weightedMean(pairs) {
    if (!Array.isArray(pairs) || pairs.length < 1 || pairs.length > MAX_N) {
      return { ok: false, code: "invalid_list" };
    }
    var sumVW = 0;
    var sumW = 0;
    for (var i = 0; i < pairs.length; i++) {
      var p = pairs[i];
      if (!Array.isArray(p) || p.length !== 2 ||
          typeof p[0] !== "number" || !isFinite(p[0])) {
        return { ok: false, code: "invalid_value" };
      }
      if (typeof p[1] !== "number" || !isFinite(p[1]) || p[1] < 0) {
        return { ok: false, code: "invalid_weight" };
      }
      sumVW += p[0] * p[1];
      sumW += p[1];
    }
    if (sumW <= 0) return { ok: false, code: "invalid_weight" };
    return {
      ok: true,
      n: pairs.length,
      weightSum: round2(sumW),
      mean: round2(sumVW / sumW)
    };
  }

  /**
   * 最大値と最小値を1つずつ除いた平均(トリム平均)を計算する。
   * 採点競技の「最高点と最低点を除いて平均する」方式と同じ考え方で、
   * 極端な値(外れ値)の影響を減らせる。同じ値が複数あるときも除くのは1つずつ。
   * 丸め: 小数第2位で四捨五入。
   * @param {number[]} list 数値の配列(3個以上、10,000個以下)
   * @returns {{ok:true, n:number, used:number, mean:number, removedMin:number, removedMax:number}
   *          |{ok:false, code:string}} code: "too_few"|"invalid_list"|"invalid_value"
   */
  function trimmedMean(list) {
    if (!Array.isArray(list) || list.length > MAX_N) return { ok: false, code: "invalid_list" };
    if (list.length < 3) return { ok: false, code: "too_few" };
    for (var i = 0; i < list.length; i++) {
      if (typeof list[i] !== "number" || !isFinite(list[i])) {
        return { ok: false, code: "invalid_value" };
      }
    }
    var sorted = list.slice().sort(function (a, b) { return a - b; });
    var inner = sorted.slice(1, sorted.length - 1);
    var sum = 0;
    for (var j = 0; j < inner.length; j++) sum += inner[j];
    return {
      ok: true,
      n: list.length,
      used: inner.length,
      mean: round2(sum / inner.length),
      removedMin: sorted[0],
      removedMax: sorted[sorted.length - 1]
    };
  }

  /**
   * 「次の1回で何点(いくつ)なら目標の平均に届くか」を逆算する。
   * 必要な値 = 目標平均 × (今の個数 + 1) − 今の合計。
   * 例: これまで80点・70点で、3回の平均を80にしたい → 80×3−150 = 90点。
   * 丸め: 小数第2位で四捨五入。
   * @param {number[]} list これまでの数値(1〜10,000個)
   * @param {number} target 目標の平均
   * @returns {{ok:true, n:number, needed:number, currentMean:number}
   *          |{ok:false, code:string}} code: "invalid_list"|"invalid_value"|"invalid_target"
   */
  function needScore(list, target) {
    var s = stats(list);
    if (!s.ok) return s;
    if (typeof target !== "number" || !isFinite(target)) {
      return { ok: false, code: "invalid_target" };
    }
    var sum = 0;
    for (var i = 0; i < list.length; i++) sum += list[i];
    return {
      ok: true,
      n: s.n,
      needed: round2(target * (s.n + 1) - sum),
      currentMean: s.mean
    };
  }

  var api = {
    needScore: needScore,
    trimmedMean: trimmedMean,
    weightedMean: weightedMean, stats: stats, MAX_N: MAX_N };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.HeikinCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
