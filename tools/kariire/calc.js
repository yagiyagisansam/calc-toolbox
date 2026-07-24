/*
 * 借入可能額計算ロジック(元利均等返済の逆算)
 *
 * 計算方法:
 * - 毎月の返済可能額 = 年収 × 返済負担率 ÷ 12
 * - 借入可能額 = 毎月返済額 × {1 − (1+月利)^(−返済月数)} ÷ 月利(年金現価の式)
 *   金利0%のときは 毎月返済額 × 返済月数
 * - 月利 = 年利 ÷ 12 ÷ 100
 */
(function (global) {
  "use strict";

  /**
   * 借入可能額の目安を計算する。
   * @param {number} annualIncome 年収(円・100万〜1億)
   * @param {number} burdenPct 返済負担率(%・5〜50。審査目安は30〜35、無理のない目安は20〜25)
   * @param {number} ratePct 年利(%・0〜20)
   * @param {number} years 返済期間(年・1〜50)
   * @returns {{ok: true, monthly: number, loan: number}|{ok: false, code: string}}
   *   monthly: 毎月の返済額(円) / loan: 借入可能額(円)
   *   code: "invalid_income" | "invalid_burden" | "invalid_rate" | "invalid_years"
   */
  function borrowable(annualIncome, burdenPct, ratePct, years) {
    if (typeof annualIncome !== "number" || !isFinite(annualIncome) || annualIncome < 1000000 || annualIncome > 100000000) {
      return { ok: false, code: "invalid_income" };
    }
    if (typeof burdenPct !== "number" || !isFinite(burdenPct) || burdenPct < 5 || burdenPct > 50) {
      return { ok: false, code: "invalid_burden" };
    }
    if (typeof ratePct !== "number" || !isFinite(ratePct) || ratePct < 0 || ratePct > 20) {
      return { ok: false, code: "invalid_rate" };
    }
    if (typeof years !== "number" || !isFinite(years) || years !== Math.floor(years) || years < 1 || years > 50) {
      return { ok: false, code: "invalid_years" };
    }
    var monthly = annualIncome * burdenPct / 100 / 12;
    var r = ratePct / 1200;
    var n = years * 12;
    var loan = r === 0 ? monthly * n : monthly * (1 - Math.pow(1 + r, -n)) / r;
    return { ok: true, monthly: Math.round(monthly), loan: Math.round(loan) };
  }

  var api = { borrowable: borrowable };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.KariireCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
