/*
 * ガチャ確率・期待課金額の計算ロジック
 *
 * 根拠(計算の考え方):
 * - 各回の抽選が独立で、排出率 p が一定であるというベルヌーイ試行(二項分布)の前提。
 *   n回で1回以上当たる確率 = 1 −(1−p)^n。排出率1%を100回で 63.4% になる。
 *   ガチャ確率の数学(二項分布・天井)の解説
 *   https://nandemo-tools.com/blog/gacha-probability-math-pity-binomial (2026年7月29日参照)
 *
 * 前提:
 * - 「毎回の排出率が一定で、前の結果に影響されない」独立試行として計算する。
 *   実際のゲームには「引くほど確率が上がる(ソフト天井)」「グループ内の重み付け」など
 *   公表されていない仕組みがある場合があり、その場合の実際の確率とはずれる。
 * - 天井(pity)は「N回引けば必ず1個手に入る」方式(いわゆる確定天井)としてのみ扱う。
 * - 期待課金額は「当たるか天井に達するまで引き続ける」場合の平均額。実際に必要な額は
 *   運によって大きく上下する(平均より少なく済む人のほうが多い)。
 */
(function (global) {
  "use strict";

  var MAX_PULLS = 100000;   // 引く回数・天井回数の上限
  var MAX_COUNT = 1000;     // 「欲しい個数」の上限(計算時間を抑えるため)
  var MAX_COST = 10000000;  // 1回あたり課金額の上限(円)

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function isCountIn(v, min, max) {
    return isFiniteNumber(v) && v === Math.floor(v) && v >= min && v <= max;
  }

  /** 小数第d位に丸める(表示のぶれを防ぐため計算結果は必ずここを通す) */
  function round(v, d) {
    var f = Math.pow(10, d);
    return Math.round(v * f) / f;
  }

  /**
   * 排出率(%)を 0〜1 の確率に直す。0%より大きく100%以下のみ有効。
   * @param {number} ratePercent 1回あたりの排出率(%)。例: 3 なら 3%
   * @returns {number|null} 確率(0〜1)。範囲外なら null
   */
  function toProbability(ratePercent) {
    if (!isFiniteNumber(ratePercent) || ratePercent <= 0 || ratePercent > 100) return null;
    return ratePercent / 100;
  }

  /**
   * n回引いて1回以上当たる確率。1 −(1−p)^n。
   * @param {number} ratePercent 1回あたりの排出率(%)。0より大きく100以下
   * @param {number} pulls 引く回数(1〜100000の整数)
   * @returns {{ok:true, probability:number, percent:number, missPercent:number,
   *            expectedHits:number}
   *          |{ok:false, code:"invalid_rate"|"invalid_pulls"}}
   *   probability は 0〜1 の生値、percent は %表示用に小数第2位で丸めた値。
   *   missPercent は 1回も当たらない確率(%)、expectedHits は当たる個数の期待値 n×p。
   */
  function hitProbability(ratePercent, pulls) {
    var p = toProbability(ratePercent);
    if (p === null) return { ok: false, code: "invalid_rate" };
    if (!isCountIn(pulls, 1, MAX_PULLS)) return { ok: false, code: "invalid_pulls" };
    var miss = Math.pow(1 - p, pulls);
    var hit = 1 - miss;
    return {
      ok: true,
      probability: hit,
      percent: round(hit * 100, 2),
      missPercent: round(miss * 100, 2),
      expectedHits: round(pulls * p, 2)
    };
  }

  /**
   * n回引いて k個以上当たる確率(二項分布の上側累積)。
   * P(X≥k) = 1 − Σ[i=0..k−1] C(n,i) p^i (1−p)^(n−i)
   * 二項係数の桁あふれを避けるため、確率質量を漸化式で順に更新して合計する。
   * @param {number} ratePercent 1回あたりの排出率(%)
   * @param {number} pulls 引く回数(1〜100000の整数)
   * @param {number} count 欲しい個数(1〜1000の整数、引く回数以下)
   * @returns {{ok:true, probability:number, percent:number}
   *          |{ok:false, code:"invalid_rate"|"invalid_pulls"|"invalid_count"}}
   */
  function atLeastCount(ratePercent, pulls, count) {
    var p = toProbability(ratePercent);
    if (p === null) return { ok: false, code: "invalid_rate" };
    if (!isCountIn(pulls, 1, MAX_PULLS)) return { ok: false, code: "invalid_pulls" };
    if (!isCountIn(count, 1, MAX_COUNT) || count > pulls) return { ok: false, code: "invalid_count" };
    if (p === 1) return { ok: true, probability: 1, percent: 100 };

    var q = 1 - p;
    var term = Math.pow(q, pulls); // i=0 の確率質量
    var cum = term;                // Σ[i=0..k−1]
    for (var i = 0; i < count - 1; i++) {
      term = term * ((pulls - i) / (i + 1)) * (p / q);
      cum += term;
    }
    if (cum > 1) cum = 1;
    var prob = 1 - cum;
    if (prob < 0) prob = 0;
    return { ok: true, probability: prob, percent: round(prob * 100, 2) };
  }

  /**
   * 天井を考えた期待試行回数と期待課金額。
   * 天井なしの期待回数は幾何分布の平均 1/p。
   * 天井N回(N回目までに出なければ確定)の期待回数は
   *   Σ[k=0..N−1](1−p)^k =(1 −(1−p)^N)/ p  ……「まだ当たっていない状態で引く回数」の合計。
   * 期待課金額 = 期待回数 × 1回あたりの課金額。
   * @param {number} ratePercent 1回あたりの排出率(%)
   * @param {number} pity 天井回数(1〜100000の整数)。天井なしで見たいときも数値は必要
   * @param {number} costPerPull 1回あたりの課金額(円、0〜10000000)
   * @returns {{ok:true, expectedPullsNoPity:number, expectedPulls:number,
   *            expectedCost:number, maxCost:number, pityReachPercent:number}
   *          |{ok:false, code:"invalid_rate"|"invalid_pity"|"invalid_cost"}}
   *   expectedPullsNoPity: 天井が無い場合の期待回数(小数第2位で丸め)
   *   expectedPulls:       天井を考えた期待回数(小数第2位で丸め)
   *   expectedCost:        期待課金額(円、1円未満を四捨五入)
   *   maxCost:             天井まで引いた場合の最大課金額(円)
   *   pityReachPercent:    天井まで引くことになる確率(%、小数第2位で丸め)。
   *                        天井のN回目を引くのは最初のN−1回がすべて外れたときなので(1−p)^(N−1)。
   *                        (天井1回なら必ず1回引くので100%になる)
   */
  function expected(ratePercent, pity, costPerPull) {
    var p = toProbability(ratePercent);
    if (p === null) return { ok: false, code: "invalid_rate" };
    if (!isCountIn(pity, 1, MAX_PULLS)) return { ok: false, code: "invalid_pity" };
    if (!isFiniteNumber(costPerPull) || costPerPull < 0 || costPerPull > MAX_COST) {
      return { ok: false, code: "invalid_cost" };
    }
    var miss = Math.pow(1 - p, pity);
    var pulls = (1 - miss) / p;
    var reach = Math.pow(1 - p, pity - 1); // 最初のN−1回がすべて外れて天井のN回目を引く確率
    return {
      ok: true,
      expectedPullsNoPity: round(1 / p, 2),
      expectedPulls: round(pulls, 2),
      expectedCost: Math.round(pulls * costPerPull),
      maxCost: Math.round(pity * costPerPull),
      pityReachPercent: round(reach * 100, 2)
    };
  }

  /**
   * 「当たる確率を◯%以上にしたい」ときに必要な引く回数。
   * (1−p)^n ≤ 1−t を満たす最小の整数 n = ceil( ln(1−t) / ln(1−p) )。
   * 浮動小数の誤差で1回ずれることがあるため、求めた n の前後を実際の確率で検算して補正する。
   * @param {number} ratePercent 1回あたりの排出率(%)
   * @param {number} targetPercent 目標にする確率(%)。0より大きく100未満(100%は到達不可)
   * @returns {{ok:true, pulls:number, actualPercent:number}
   *          |{ok:false, code:"invalid_rate"|"invalid_target"|"out_of_range"}}
   */
  function pullsForProbability(ratePercent, targetPercent) {
    var p = toProbability(ratePercent);
    if (p === null) return { ok: false, code: "invalid_rate" };
    if (!isFiniteNumber(targetPercent) || targetPercent <= 0 || targetPercent >= 100) {
      return { ok: false, code: "invalid_target" };
    }
    if (p === 1) return { ok: true, pulls: 1, actualPercent: 100 };
    var t = targetPercent / 100;
    var n = Math.ceil(Math.log(1 - t) / Math.log(1 - p));
    if (n < 1) n = 1;
    // 丸め誤差の補正: 条件を満たす最小の n に寄せる
    while (n > 1 && 1 - Math.pow(1 - p, n - 1) >= t) n--;
    while (1 - Math.pow(1 - p, n) < t) n++;
    if (n > MAX_PULLS) return { ok: false, code: "out_of_range" };
    return { ok: true, pulls: n, actualPercent: round((1 - Math.pow(1 - p, n)) * 100, 2) };
  }

  var api = {
    hitProbability: hitProbability,
    atLeastCount: atLeastCount,
    expected: expected,
    pullsForProbability: pullsForProbability,
    MAX_PULLS: MAX_PULLS,
    MAX_COUNT: MAX_COUNT
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.GachaCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
