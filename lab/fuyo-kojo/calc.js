/*
 * 扶養控除・配偶者控除の判定ロジック(令和7年分以後の所得税)
 *
 * 根拠(一次情報):
 * - 国税庁 タックスアンサー No.1410「給与所得控除」(令和7年分以後)
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1410.htm (2026年7月29日参照・令和7年4月1日現在法令等)
 * - 国税庁 タックスアンサー No.1180「扶養控除」
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1180.htm (2026年7月29日参照・令和7年4月1日現在法令等)
 * - 国税庁 タックスアンサー No.1177「特定親族特別控除」(令和7年分以後に創設)
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1177.htm (2026年7月29日参照・令和7年4月1日現在法令等)
 * - 国税庁 タックスアンサー No.1191「配偶者控除」
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1191.htm (2026年7月29日参照・令和7年4月1日現在法令等)
 * - 国税庁 タックスアンサー No.1195「配偶者特別控除」
 *   https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1195.htm (2026年7月29日参照・令和7年4月1日現在法令等)
 *
 * 前提:
 * - 令和7年度税制改正後(令和7年12月1日施行・令和7年分以後の所得税に適用)の金額
 *   給与所得控除の最低額65万円、扶養親族等の合計所得金額の要件58万円(給与収入123万円)
 * - 所得は給与収入のみとして計算する。事業所得・年金・株式等の所得がある場合は使えない
 * - 所得税の所得控除のみ。住民税の控除額(扶養控除33万円など)や社会保険の扶養(130万円の壁)は別制度
 * - 年齢はその年の12月31日現在で判定する
 * - 非居住者である親族の追加要件、障害者控除、ひとり親控除は含まない
 * - 金額はすべて円単位で扱い、控除額は表どおりの整数
 */
