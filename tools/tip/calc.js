/*
 * チップ計算ロジック
 *
 * 計算方法:
 * - チップ = 金額 × チップ率 ÷ 100
 * - 合計 = 金額 + チップ
 * - 1人あたり = 合計 ÷ 人数
 * - 外貨の小数(セント)を扱うため小数第2位で四捨五入
 */
(function (global) {
  "use strict";

  function round2(x) { return Math.round(x * 100) / 100; }

  /**
   * チップと合計を計算する。
   * @param {number} amount 飲食代などの金額
   * @param {number} pct チップ率(%・0〜50)
   * @param {number} [people=1] 割り勘の人数(1〜50)
   * @returns {{ok: true, tip: number, total: number, perPerson: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_amount" | "invalid_pct" | "invalid_people"
   */
  function calc(amount, pct, people) {
    if (typeof amount !== "number" || !isFinite(amount) || amount <= 0 || amount > 1000000) {
      return { ok: false, code: "invalid_amount" };
    }
    if (typeof pct !== "number" || !isFinite(pct) || pct < 0 || pct > 50) {
      return { ok: false, code: "invalid_pct" };
    }
    var n = people === undefined || people === null ? 1 : people;
    if (typeof n !== "number" || !isFinite(n) || n !== Math.floor(n) || n < 1 || n > 50) {
      return { ok: false, code: "invalid_people" };
    }
    var tip = amount * pct / 100;
    var total = amount + tip;
    return { ok: true, tip: round2(tip), total: round2(total), perPerson: round2(total / n) };
  }

  var api = { calc: calc };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.TipCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
