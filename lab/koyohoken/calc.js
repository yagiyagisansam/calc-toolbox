/*
 * 雇用保険料 計算ロジック
 *
 * 根拠(一次情報):
 * - 厚生労働省「令和8(2026)年度 雇用保険料率のご案内」(令和8年4月1日〜令和9年3月31日)
 *   https://www.mhlw.go.jp/content/001692566.pdf (2026年7月29日参照)
 *   一般の事業 13.5/1000(労働者5・事業主8.5) / 農林水産・清酒製造の事業 15.5/1000(労働者6・事業主9.5)
 *   / 建設の事業 16.5/1000(労働者6・事業主10.5)
 * - 厚生労働省「令和7(2025)年度 雇用保険料率のご案内」(令和7年4月1日〜令和8年3月31日)
 *   https://www.mhlw.go.jp/content/001401966.pdf (2026年7月29日参照)
 * - 厚生労働省「雇用保険被保険者からの雇用保険料の控除方法」
 *   https://www.mhlw.go.jp/new-info/kobetu/roudou/gyousei/hoken/2020/dl/keizoku-20.pdf (2026年7月29日参照)
 *   賃金から源泉控除する場合、被保険者負担分の端数は50銭以下切り捨て・50銭1厘以上切り上げ。
 *
 * 前提:
 * - 保険料率は年度(4月1日〜翌年3月31日)ごとに告示される。本ロジックは令和7年度・令和8年度に対応。
 * - 「賃金総額」は税金や社会保険料を控除する前の総支給額(通勤手当・時間外手当などを含む)。
 *   賞与も雇用保険料の対象になる。
 * - 労災保険料は事業主が全額負担するため、ここでは扱わない(雇用保険分のみ)。
 * - 端数処理をしない生の金額(小数第2位まで)と、源泉控除時の端数処理後の整数額の両方を返す。
 */
