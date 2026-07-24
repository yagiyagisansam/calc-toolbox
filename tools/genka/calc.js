/*
 * 利益率・原価率計算ロジック
 *
 * 計算方法:
 * - 粗利(利益) = 売価 − 原価
 * - 利益率(粗利率) = 粗利 ÷ 売価 × 100(売価基準。小数第1位で四捨五入)
 * - 原価率 = 原価 ÷ 売価 × 100
 * - 売価の逆算 = 原価 ÷ (1 − 目標利益率÷100)(円未満四捨五入)
 */
(function (global) {
  "use strict";

  function num(v, min, max) {
    return typeof v === "number" && isFinite(v) && v >= min && v <= max;
  }
  function round1(x) { return Math.round(x * 10) / 10; }

  /**
   * 売価と原価から利益率・原価率を計算する。
   * @param {number} price 売価(円)
   * @param {number} cost 原価(円)
   * @returns {{ok: true, profit: number, marginPct: number, costPct: number}
   *          |{ok: false, code: string}}  code: "invalid_price" | "invalid_cost"
   */
  function analyze(price, cost) {
    if (!num(price, 0.01, 1000000000)) return { ok: false, code: "invalid_price" };
    if (!num(cost, 0, 1000000000)) return { ok: false, code: "invalid_cost" };
    var profit = price - cost;
    return {
      ok: true,
      profit: Math.round(profit * 100) / 100,
      marginPct: round1(profit / price * 100),
      costPct: round1(cost / price * 100)
    };
  }

  /**
   * 目標利益率から売価を逆算する。
   * @param {number} cost 原価(円)
   * @param {number} marginPct 目標利益率(%・100未満)
   * @returns {{ok: true, price: number}|{ok: false, code: string}}
   */
  function priceFor(cost, marginPct) {
    if (!num(cost, 0.01, 1000000000)) return { ok: false, code: "invalid_cost" };
    if (typeof marginPct !== "number" || !isFinite(marginPct) || marginPct < 0 || marginPct >= 100) {
      return { ok: false, code: "invalid_margin" };
    }
    return { ok: true, price: Math.round(cost / (1 - marginPct / 100)) };
  }

  var api = { analyze: analyze, priceFor: priceFor };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.GenkaCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
