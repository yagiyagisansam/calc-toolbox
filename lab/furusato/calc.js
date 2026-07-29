/*
 * ふるさと納税 控除上限額(自己負担2,000円で済む寄附額)の計算ロジック
 *
 * 根拠(一次情報):
 * - 総務省「ふるさと納税のしくみ:税金の控除について」
 *   https://www.soumu.go.jp/main_sosiki/jichi_zeisei/czaisei/czaisei_seido/furusato/mechanism/deduction.html
 *   (2026年7月29日参照)
 *   (1) 所得税の控除 = (ふるさと納税額 - 2,000円) × 所得税の税率
 *   (2) 住民税の控除(基本分) = (ふるさと納税額 - 2,000円) × 10%
 *   (3) 住民税の控除(特例分) = (ふるさと納税額 - 2,000円) × (100% - 10% - 所得税率 × 復興税率1.021)
 *       ただし特例分が住民税所得割額の20%を超える場合は (3)' = 住民税所得割額 × 20%
 *   → 自己負担が2,000円で済む上限は (3) が (3)' と等しくなる点。すなわち
 *     上限額 = 住民税所得割額 × 20% ÷ (100% - 10% - 所得税率 × 1.021) + 2,000円
 * - 国税庁「No.1410 給与所得控除」(令和7年分以降)
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1410.htm (2026年7月29日参照)
 * - 国税庁「No.1199 基礎控除」(令和7年分・令和8年分/令和9年分以後)
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1199.htm (2026年7月29日参照)
 * - 国税庁「No.2260 所得税の税率」(令和7年分以降の速算表)
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/2260.htm (2026年7月29日参照)
 * - 地方税法 第314条の2(所得控除): 住民税の基礎控除43万円、控除対象配偶者33万円
 *   https://laws.e-gov.go.jp/law/325AC0000000226 (2026年7月29日参照)
 *
 * 前提(2026年7月29日時点の制度):
 * - limitFromResidentTax は総務省の式そのままの計算。住民税の「所得割額」は
 *   住民税決定通知書(税額決定通知書)の市町村民税+道府県民税の所得割額の合計を入れる
 * - estimate は給与収入だけの人を想定した概算。ワンストップ特例/確定申告のどちらでも上限は同じ
 * - estimate は調整控除(通常2,500円程度)を考慮していないため、上限がやや大きめに出る
 * - 医療費控除・住宅ローン控除・iDeCo等がある場合は上限が下がる。estimate では
 *   「その他の所得控除」欄にまとめて入れることで概算できる
 * - 丸め: 上限額は1円未満切捨て。safeLimitYen は1,000円未満を切り捨てた安全側の目安
 */
