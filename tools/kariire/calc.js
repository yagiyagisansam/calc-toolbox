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

  /**
   * 元利均等返済の毎月返済額(内部用)。円未満四捨五入。
   * @param {number} loanYen 借入額(円)
   * @param {number} ratePct 年利(%)
   * @param {number} months 返済回数
   * @returns {number} 毎月返済額(円)
   */
  function monthlyFor(loanYen, ratePct, months) {
    if (ratePct === 0) return Math.round(loanYen / months);
    var r = ratePct / 1200;
    var pow = Math.pow(1 + r, months);
    return Math.round(loanYen * r * pow / (pow - 1));
  }

  /**
   * 金利上昇シナリオ比較: 現在の金利と +0.5% / +1% / +2% になった場合の
   * 毎月返済額・総返済額を比較する(元利均等・固定金利の概算)。
   * 毎月返済額は円未満四捨五入、総返済額 = 毎月返済額 × 回数。
   * @param {number} loanYen 借入額(円・100万〜10億)
   * @param {number} ratePct 現在の年利(%・0〜18。+2%後も上限20%に収まる範囲)
   * @param {number} years 返済期間(年・1〜50の整数)
   * @returns {{ok:true, rows:Array<{delta:number, rate:number, monthly:number, total:number, monthlyDiff:number}>}
   *          |{ok:false, code:string}}
   *   code: "invalid_loan" | "invalid_rate" | "invalid_years"
   */
  function rateScenarios(loanYen, ratePct, years) {
    if (typeof loanYen !== "number" || !isFinite(loanYen) || loanYen < 1000000 || loanYen > 1000000000) {
      return { ok: false, code: "invalid_loan" };
    }
    if (typeof ratePct !== "number" || !isFinite(ratePct) || ratePct < 0 || ratePct > 18) {
      return { ok: false, code: "invalid_rate" };
    }
    if (typeof years !== "number" || !isFinite(years) || years !== Math.floor(years) || years < 1 || years > 50) {
      return { ok: false, code: "invalid_years" };
    }
    var n = years * 12;
    var deltas = [0, 0.5, 1, 2];
    var rows = [];
    var baseMonthly = 0;
    for (var i = 0; i < deltas.length; i++) {
      var rate = Math.round((ratePct + deltas[i]) * 100) / 100;
      var m = monthlyFor(loanYen, rate, n);
      if (i === 0) baseMonthly = m;
      rows.push({ delta: deltas[i], rate: rate, monthly: m, total: m * n, monthlyDiff: m - baseMonthly });
    }
    return { ok: true, rows: rows };
  }

  /**
   * 買える物件価格の目安: 物件価格 = (借入額 + 頭金) ÷ (1 + 諸費用率/100)。
   * 諸費用(登記・仲介手数料等)は物件価格に比例(目安5〜10%)と仮定した概算。
   * 物件価格は円未満切り捨て、諸費用 = (借入額+頭金) − 物件価格。
   * @param {number} loanYen 借入額(円・100万〜10億)
   * @param {number} downYen 頭金(円・0〜10億)
   * @param {number} feePct 諸費用率(%・0〜20)
   * @returns {{ok:true, budget:number, fees:number}|{ok:false, code:string}}
   *   code: "invalid_loan" | "invalid_down" | "invalid_fee"
   */
  function propertyBudget(loanYen, downYen, feePct) {
    if (typeof loanYen !== "number" || !isFinite(loanYen) || loanYen < 1000000 || loanYen > 1000000000) {
      return { ok: false, code: "invalid_loan" };
    }
    if (typeof downYen !== "number" || !isFinite(downYen) || downYen < 0 || downYen > 1000000000) {
      return { ok: false, code: "invalid_down" };
    }
    if (typeof feePct !== "number" || !isFinite(feePct) || feePct < 0 || feePct > 20) {
      return { ok: false, code: "invalid_fee" };
    }
    var budget = Math.floor((loanYen + downYen) / (1 + feePct / 100));
    return { ok: true, budget: budget, fees: loanYen + downYen - budget };
  }

  var api = {
    propertyBudget: propertyBudget,
    rateScenarios: rateScenarios, borrowable: borrowable };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.KariireCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
