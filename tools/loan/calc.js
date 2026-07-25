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

  /**
   * 月次の残高スケジュールを計算する内部関数。
   * 利息 = 残高 × 月利(内部では小数のまま、合計のみ最後に円未満四捨五入)。
   * 契約上の最終回(nSchedule回目)には残高全額を返済して完済扱いとする(最終回調整)。
   * @param {number} principalYen 借入額(円)
   * @param {number} monthlyRate 月利(年利÷12÷100)
   * @param {number} monthly 毎月返済額(円)
   * @param {number} nSchedule 契約返済回数
   * @param {number} prepayMonth 繰上返済を行う回(0なら繰上なし)
   * @param {number} prepayYen 繰上返済額(円)
   * @returns {{months:number, interest:number, tooLarge:boolean}}
   */
  function simulateSchedule(principalYen, monthlyRate, monthly, nSchedule, prepayMonth, prepayYen) {
    var b = principalYen;
    var months = 0;
    var interest = 0;
    var k = 0;
    var tooLarge = false;
    while (b > 0 && k < nSchedule) {
      k++;
      var i = b * monthlyRate;
      interest += i;
      if (b + i <= monthly || k === nSchedule) { b = 0; months = k; break; }
      b = b + i - monthly;
      if (k === prepayMonth) {
        if (prepayYen >= b) { tooLarge = true; break; }
        b -= prepayYen;
      }
    }
    return { months: months, interest: Math.round(interest), tooLarge: tooLarge };
  }

  /**
   * 繰上返済(期間短縮型)のシミュレーション。
   * 毎月返済額は calculate() と同じ値(円未満四捨五入)を使い、月次残高スケジュールで
   * 「繰上なし」と「○年後に繰上」を比較する。利息軽減額 = 両者の利息合計の差。
   * 繰上返済後も毎月返済額は変えず、完済が早まる(期間短縮型)。
   * @param {number} principalYen 借入額(円)
   * @param {number} annualRatePercent 年利(%)
   * @param {number} years 返済期間(年・整数)
   * @param {number} afterYears 繰上返済の時期(○年後・1〜years-1 の整数)
   * @param {number} prepayYen 繰上返済額(円・1万円以上・借入額以下)
   * @returns {{ok:true, monthlyPayment:number, baseMonths:number, baseInterest:number,
   *            newMonths:number, newInterest:number, interestSaved:number, shortenedMonths:number}
   *          |{ok:false, code:string}}
   *   code: calculate() の各コード | "invalid_after" | "invalid_prepay" | "prepay_too_large"
   */
  function prepayment(principalYen, annualRatePercent, years, afterYears, prepayYen) {
    var base = calculate(principalYen, annualRatePercent, years);
    if (!base.ok) return base;
    if (!isFiniteNumber(afterYears) || afterYears !== Math.floor(afterYears) ||
        afterYears < 1 || afterYears > years - 1) {
      return { ok: false, code: "invalid_after" };
    }
    if (!isFiniteNumber(prepayYen) || prepayYen < 10000 || prepayYen > principalYen) {
      return { ok: false, code: "invalid_prepay" };
    }
    var n = years * 12;
    var r = annualRatePercent / 100 / 12;
    var noPre = simulateSchedule(principalYen, r, base.monthlyPayment, n, 0, 0);
    var withPre = simulateSchedule(principalYen, r, base.monthlyPayment, n, afterYears * 12, prepayYen);
    if (withPre.tooLarge) return { ok: false, code: "prepay_too_large" };
    return {
      ok: true,
      monthlyPayment: base.monthlyPayment,
      baseMonths: noPre.months,
      baseInterest: noPre.interest,
      newMonths: withPre.months,
      newInterest: withPre.interest,
      interestSaved: noPre.interest - withPre.interest,
      shortenedMonths: noPre.months - withPre.months
    };
  }

  /**
   * 元金均等返済にした場合の比較。
   * 毎月の元金 = 借入額 ÷ 返済回数(一定)。各回の利息 = 残高 × 月利。
   * 初回返済額 = 元金 + 借入額×月利 / 最終回返済額 = 元金 + 元金×月利(いずれも円未満四捨五入)。
   * 利息総額 = 借入額 × 月利 × (回数+1) ÷ 2(等差数列の和・円未満四捨五入)。
   * interestDiff = 元利均等の利息総額(calculate()と同じ) − 元金均等の利息総額。
   * @param {number} principalYen 借入額(円)
   * @param {number} annualRatePercent 年利(%)
   * @param {number} years 返済期間(年・整数)
   * @returns {{ok:true, firstPayment:number, lastPayment:number, totalInterest:number, interestDiff:number}
   *          |{ok:false, code:string}}
   */
  function gankinKinto(principalYen, annualRatePercent, years) {
    var base = calculate(principalYen, annualRatePercent, years);
    if (!base.ok) return base;
    var n = years * 12;
    var r = annualRatePercent / 100 / 12;
    var principalPart = principalYen / n;
    var totalInterest = Math.round(principalYen * r * (n + 1) / 2);
    return {
      ok: true,
      firstPayment: Math.round(principalPart + principalYen * r),
      lastPayment: Math.round(principalPart + principalPart * r),
      totalInterest: totalInterest,
      interestDiff: base.totalInterest - totalInterest
    };
  }

  var api = {
    gankinKinto: gankinKinto,
    prepayment: prepayment,
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