(function (global) {
  "use strict";

  var RECONSTRUCTION_RATE = 1.021; // 復興特別所得税を含む係数
  var SPECIAL_SHARE = 0.20;        // 住民税特例分の上限(所得割額の20%)
  var BASIC_SHARE = 0.10;          // 住民税基本分の控除率(10%)
  var SELF_PAY = 2000;             // 自己負担額

  // 所得税の速算表(令和7年分以降): [課税所得の上限, 税率(%)]
  var RATE_TABLE = [
    [1949000, 5],
    [3299000, 10],
    [6949000, 20],
    [8999000, 23],
    [17999000, 33],
    [39999000, 40],
    [Infinity, 45]
  ];
  var ALLOWED_RATES = [0, 5, 10, 20, 23, 33, 40, 45];

  var RESIDENT_BASIC_DEDUCTION = 430000; // 住民税の基礎控除(合計所得2,400万円以下)
  var RESIDENT_SPOUSE_DEDUCTION = 330000; // 住民税の控除対象配偶者
  var INCOME_SPOUSE_DEDUCTION = 380000;   // 所得税の控除対象配偶者

  var MAX_INCOME = 500000000; // 入力上限 5億円

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 給与所得控除額(令和7年分以降)を求める。
   * @param {number} incomeYen 給与等の収入金額(円、0以上)
   * @returns {number} 給与所得控除額(円)
   */
  function salaryDeduction(incomeYen) {
    if (incomeYen <= 1900000) return 650000;
    if (incomeYen <= 3600000) return incomeYen * 0.30 + 80000;
    if (incomeYen <= 6600000) return incomeYen * 0.20 + 440000;
    if (incomeYen <= 8500000) return incomeYen * 0.10 + 1100000;
    return 1950000;
  }

  /**
   * 所得税の基礎控除額(令和7年分・令和8年分)を求める。
   * @param {number} totalIncomeYen 合計所得金額(円)
   * @returns {number} 基礎控除額(円)
   */
  function basicDeduction(totalIncomeYen) {
    if (totalIncomeYen <= 1320000) return 950000;
    if (totalIncomeYen <= 3360000) return 880000;
    if (totalIncomeYen <= 4890000) return 680000;
    if (totalIncomeYen <= 6550000) return 630000;
    if (totalIncomeYen <= 23500000) return 580000;
    if (totalIncomeYen <= 24000000) return 480000;
    if (totalIncomeYen <= 24500000) return 320000;
    if (totalIncomeYen <= 25000000) return 160000;
    return 0;
  }

  /**
   * 課税所得金額から所得税の税率(%)を求める。
   * @param {number} taxableYen 課税総所得金額(円)
   * @returns {number} 税率(百分率。0/5/10/20/23/33/40/45 のいずれか)
   */
  function taxRatePercent(taxableYen) {
    if (taxableYen <= 0) return 0;
    for (var i = 0; i < RATE_TABLE.length; i++) {
      if (taxableYen <= RATE_TABLE[i][0]) return RATE_TABLE[i][1];
    }
    return 45;
  }

  /**
   * 住民税所得割額と所得税率から、控除上限額(自己負担2,000円で済む寄附額)を求める。
   * これが総務省の式そのままの計算で、もっとも精度が高い。
   * @param {number} shotokuwariYen 住民税の所得割額(円。市町村民税+道府県民税の合計、0以上)
   * @param {number} ratePercent 所得税の税率(百分率。0/5/10/20/23/33/40/45)
   * @returns {{ok:true, limitYen:number, safeLimitYen:number, denominator:number}
   *          |{ok:false, code:"invalid_resident_tax"|"invalid_tax_rate"}}
   *   limitYen: 上限額(1円未満切捨て) / safeLimitYen: 1,000円未満を切り捨てた安全側の目安
   *   denominator: 式の分母 (100% - 10% - 所得税率×1.021) を小数で表したもの
   */
  function limitFromResidentTax(shotokuwariYen, ratePercent) {
    if (!isFiniteNumber(shotokuwariYen) || shotokuwariYen < 0 || shotokuwariYen > MAX_INCOME) {
      return { ok: false, code: "invalid_resident_tax" };
    }
    if (!isFiniteNumber(ratePercent) || ALLOWED_RATES.indexOf(ratePercent) < 0) {
      return { ok: false, code: "invalid_tax_rate" };
    }
    var denom = 1 - BASIC_SHARE - (ratePercent / 100) * RECONSTRUCTION_RATE;
    var raw = (shotokuwariYen * SPECIAL_SHARE) / denom + SELF_PAY;
    var limit = Math.floor(raw);
    return {
      ok: true,
      limitYen: limit,
      safeLimitYen: Math.floor(limit / 1000) * 1000,
      denominator: Math.round(denom * 100000) / 100000
    };
  }

  /**
   * 給与収入から控除上限額を概算する(給与所得のみの人を想定)。
   * @param {number} incomeYen 給与等の年間収入金額(円。額面。0以上5億円以下)
   * @param {number} socialInsuranceYen 社会保険料の年額(円。0以上)
   * @param {boolean} [hasSpouse] 配偶者控除を受ける場合 true
   * @param {number} [otherDeductionYen] その他の所得控除の合計(円。扶養控除・生命保険料控除など)
   * @returns {{ok:true, salaryIncomeYen:number, taxableIncomeYen:number, ratePercent:number,
   *            residentTaxableYen:number, shotokuwariYen:number,
   *            limitYen:number, safeLimitYen:number}
   *          |{ok:false, code:"invalid_income"|"invalid_social_insurance"|"invalid_other"
   *                          |"invalid_resident_tax"|"invalid_tax_rate"}}
   *   salaryIncomeYen: 給与所得(収入-給与所得控除) / taxableIncomeYen: 所得税の課税総所得金額
   *   shotokuwariYen: 住民税の所得割額(概算、調整控除は未考慮)
   */
  function estimate(incomeYen, socialInsuranceYen, hasSpouse, otherDeductionYen) {
    if (!isFiniteNumber(incomeYen) || incomeYen < 0 || incomeYen > MAX_INCOME) {
      return { ok: false, code: "invalid_income" };
    }
    var social = socialInsuranceYen === undefined || socialInsuranceYen === null ? 0 : socialInsuranceYen;
    if (!isFiniteNumber(social) || social < 0 || social > MAX_INCOME) {
      return { ok: false, code: "invalid_social_insurance" };
    }
    var other = otherDeductionYen === undefined || otherDeductionYen === null ? 0 : otherDeductionYen;
    if (!isFiniteNumber(other) || other < 0 || other > MAX_INCOME) {
      return { ok: false, code: "invalid_other" };
    }

    var salaryIncome = Math.max(0, incomeYen - salaryDeduction(incomeYen));

    var incomeSpouse = hasSpouse === true ? INCOME_SPOUSE_DEDUCTION : 0;
    var residentSpouse = hasSpouse === true ? RESIDENT_SPOUSE_DEDUCTION : 0;

    // 所得税: 課税総所得金額(1,000円未満切捨て)
    var taxable = Math.max(0, salaryIncome - social - basicDeduction(salaryIncome) - incomeSpouse - other);
    taxable = Math.floor(taxable / 1000) * 1000;
    var rate = taxRatePercent(taxable);

    // 住民税: 課税総所得金額(1,000円未満切捨て)→ 所得割額(標準税率10%)
    var residentTaxable = Math.max(0, salaryIncome - social - RESIDENT_BASIC_DEDUCTION - residentSpouse - other);
    residentTaxable = Math.floor(residentTaxable / 1000) * 1000;
    var shotokuwari = Math.floor(residentTaxable * 0.10);

    var r = limitFromResidentTax(shotokuwari, rate);
    if (!r.ok) return r;
    return {
      ok: true,
      salaryIncomeYen: salaryIncome,
      taxableIncomeYen: taxable,
      ratePercent: rate,
      residentTaxableYen: residentTaxable,
      shotokuwariYen: shotokuwari,
      limitYen: r.limitYen,
      safeLimitYen: r.safeLimitYen
    };
  }

  /**
   * 寄附額を決めたときの控除額の内訳(総務省の(1)(2)(3)の式)を求める。
   * @param {number} donationYen 寄附額(円)
   * @param {number} shotokuwariYen 住民税の所得割額(円)
   * @param {number} ratePercent 所得税の税率(百分率)
   * @returns {{ok:true, incomeTaxYen:number, residentBasicYen:number, residentSpecialYen:number,
   *            totalYen:number, selfPayYen:number, cappedBySpecialLimit:boolean}
   *          |{ok:false, code:"invalid_donation"|"invalid_resident_tax"|"invalid_tax_rate"}}
   *   selfPayYen: 実質の自己負担額(寄附額 - 控除額合計)。2,000円なら上限内
   */
  function breakdown(donationYen, shotokuwariYen, ratePercent) {
    if (!isFiniteNumber(donationYen) || donationYen < 0 || donationYen > MAX_INCOME) {
      return { ok: false, code: "invalid_donation" };
    }
    var base = limitFromResidentTax(shotokuwariYen, ratePercent);
    if (!base.ok) return base;

    var target = Math.max(0, donationYen - SELF_PAY);
    var incomeTax = target * (ratePercent / 100) * RECONSTRUCTION_RATE;
    var residentBasic = target * BASIC_SHARE;
    var special = target * base.denominator;
    var cap = shotokuwariYen * SPECIAL_SHARE;
    var capped = special > cap;
    if (capped) special = cap;

    var total = incomeTax + residentBasic + special;
    return {
      ok: true,
      incomeTaxYen: Math.floor(incomeTax),
      residentBasicYen: Math.floor(residentBasic),
      residentSpecialYen: Math.floor(special),
      totalYen: Math.floor(total),
      selfPayYen: Math.ceil(donationYen - total),
      cappedBySpecialLimit: capped
    };
  }

  var api = {
    salaryDeduction: salaryDeduction,
    basicDeduction: basicDeduction,
    taxRatePercent: taxRatePercent,
    limitFromResidentTax: limitFromResidentTax,
    estimate: estimate,
    breakdown: breakdown
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.FurusatoCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
