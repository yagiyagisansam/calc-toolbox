/*
 * カフェイン摂取量計算ロジック
 *
 * 計算方法:
 * - 摂取量(mg) = Σ(飲み物のカフェイン濃度 mg/100ml × 量 ml ÷ 100)
 * - 濃度は日本食品標準成分表の浸出液の値等(コーヒー60・紅茶30・せん茶20・
 *   ほうじ茶20・ウーロン茶20・玉露160 mg/100ml、コーラ約10、エナジードリンクは製品差大)
 * - 目安: 健康な成人1日400mgまで(海外機関の評価)。妊娠中はより少なく(200〜300mg)
 */
(function (global) {
  "use strict";

  var DRINKS = {
    coffee: { per100: 60, label: "コーヒー(ドリップ)" },
    instant: { per100: 57, label: "インスタントコーヒー" },
    gyokuro: { per100: 160, label: "玉露" },
    sencha: { per100: 20, label: "緑茶(せん茶)" },
    hojicha: { per100: 20, label: "ほうじ茶" },
    oolong: { per100: 20, label: "ウーロン茶" },
    blacktea: { per100: 30, label: "紅茶" },
    cola: { per100: 10, label: "コーラ" },
    energy: { per100: 32, label: "エナジードリンク(製品差大)" },
    decaf: { per100: 1, label: "カフェインレスコーヒー" }
  };
  var LIMIT_ADULT = 400;
  var LIMIT_PREGNANT = 200;

  /**
   * カフェイン摂取量を合計する。
   * @param {Array<{drink: string, ml: number}>} items 飲んだもののリスト(1〜20件)
   * @returns {{ok: true, totalMg: number, pctAdult: number, pctPregnant: number}
   *          |{ok: false, code: string}}
   *   pctAdult: 成人の目安400mgに対する% / pctPregnant: 200mgに対する%
   *   code: "invalid_items" | "invalid_drink" | "invalid_ml"
   */
  function total(items) {
    if (!Array.isArray(items) || items.length < 1 || items.length > 20) {
      return { ok: false, code: "invalid_items" };
    }
    var sum = 0;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !DRINKS.hasOwnProperty(it.drink)) return { ok: false, code: "invalid_drink" };
      if (typeof it.ml !== "number" || !isFinite(it.ml) || it.ml <= 0 || it.ml > 5000) {
        return { ok: false, code: "invalid_ml" };
      }
      sum += DRINKS[it.drink].per100 * it.ml / 100;
    }
    return {
      ok: true,
      totalMg: Math.round(sum),
      pctAdult: Math.round(sum / LIMIT_ADULT * 100),
      pctPregnant: Math.round(sum / LIMIT_PREGNANT * 100)
    };
  }

  var api = { total: total, DRINKS: DRINKS, LIMIT_ADULT: LIMIT_ADULT, LIMIT_PREGNANT: LIMIT_PREGNANT };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.CaffeineCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