(function (global) {
  "use strict";

  var MAX_SALARY = 1000000000; // 給与収入の上限: 10億円
  var MAX_AGE = 130;

  // 給与所得控除(令和7年分以後)。[収入の上限(円), 率, 加算額(円)]。率0のときは加算額が控除額そのもの
  var SALARY_DEDUCTION = [
    [1900000, 0, 650000],
    [3600000, 0.30, 80000],
    [6600000, 0.20, 440000],
    [8500000, 0.10, 1100000],
    [Infinity, 0, 1950000]
  ];

  // 特定親族特別控除(No.1177)。[合計所得金額の上限(円), 控除額(円)]
  var SPECIFIC_RELATIVE = [
    [850000, 630000],
    [900000, 610000],
    [950000, 510000],
    [1000000, 410000],
    [1050000, 310000],
    [1100000, 210000],
    [1150000, 110000],
    [1200000, 60000],
    [1230000, 30000]
  ];

  // 配偶者特別控除(No.1195)。[配偶者の合計所得金額の上限(円), [本人900万以下, 900超950以下, 950超1000以下]]
  var SPOUSE_SPECIAL = [
    [950000, [380000, 260000, 130000]],
    [1000000, [360000, 240000, 120000]],
    [1050000, [310000, 210000, 110000]],
    [1100000, [260000, 180000, 90000]],
    [1150000, [210000, 140000, 70000]],
    [1200000, [160000, 110000, 60000]],
    [1250000, [110000, 80000, 40000]],
    [1300000, [60000, 40000, 20000]],
    [1330000, [30000, 20000, 10000]]
  ];

  // 配偶者控除(No.1191)。[本人900万以下, 900超950以下, 950超1000以下]
  var SPOUSE_NORMAL = [380000, 260000, 130000];
  var SPOUSE_ELDERLY = [480000, 320000, 160000]; // 70歳以上の老人控除対象配偶者

  var DEPENDENT_LIMIT = 580000; // 扶養親族等の合計所得金額の要件(58万円)

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function isAge(v) {
    return isFiniteNumber(v) && v >= 0 && v <= MAX_AGE && Math.floor(v) === v;
  }

  /**
   * 給与収入から給与所得控除額と合計所得金額(給与所得)を求める(令和7年分以後)。
   * @param {number} salaryYen 給与収入(円。源泉徴収票の「支払金額」)
   * @returns {{ok:true, deductionYen:number, incomeYen:number}
   *          |{ok:false, code:"invalid_salary"}}
   *   deductionYen は給与所得控除額(収入を超えないよう収入額で頭打ち)、
   *   incomeYen は給与所得(=合計所得金額)。いずれも1円未満切り捨て。
   */
  function salaryToIncome(salaryYen) {
    if (!isFiniteNumber(salaryYen) || salaryYen < 0 || salaryYen > MAX_SALARY) {
      return { ok: false, code: "invalid_salary" };
    }
    var deduction = 0;
    for (var i = 0; i < SALARY_DEDUCTION.length; i++) {
      if (salaryYen <= SALARY_DEDUCTION[i][0]) {
        deduction = salaryYen * SALARY_DEDUCTION[i][1] + SALARY_DEDUCTION[i][2];
        break;
      }
    }
    deduction = Math.min(Math.floor(deduction), salaryYen);
    return { ok: true, deductionYen: deduction, incomeYen: Math.floor(salaryYen - deduction) };
  }

  /**
   * 扶養親族の給与収入と年齢から、扶養控除(または特定親族特別控除)の額を判定する。
   * @param {number} salaryYen 扶養親族の給与収入(円)
   * @param {number} age その年の12月31日現在の年齢(0以上の整数)
   * @param {boolean} cohabitingElderly 70歳以上で「同居老親等」に当たるか(納税者本人または配偶者の直系尊属で同居)
   * @returns {{ok:true, incomeYen:number, kind:"under16"|"general"|"specific"|"elderly"|"elderly_cohabiting"|"specific_special"|"none",
   *            deductionYen:number, eligible:boolean, limitSalaryYen:number}
   *          |{ok:false, code:"invalid_salary"|"invalid_age"|"invalid_cohabiting"}}
   *   kind の意味: under16=16歳未満で控除対象外 / general=一般の控除対象扶養親族38万円 /
   *   specific=特定扶養親族63万円 / elderly=老人扶養親族48万円 / elderly_cohabiting=同居老親等58万円 /
   *   specific_special=特定親族特別控除(19〜22歳で所得58万円超123万円以下) / none=控除なし
   *   limitSalaryYen は扶養控除を受けられる給与収入の上限(1,230,000円)。
   */
  function dependentDeduction(salaryYen, age, cohabitingElderly) {
    var s = salaryToIncome(salaryYen);
    if (!s.ok) return s;
    if (!isAge(age)) return { ok: false, code: "invalid_age" };
    if (cohabitingElderly === undefined) cohabitingElderly = false;
    if (typeof cohabitingElderly !== "boolean") return { ok: false, code: "invalid_cohabiting" };

    var income = s.incomeYen;
    var base = { ok: true, incomeYen: income, limitSalaryYen: 1230000 };

    if (income <= DEPENDENT_LIMIT) {
      if (age < 16) {
        base.kind = "under16";
        base.deductionYen = 0;
        base.eligible = false;
      } else if (age < 19) {
        base.kind = "general";
        base.deductionYen = 380000;
        base.eligible = true;
      } else if (age < 23) {
        base.kind = "specific";
        base.deductionYen = 630000;
        base.eligible = true;
      } else if (age < 70) {
        base.kind = "general";
        base.deductionYen = 380000;
        base.eligible = true;
      } else {
        base.kind = cohabitingElderly ? "elderly_cohabiting" : "elderly";
        base.deductionYen = cohabitingElderly ? 580000 : 480000;
        base.eligible = true;
      }
      return base;
    }

    // 所得58万円超。19歳以上23歳未満なら特定親族特別控除の対象になりうる
    if (age >= 19 && age < 23) {
      for (var i = 0; i < SPECIFIC_RELATIVE.length; i++) {
        if (income <= SPECIFIC_RELATIVE[i][0]) {
          base.kind = "specific_special";
          base.deductionYen = SPECIFIC_RELATIVE[i][1];
          base.eligible = true;
          return base;
        }
      }
    }
    base.kind = "none";
    base.deductionYen = 0;
    base.eligible = false;
    return base;
  }

  /**
   * 配偶者の給与収入と納税者本人の合計所得金額から、配偶者控除・配偶者特別控除の額を判定する。
   * @param {number} spouseSalaryYen 配偶者の給与収入(円)
   * @param {number} spouseAge 配偶者のその年12月31日現在の年齢(0以上の整数)
   * @param {number} taxpayerIncomeYen 納税者本人の合計所得金額(円。給与のみなら salaryToIncome() の incomeYen)
   * @returns {{ok:true, spouseIncomeYen:number, tier:0|1|2|-1,
   *            kind:"spouse"|"spouse_elderly"|"spouse_special"|"none"|"over_taxpayer_income",
   *            deductionYen:number, eligible:boolean}
   *          |{ok:false, code:"invalid_salary"|"invalid_age"|"invalid_taxpayer_income"}}
   *   tier は本人所得の区分(0=900万円以下 / 1=900万超950万以下 / 2=950万超1,000万以下 / -1=1,000万円超で対象外)。
   *   kind の意味: spouse=配偶者控除 / spouse_elderly=老人控除対象配偶者(70歳以上) /
   *   spouse_special=配偶者特別控除 / none=所得超過で控除なし / over_taxpayer_income=本人の所得が1,000万円超
   */
  function spouseDeduction(spouseSalaryYen, spouseAge, taxpayerIncomeYen) {
    var s = salaryToIncome(spouseSalaryYen);
    if (!s.ok) return s;
    if (!isAge(spouseAge)) return { ok: false, code: "invalid_age" };
    if (!isFiniteNumber(taxpayerIncomeYen) || taxpayerIncomeYen < 0 || taxpayerIncomeYen > MAX_SALARY) {
      return { ok: false, code: "invalid_taxpayer_income" };
    }

    var income = s.incomeYen;
    if (taxpayerIncomeYen > 10000000) {
      return {
        ok: true, spouseIncomeYen: income, tier: -1,
        kind: "over_taxpayer_income", deductionYen: 0, eligible: false
      };
    }
    var tier = taxpayerIncomeYen <= 9000000 ? 0 : (taxpayerIncomeYen <= 9500000 ? 1 : 2);

    if (income <= DEPENDENT_LIMIT) {
      var elderly = spouseAge >= 70;
      return {
        ok: true, spouseIncomeYen: income, tier: tier,
        kind: elderly ? "spouse_elderly" : "spouse",
        deductionYen: (elderly ? SPOUSE_ELDERLY : SPOUSE_NORMAL)[tier],
        eligible: true
      };
    }
    for (var i = 0; i < SPOUSE_SPECIAL.length; i++) {
      if (income <= SPOUSE_SPECIAL[i][0]) {
        return {
          ok: true, spouseIncomeYen: income, tier: tier,
          kind: "spouse_special", deductionYen: SPOUSE_SPECIAL[i][1][tier], eligible: true
        };
      }
    }
    return { ok: true, spouseIncomeYen: income, tier: tier, kind: "none", deductionYen: 0, eligible: false };
  }

  var api = {
    salaryToIncome: salaryToIncome,
    dependentDeduction: dependentDeduction,
    spouseDeduction: spouseDeduction
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.FuyoKojoCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
