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

  var TARGET_MIN_YEN = 100000;
  var TARGET_MAX_YEN = 10000000000;

  /**
   * 目標金額から毎月の積立額を逆算する(月次複利・期末払い)。
   * 毎月積立額 = 目標額 × i ÷ ((1+i)^n − 1)。i = 年利÷12、n = 年数×12。年利0%は 目標額 ÷ n。
   * 積立額は円未満切り上げ(その額を積み立てれば目標に届く)。
   * @param {number} targetYen 目標金額(円・10万〜100億)
   * @param {number} ratePercent 想定利回り(年率%・0〜30)
   * @param {number} years 積立期間(年・1〜50の整数)
   * @returns {{ok:true, monthly:number, totalDeposit:number, profit:number}
   *          |{ok:false, code:string}}
   *   monthly: 必要積立月額 / totalDeposit: 積立元本の合計 / profit: 運用益(目標額−元本)
   *   code: "invalid_target" | "invalid_rate" | "invalid_years"
   */
  function requiredMonthly(targetYen, ratePercent, years) {
    if (!isFiniteNumber(targetYen) || targetYen < TARGET_MIN_YEN || targetYen > TARGET_MAX_YEN) {
      return { ok: false, code: "invalid_target" };
    }
    var err = validateRateYears(ratePercent, years);
    if (err) return { ok: false, code: err };
    var n = years * 12;
    var monthly;
    if (ratePercent === 0) {
      monthly = Math.ceil(targetYen / n);
    } else {
      var i = ratePercent / 100 / 12;
      monthly = Math.ceil(targetYen * i / (Math.pow(1 + i, n) - 1));
    }
    var deposit = monthly * n;
    return { ok: true, monthly: monthly, totalDeposit: deposit, profit: targetYen - deposit };
  }

  /**
   * 毎月の積立額と利回りから、目標金額に届くまでの期間を逆算する(月次複利・期末払い)。
   * 必要月数 n = log(目標額×i÷毎月額 + 1) ÷ log(1+i) を切り上げ。年利0%は 目標額÷毎月額 を切り上げ。
   * 50年(600か月)を超える場合は "too_long"。futureValue はその月数まで積み立てた場合の額(円未満四捨五入)。
   * @param {number} monthlyYen 毎月の積立額(円・1,000〜1,000万)
   * @param {number} ratePercent 想定利回り(年率%・0〜30)
   * @param {number} targetYen 目標金額(円・10万〜100億)
   * @returns {{ok:true, months:number, years:number, remMonths:number, futureValue:number}
   *          |{ok:false, code:string}}
   *   code: "invalid_monthly" | "invalid_rate" | "invalid_target" | "too_long"
   */
  function yearsToTarget(monthlyYen, ratePercent, targetYen) {
    if (!isFiniteNumber(monthlyYen) || monthlyYen < MONTHLY_MIN_YEN || monthlyYen > MONTHLY_MAX_YEN) {
      return { ok: false, code: "invalid_monthly" };
    }
    if (!isFiniteNumber(ratePercent) || ratePercent < RATE_MIN || ratePercent > RATE_MAX) {
      return { ok: false, code: "invalid_rate" };
    }
    if (!isFiniteNumber(targetYen) || targetYen < TARGET_MIN_YEN || targetYen > TARGET_MAX_YEN) {
      return { ok: false, code: "invalid_target" };
    }
    var months;
    var fv;
    if (ratePercent === 0) {
      months = Math.ceil(targetYen / monthlyYen);
      fv = monthlyYen * months;
    } else {
      var i = ratePercent / 100 / 12;
      months = Math.ceil(Math.log(targetYen * i / monthlyYen + 1) / Math.log(1 + i));
      fv = Math.round(monthlyYen * (Math.pow(1 + i, months) - 1) / i);
    }
    if (months > 600) return { ok: false, code: "too_long" };
    return { ok: true, months: months, years: Math.floor(months / 12), remMonths: months % 12, futureValue: fv };
  }

  var api = {
    yearsToTarget: yearsToTarget,
    requiredMonthly: requiredMonthly,
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
