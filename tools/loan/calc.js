/*
 * ローン返済(元利均等返済)計算ロジック
 *
 * 計算式:
 * - 毎月返済額 = 借入額 × r × (1+r)^n ÷ ((1+r)^n − 1)
 *   r = 年利(%) ÷ 100 ÷ 12(月利)、n = 返済年数 × 12(返済回数)
 * - 金利0%の場合は 毎月返済額 = 借入額 ÷ n
 *
 * 前提(ページにも明記):
 * - 元利均等返済・固定金利・ボーナス払いなしの概算
 * - 毎月返済額は円未満四捨五入し、総返済額 = 毎月返済額 × 回数 で計算
 *   (実際のローンは端数調整・保証料・手数料等があるため金融機関の試算と一致しない)
 */
(function (global) {
  "use strict";

  var PRINCIPAL_MIN_YEN = 100000;
  var PRINCIPAL_MAX_YEN = 500000000;
  var RATE_MIN = 0;
  var RATE_MAX = 20;
  var YEARS_MIN = 1;
  var YEARS_MAX = 50;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 元利均等返済の毎月返済額を計算する。
   * @param {number} principalYen 借入額(円)
   * @param {number} annualRatePercent 年利(%)
   * @param {number} years 返済期間(年・整数)
   * @returns {{ok: true, monthlyPayment: number, totalPayment: number, totalInterest: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_principal" | "invalid_rate" | "invalid_years"
   */
  function calculate(principalYen, annualRatePercent, years) {
    if (!isFiniteNumber(principalYen) || principalYen < PRINCIPAL_MIN_YEN || principalYen > PRINCIPAL_MAX_YEN) {
      return { ok: false, code: "invalid_principal" };
    }
    if (!isFiniteNumber(annualRatePercent) || annualRatePercent < RATE_MIN || annualRatePercent > RATE_MAX) {
      return { ok: false, code: "invalid_rate" };
    }
    if (!isFiniteNumber(years) || years !== Math.floor(years) || years < YEARS_MIN || years > YEARS_MAX) {
      return { ok: false, code: "invalid_years" };
    }
    var n = years * 12;
    var monthly;
    if (annualRatePercent === 0) {
      monthly = Math.round(principalYen / n);
    } else {
      var r = annualRatePercent / 100 / 12;
      var pow = Math.pow(1 + r, n);
      monthly = Math.round(principalYen * r * pow / (pow - 1));
    }
    var total = monthly * n;
    return {
      ok: true,
      monthlyPayment: monthly,
      totalPayment: total,
      totalInterest: total - principalYen
    };
  }

  var api = {
    calculate: calculate,
    PRINCIPAL_MIN_YEN: PRINCIPAL_MIN_YEN,
    PRINCIPAL_MAX_YEN: PRINCIPAL_MAX_YEN,
    RATE_MIN: RATE_MIN,
    RATE_MAX: RATE_MAX,
    YEARS_MIN: YEARS_MIN,
    YEARS_MAX: YEARS_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.LoanCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