(function (global) {
  "use strict";

  var WAGE_MAX = 1000000000; // 賃金総額の上限(10億円)。これを超える入力は誤入力とみなす

  // 年度ごとの料率(1000分のいくつ)
  // employee: 労働者負担 / benefit: 事業主負担のうち失業等給付・育児休業給付分
  // twoBiz: 事業主負担のうち雇用保険二事業分
  var RATES = {
    2026: {
      label: "令和8年度",
      period: "2026-04-01/2027-03-31",
      general: { employee: 5, benefit: 5, twoBiz: 3.5 },
      agriculture: { employee: 6, benefit: 6, twoBiz: 3.5 },
      construction: { employee: 6, benefit: 6, twoBiz: 4.5 }
    },
    2025: {
      label: "令和7年度",
      period: "2025-04-01/2026-03-31",
      general: { employee: 5.5, benefit: 5.5, twoBiz: 3.5 },
      agriculture: { employee: 6.5, benefit: 6.5, twoBiz: 3.5 },
      construction: { employee: 6.5, benefit: 6.5, twoBiz: 4.5 }
    }
  };

  var BUSINESS_TYPES = ["general", "agriculture", "construction"];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  // 小数第2位で四捨五入(表示用。円未満の端数は保持する)
  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  /**
   * 賃金から源泉控除するときの端数処理。
   * 50銭以下は切り捨て、50銭1厘以上は切り上げ(厚生労働省の控除方法に準拠)。
   * @param {number} v 端数処理前の金額(円)
   * @returns {number} 1円単位に丸めた金額
   */
  function roundDeduction(v) {
    var whole = Math.floor(v);
    var frac = v - whole;
    // 判定の単位は厘(0.001円)。50銭5厘(0.505円)のような端数も「50銭1厘以上」として
    // 切り上げられるよう、1厘未満だけを浮動小数の誤差対策として切り捨ててから比較する
    frac = Math.floor(frac * 1000 + 1e-6) / 1000;
    return frac <= 0.5 ? whole : whole + 1;
  }

  /**
   * 雇用保険料(労働者負担・事業主負担)を計算する。
   * @param {number} wage 賃金総額(円、税・社会保険料を引く前の総支給額)。0以上10億円以下
   * @param {string} businessType 事業の種類 "general"(一般) | "agriculture"(農林水産・清酒製造) | "construction"(建設)
   * @param {number} [fiscalYear=2026] 年度(西暦。2026=令和8年度、2025=令和7年度)
   * @returns {{ok:true, fiscalYear:number, fiscalYearLabel:string, period:string,
   *            employeeRate:number, employerRate:number, totalRate:number,
   *            employee:number, employer:number, total:number,
   *            employeeDeduction:number, employerBenefit:number, employerTwoBusiness:number}
   *          |{ok:false, code:"invalid_wage"|"invalid_business_type"|"invalid_fiscal_year"}}
   *   各rateは「1000分のいくつ」の値(例: 一般の事業の労働者負担なら5)。
   *   金額は円。employee/employer/total は小数第2位で四捨五入した端数処理前の金額、
   *   employeeDeduction は給与から控除するときの1円単位の金額。
   */
  function calculate(wage, businessType, fiscalYear) {
    if (fiscalYear === undefined || fiscalYear === null) fiscalYear = 2026;
    if (!isFiniteNumber(wage) || wage < 0 || wage > WAGE_MAX) {
      return { ok: false, code: "invalid_wage" };
    }
    if (typeof businessType !== "string" || BUSINESS_TYPES.indexOf(businessType) === -1) {
      return { ok: false, code: "invalid_business_type" };
    }
    if (!isFiniteNumber(fiscalYear) || !RATES[fiscalYear]) {
      return { ok: false, code: "invalid_fiscal_year" };
    }
    var year = RATES[fiscalYear];
    var r = year[businessType];
    var employerRate = r.benefit + r.twoBiz;
    var totalRate = r.employee + employerRate;

    var employee = wage * r.employee / 1000;
    var employer = wage * employerRate / 1000;

    return {
      ok: true,
      fiscalYear: fiscalYear,
      fiscalYearLabel: year.label,
      period: year.period,
      employeeRate: r.employee,
      employerRate: employerRate,
      totalRate: totalRate,
      employee: round2(employee),
      employer: round2(employer),
      total: round2(employee + employer),
      employeeDeduction: roundDeduction(employee),
      employerBenefit: round2(wage * r.benefit / 1000),
      employerTwoBusiness: round2(wage * r.twoBiz / 1000)
    };
  }

  /**
   * 年間の雇用保険料(月給12か月分＋賞与)をまとめて計算する。
   * @param {number} monthlyWage 1か月の賃金総額(円)
   * @param {number} bonusTotal 年間の賞与合計(円)。賞与がなければ0
   * @param {string} businessType 事業の種類("general"|"agriculture"|"construction")
   * @param {number} [fiscalYear=2026] 年度(西暦)
   * @returns {{ok:true, annualWage:number, employee:number, employer:number, total:number,
   *            fiscalYearLabel:string}
   *          |{ok:false, code:"invalid_wage"|"invalid_bonus"|"invalid_business_type"|"invalid_fiscal_year"}}
   */
  function annual(monthlyWage, bonusTotal, businessType, fiscalYear) {
    if (!isFiniteNumber(monthlyWage) || monthlyWage < 0 || monthlyWage > WAGE_MAX) {
      return { ok: false, code: "invalid_wage" };
    }
    if (!isFiniteNumber(bonusTotal) || bonusTotal < 0 || bonusTotal > WAGE_MAX) {
      return { ok: false, code: "invalid_bonus" };
    }
    var annualWage = monthlyWage * 12 + bonusTotal;
    var r = calculate(annualWage, businessType, fiscalYear);
    if (!r.ok) return r;
    return {
      ok: true,
      annualWage: round2(annualWage),
      employee: r.employee,
      employer: r.employer,
      total: r.total,
      fiscalYearLabel: r.fiscalYearLabel
    };
  }

  /**
   * 指定年度の料率表を返す(画面の表示用)。
   * @param {number} fiscalYear 年度(西暦。2026または2025)
   * @returns {{ok:true, fiscalYearLabel:string, period:string,
   *            rows:Array<{type:string, employee:number, employer:number,
   *                        benefit:number, twoBiz:number, total:number}>}
   *          |{ok:false, code:"invalid_fiscal_year"}}
   */
  function rateTable(fiscalYear) {
    if (!isFiniteNumber(fiscalYear) || !RATES[fiscalYear]) {
      return { ok: false, code: "invalid_fiscal_year" };
    }
    var y = RATES[fiscalYear];
    var rows = BUSINESS_TYPES.map(function (t) {
      var r = y[t];
      return {
        type: t,
        employee: r.employee,
        employer: r.benefit + r.twoBiz,
        benefit: r.benefit,
        twoBiz: r.twoBiz,
        total: r.employee + r.benefit + r.twoBiz
      };
    });
    return { ok: true, fiscalYearLabel: y.label, period: y.period, rows: rows };
  }

  var api = {
    calculate: calculate,
    annual: annual,
    rateTable: rateTable,
    roundDeduction: roundDeduction,
    BUSINESS_TYPES: BUSINESS_TYPES,
    WAGE_MAX: WAGE_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.KoyohokenCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
