/*
 * 複利・積立シミュレーション 計算ロジック
 *
 * 計算式:
 * - 一括(年複利): 将来価値 = 元本 × (1 + 年利)^年数
 * - 毎月積立(月次複利・期末払い): 将来価値 = 毎月額 × ((1+i)^n − 1) ÷ i
 *   i = 年利 ÷ 12(月利)、n = 年数 × 12(積立回数)。年利0%は 毎月額 × n
 *
 * 前提(ページにも明記):
 * - 利回りは一定と仮定した概算。実際の運用は変動し、元本割れもありうる
 * - 税金(運用益への課税)・手数料は考慮しない
 */
(function (global) {
  "use strict";

  var PRINCIPAL_MIN_YEN = 10000;
  var PRINCIPAL_MAX_YEN = 1000000000;
  var MONTHLY_MIN_YEN = 1000;
  var MONTHLY_MAX_YEN = 10000000;
  var RATE_MIN = 0;
  var RATE_MAX = 30;
  var YEARS_MIN = 1;
  var YEARS_MAX = 50;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function validateRateYears(ratePercent, years) {
    if (!isFiniteNumber(ratePercent) || ratePercent < RATE_MIN || ratePercent > RATE_MAX) {
      return "invalid_rate";
    }
    if (!isFiniteNumber(years) || years !== Math.floor(years) || years < YEARS_MIN || years > YEARS_MAX) {
      return "invalid_years";
    }
    return null;
  }

  /**
   * 一括投資の将来価値(年複利)。
   * @returns {{ok: true, futureValue: number, profit: number}|{ok: false, code: string}}
   *   code: "invalid_principal" | "invalid_rate" | "invalid_years"
   */
  function lumpSum(principalYen, ratePercent, years) {
    if (!isFiniteNumber(principalYen) || principalYen < PRINCIPAL_MIN_YEN || principalYen > PRINCIPAL_MAX_YEN) {
      return { ok: false, code: "invalid_principal" };
    }
    var err = validateRateYears(ratePercent, years);
    if (err) return { ok: false, code: err };
    var fv = Math.round(principalYen * Math.pow(1 + ratePercent / 100, years));
    return { ok: true, futureValue: fv, profit: fv - principalYen };
  }

  /**
   * 毎月積立の将来価値(月次複利)。
   * @returns {{ok: true, futureValue: number, totalDeposit: number, profit: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_monthly" | "invalid_rate" | "invalid_years"
   */
  function monthlySaving(monthlyYen, ratePercent, years) {
    if (!isFiniteNumber(monthlyYen) || monthlyYen < MONTHLY_MIN_YEN || monthlyYen > MONTHLY_MAX_YEN) {
      return { ok: false, code: "invalid_monthly" };
    }
    var err = validateRateYears(ratePercent, years);
    if (err) return { ok: false, code: err };
    var n = years * 12;
    var fv;
    if (ratePercent === 0) {
      fv = monthlyYen * n;
    } else {
      var i = ratePercent / 100 / 12;
      fv = Math.round(monthlyYen * (Math.pow(1 + i, n) - 1) / i);
    }
    var deposit = monthlyYen * n;
    return { ok: true, futureValue: fv, totalDeposit: deposit, profit: fv - deposit };
  }

  var api = {
    lumpSum: lumpSum,
    monthlySaving: monthlySaving,
    PRINCIPAL_MIN_YEN: PRINCIPAL_MIN_YEN,
    PRINCIPAL_MAX_YEN: PRINCIPAL_MAX_YEN,
    MONTHLY_MIN_YEN: MONTHLY_MIN_YEN,
    MONTHLY_MAX_YEN: MONTHLY_MAX_YEN,
    RATE_MIN: RATE_MIN,
    RATE_MAX: RATE_MAX,
    YEARS_MIN: YEARS_MIN,
    YEARS_MAX: YEARS_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.CompoundCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
