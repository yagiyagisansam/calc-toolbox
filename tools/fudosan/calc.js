/*
 * 不動産投資 収支・損益分岐計算ロジック(ワンルーム〜1棟の概算)
 *
 * 計算の流れ:
 * 1) ローン: 元利均等返済の毎月返済額と初年度支払利息(月次残高から積算)
 * 2) 不動産所得(帳簿) = 家賃収入 −(管理費+固定資産税+雑費+減価償却費+支払利息)
 * 3) 赤字の場合は給与所得と損益通算して所得税・住民税の軽減(還付)額を計算
 *    ※土地取得に係る借入利息分の赤字は損益通算不可(租税特別措置法41条の4の2の趣旨)
 * 4) 年間キャッシュフロー = 家賃収入 − 現金経費 − 年間返済額 + 税効果
 *    (減価償却は現金支出でないため含めない)
 * 5) 損益分岐家賃 = キャッシュフローが0になる年間家賃を二分探索で逆算
 *
 * 税計算の前提(概算):
 * - 給与所得控除: 令和7年改正後の速算表(最低65万円)
 * - 基礎控除: 所得税58万円・住民税43万円(高所得での逓減・時限加算は未考慮)
 * - 所得税: 速算表+復興特別所得税2.1%(100円未満切捨)/ 住民税: 所得割10%(均等割・調整控除は未考慮)
 * - 課税所得は1,000円未満切捨
 */
