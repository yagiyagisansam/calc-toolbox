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

  /**
   * 標準正規分布の累積分布関数(下側確率)。正規分布近似の計算に使う。
   * erf は Abramowitz & Stegun 7.1.26 の近似式(誤差 |ε| <= 1.5e-7)を使用:
   *   erf(x) ≈ 1 - (a1*t + a2*t^2 + a3*t^3 + a4*t^4 + a5*t^5) * exp(-x^2),
   *   t = 1 / (1 + p*x), p = 0.3275911,
   *   a1=0.254829592, a2=-0.284496736, a3=1.421413741, a4=-1.453152027, a5=1.061405429
   *   (x < 0 は erf(-x) = -erf(x) で対応)
   * Φ(z) = 0.5 * (1 + erf(z / √2))
   * @param {number} z 標準化された値
   * @returns {number} 下側確率(0〜1)
   */
  function normCdf(z) {
    var x = Math.abs(z) / Math.SQRT2;
    var p = 0.3275911;
    var a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
        a4 = -1.453152027, a5 = 1.061405429;
    var t = 1 / (1 + p * x);
    var poly = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;
    var erf = 1 - poly * Math.exp(-x * x);
    if (z < 0) erf = -erf;
    return 0.5 * (1 + erf);
  }

  /**
   * 偏差値と受験者数から、上位何%・およそ何位かを正規分布近似で求める。
   * 得点分布を正規分布とみなす近似計算(実際の分布とはずれることがある)。
   * 上位% = (1 - Φ((偏差値-50)/10)) × 100
   * 丸め方針: 上位%は小数第2位で四捨五入、順位は整数に四捨五入(最上位は1位)。
   * @param {number} t 偏差値(0〜100)
   * @param {number} examinees 受験者数(1〜10,000,000の整数)
   * @returns {{ok:true, topPct:number, rank:number}|{ok:false, code:string}}
   *   code: "invalid_t" | "invalid_examinees"
   */
  function toRank(t, examinees) {
    if (!isFiniteNumber(t) || t < 0 || t > 100) {
      return { ok: false, code: "invalid_t" };
    }
    if (!isFiniteNumber(examinees) || examinees !== Math.floor(examinees) ||
        examinees < 1 || examinees > 10000000) {
      return { ok: false, code: "invalid_examinees" };
    }
    var upper = 1 - normCdf((t - 50) / 10);
    return {
      ok: true,
      topPct: round2(upper * 100),
      rank: Math.max(1, Math.round(upper * examinees))
    };
  }

  /**
   * 順位と受験者数から、偏差値のめやすを正規分布近似で逆算する。
   * 上側確率 p = (順位 - 0.5) ÷ 受験者数(順位の中央を取る補正)とし、
   * Φ(z) = 1 - p となる z を二分法で求めて 偏差値 = 50 + 10z とする。
   * 丸め方針: 偏差値は小数第1位で四捨五入。近似計算である旨に注意。
   * @param {number} rank 順位(1〜受験者数の整数)
   * @param {number} examinees 受験者数(1〜10,000,000の整数)
   * @returns {{ok:true, t:number}|{ok:false, code:string}}
   *   code: "invalid_rank" | "invalid_examinees"
   */
  function fromRank(rank, examinees) {
    if (!isFiniteNumber(examinees) || examinees !== Math.floor(examinees) ||
        examinees < 1 || examinees > 10000000) {
      return { ok: false, code: "invalid_examinees" };
    }
    if (!isFiniteNumber(rank) || rank !== Math.floor(rank) || rank < 1 || rank > examinees) {
      return { ok: false, code: "invalid_rank" };
    }
    var target = 1 - (rank - 0.5) / examinees;
    var lo = -8, hi = 8;
    for (var i = 0; i < 80; i++) {
      var mid = (lo + hi) / 2;
      if (normCdf(mid) < target) lo = mid;
      else hi = mid;
    }
    return { ok: true, t: round1(50 + 10 * (lo + hi) / 2) };
  }

  var api = {
    fromRank: fromRank,
    toRank: toRank,
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
