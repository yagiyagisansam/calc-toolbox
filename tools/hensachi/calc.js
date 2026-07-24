/*
 * 偏差値 計算ロジック
 *
 * 計算式:
 * - 偏差値 = 50 + 10 × (得点 − 平均点) ÷ 標準偏差
 * - 点数リストからの計算では母標準偏差(点数を集団全体とみなす)を用いる
 *
 * 前提(ページにも明記):
 * - 模試の偏差値は受験者集団によって変わる相対値。集団が違えば同じ点でも偏差値は異なる
 */
(function (global) {
  "use strict";

  var SCORE_MIN = 0;
  var SCORE_MAX = 1000;
  var SD_MIN = 0.01;
  var SD_MAX = 500;
  var LIST_MIN = 2;
  var LIST_MAX = 1000;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  /**
   * 得点・平均点・標準偏差から偏差値を求める。
   * @returns {{ok: true, t: number}|{ok: false, code: string}}
   *   code: "invalid_score" | "invalid_mean" | "invalid_sd"
   */
  function fromStats(score, mean, sd) {
    if (!isFiniteNumber(score) || score < SCORE_MIN || score > SCORE_MAX) {
      return { ok: false, code: "invalid_score" };
    }
    if (!isFiniteNumber(mean) || mean < SCORE_MIN || mean > SCORE_MAX) {
      return { ok: false, code: "invalid_mean" };
    }
    if (!isFiniteNumber(sd) || sd < SD_MIN || sd > SD_MAX) {
      return { ok: false, code: "invalid_sd" };
    }
    return { ok: true, t: round1(50 + 10 * (score - mean) / sd) };
  }

  /**
   * 点数リストから平均・標準偏差・各点数の偏差値を求める。
   * @param {number[]} scores 点数の配列(2〜1000件)
   * @returns {{ok: true, mean: number, sd: number, results: Array<{score: number, t: number}>}
   *          |{ok: false, code: string}}
   *   code: "invalid_list" | "invalid_score" | "zero_sd"
   */
  function analyze(scores) {
    if (!Array.isArray(scores) || scores.length < LIST_MIN || scores.length > LIST_MAX) {
      return { ok: false, code: "invalid_list" };
    }
    for (var i = 0; i < scores.length; i++) {
      if (!isFiniteNumber(scores[i]) || scores[i] < SCORE_MIN || scores[i] > SCORE_MAX) {
        return { ok: false, code: "invalid_score" };
      }
    }
    var n = scores.length;
    var sum = 0;
    for (i = 0; i < n; i++) sum += scores[i];
    var mean = sum / n;
    var sqSum = 0;
    for (i = 0; i < n; i++) sqSum += (scores[i] - mean) * (scores[i] - mean);
    var sd = Math.sqrt(sqSum / n);
    if (sd === 0) return { ok: false, code: "zero_sd" };
    var results = [];
    for (i = 0; i < n; i++) {
      results.push({ score: scores[i], t: round1(50 + 10 * (scores[i] - mean) / sd) });
    }
    return { ok: true, mean: round2(mean), sd: round2(sd), results: results };
  }

  var api = {
    fromStats: fromStats,
    analyze: analyze,
    SCORE_MIN: SCORE_MIN,
    SCORE_MAX: SCORE_MAX,
    LIST_MIN: LIST_MIN,
    LIST_MAX: LIST_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.HensachiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