(function (global) {
  "use strict";

  var BRACKETS = [
    [1950000, 0.05, 0],
    [3300000, 0.10, 97500],
    [6950000, 0.20, 427500],
    [9000000, 0.23, 636000],
    [18000000, 0.33, 1536000],
    [40000000, 0.40, 2796000],
    [Infinity, 0.45, 4796000]
  ];

  function salaryDeduction(gross) {
    if (gross <= 1900000) return Math.min(gross, 650000);
    if (gross <= 3600000) return gross * 0.3 + 80000;
    if (gross <= 6600000) return gross * 0.2 + 440000;
    if (gross <= 8500000) return gross * 0.1 + 1100000;
    return 1950000;
  }

  function incomeTaxOn(taxable) {
    var t = Math.floor(Math.max(0, taxable) / 1000) * 1000;
    for (var i = 0; i < BRACKETS.length; i++) {
      if (t <= BRACKETS[i][0]) {
        return Math.floor(t * BRACKETS[i][1] - BRACKETS[i][2]) > 0
          ? Math.floor((t * BRACKETS[i][1] - BRACKETS[i][2]) * 1.021 / 100) * 100
          : 0;
      }
    }
    return 0;
  }

  function residentTaxOn(taxable) {
    var t = Math.floor(Math.max(0, taxable) / 1000) * 1000;
    return Math.floor(t * 0.10 / 100) * 100;
  }

  function loanCalc(principal, ratePct, years) {
    var r = ratePct / 1200;
    var n = years * 12;
    var monthly = r === 0 ? principal / n : principal * r / (1 - Math.pow(1 + r, -n));
    monthly = Math.round(monthly);
    var bal = principal;
    var interest = 0;
    for (var m = 0; m < 12 && m < n; m++) {
      var im = bal * r;
      interest += im;
      bal = bal + im - monthly;
    }
    return { monthly: monthly, annualPay: monthly * 12, interestY1: Math.round(interest) };
  }

  function num(v, min, max) {
    return typeof v === "number" && isFinite(v) && v >= min && v <= max;
  }

  /**
   * 不動産投資の年間収支・税効果・損益分岐を計算する。
   * @param {Object} input
   *   rent: 年間家賃収入(円) / mgmtMonthly: 管理費等(円/月) /
   *   propTax: 固定資産税等(円/年) / misc: 雑費・修繕など(円/年) /
   *   depreciation: 減価償却費(円/年) /
   *   principal: 借入額(円) / ratePct: 金利(年%) / years: 返済期間(年) /
   *   landRatioPct: 借入のうち土地取得分の割合(%・省略時0) /
   *   salary: 本業の給与年収(円・額面) /
   *   socialIns: 社会保険料(円/年・省略時は給与の15%概算) /
   *   otherDeduction: その他の所得控除(円・省略時0)
   * @returns {{ok: true, monthly: number, annualPay: number, interestY1: number,
   *            realEstateIncome: number, disallowedLoss: number,
   *            taxBefore: number, taxAfter: number, taxEffect: number,
   *            annualCF: number, monthlyCF: number,
   *            breakEvenRent: number, breakEvenPct: number}
   *          |{ok: false, code: string}}
   *   taxEffect: 正=還付・軽減 / breakEvenPct: 損益分岐家賃÷入力家賃×100
   */
  function simulate(input) {
    if (!input || typeof input !== "object") return { ok: false, code: "invalid_input" };
    var rent = input.rent;
    var mgmt = input.mgmtMonthly;
    var propTax = input.propTax;
    var misc = input.misc;
    var dep = input.depreciation;
    var salary = input.salary;
    if (!num(rent, 1, 100000000)) return { ok: false, code: "invalid_rent" };
    if (!num(mgmt, 0, 10000000)) return { ok: false, code: "invalid_mgmt" };
    if (!num(propTax, 0, 100000000)) return { ok: false, code: "invalid_proptax" };
    if (!num(misc, 0, 100000000)) return { ok: false, code: "invalid_misc" };
    if (!num(dep, 0, 100000000)) return { ok: false, code: "invalid_dep" };
    if (!num(input.principal, 1, 1000000000)) return { ok: false, code: "invalid_principal" };
    if (!num(input.ratePct, 0, 20)) return { ok: false, code: "invalid_rate" };
    if (!num(input.years, 1, 50) || input.years !== Math.floor(input.years)) {
      return { ok: false, code: "invalid_years" };
    }
    var landRatio = input.landRatioPct == null ? 0 : input.landRatioPct;
    if (!num(landRatio, 0, 100)) return { ok: false, code: "invalid_landratio" };
    if (!num(salary, 0, 1000000000)) return { ok: false, code: "invalid_salary" };
    var si = input.socialIns == null ? Math.round(salary * 0.15) : input.socialIns;
    if (!num(si, 0, 1000000000)) return { ok: false, code: "invalid_socialins" };
    var otherDed = input.otherDeduction == null ? 0 : input.otherDeduction;
    if (!num(otherDed, 0, 1000000000)) return { ok: false, code: "invalid_deduction" };

    var loan = loanCalc(input.principal, input.ratePct, input.years);
    var landInterest = loan.interestY1 * landRatio / 100;
    var salaryInc = Math.max(0, salary - salaryDeduction(salary));

    function taxTotal(netREI) {
      var gross = Math.max(0, salaryInc + netREI);
      return incomeTaxOn(gross - si - otherDed - 580000) +
             residentTaxOn(gross - si - otherDed - 430000);
    }

    function evaluate(rentX) {
      var bookExpenses = mgmt * 12 + propTax + misc + dep + loan.interestY1;
      var rei = rentX - bookExpenses;
      var disallowed = 0;
      var netREI = rei;
      if (rei < 0) {
        disallowed = Math.min(-rei, landInterest);
        netREI = rei + disallowed;
      }
      var taxBefore = taxTotal(0);
      var taxAfter = taxTotal(netREI);
      var taxEffect = taxBefore - taxAfter;
      var cashExpenses = mgmt * 12 + propTax + misc;
      var annualCF = rentX - cashExpenses - loan.annualPay + taxEffect;
      return {
        rei: Math.round(rei),
        disallowed: Math.round(disallowed),
        taxBefore: taxBefore,
        taxAfter: taxAfter,
        taxEffect: taxEffect,
        annualCF: Math.round(annualCF)
      };
    }

    var base = evaluate(rent);

    // 損益分岐家賃(CF=0となる年間家賃)を二分探索
    var lo = 0;
    var hi = Math.max(rent, loan.annualPay + mgmt * 12 + propTax + misc + 1000000);
    while (evaluate(hi).annualCF < 0 && hi < 2000000000) hi *= 2;
    for (var i = 0; i < 60 && hi - lo > 1; i++) {
      var mid = Math.floor((lo + hi) / 2);
      if (evaluate(mid).annualCF >= 0) hi = mid; else lo = mid;
    }
    var breakEvenRent = hi;

    return {
      ok: true,
      monthly: loan.monthly,
      annualPay: loan.annualPay,
      interestY1: loan.interestY1,
      realEstateIncome: base.rei,
      disallowedLoss: base.disallowed,
      taxBefore: base.taxBefore,
      taxAfter: base.taxAfter,
      taxEffect: base.taxEffect,
      annualCF: base.annualCF,
      monthlyCF: Math.round(base.annualCF / 12),
      breakEvenRent: breakEvenRent,
      breakEvenPct: Math.round(breakEvenRent / rent * 1000) / 10
    };
  }

  var api = {
    simulate: simulate,
    salaryDeduction: salaryDeduction,
    incomeTaxOn: incomeTaxOn,
    residentTaxOn: residentTaxOn,
    loanCalc: loanCalc
  };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.FudosanCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
