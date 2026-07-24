/*
 * タンパク質摂取量計算ロジック
 *
 * 計算方法(目安):
 * - ふつうの生活: 体重×0.9g/日(食事摂取基準の推奨量の算定に用いられる維持必要量
 *   0.66g/kg×利用効率補正に相当する概数)
 * - 運動習慣あり: 体重×1.2g / 筋トレ・スポーツ選手: 体重×1.6g
 *   (スポーツ栄養で一般的に推奨される1.2〜2.0g/kgの範囲の代表値)
 */
(function (global) {
  "use strict";

  var LEVELS = {
    normal: { rate: 0.9, label: "ふつうの生活" },
    active: { rate: 1.2, label: "運動習慣あり(週2〜3回)" },
    training: { rate: 1.6, label: "筋トレ・スポーツ選手" }
  };

  /**
   * 1日のタンパク質摂取量の目安を計算する。
   * @param {number} weightKg 体重(kg・20〜300)
   * @param {string} level "normal" | "active" | "training"
   * @returns {{ok: true, grams: number, rate: number, label: string}
   *          |{ok: false, code: string}}  code: "invalid_weight" | "invalid_level"
   */
  function needs(weightKg, level) {
    if (typeof weightKg !== "number" || !isFinite(weightKg) || weightKg < 20 || weightKg > 300) {
      return { ok: false, code: "invalid_weight" };
    }
    if (!LEVELS.hasOwnProperty(level)) return { ok: false, code: "invalid_level" };
    var l = LEVELS[level];
    return { ok: true, grams: Math.round(weightKg * l.rate), rate: l.rate, label: l.label };
  }

  var api = { needs: needs, LEVELS: LEVELS };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.ProteinCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
