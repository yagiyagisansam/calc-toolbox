/*
 * 傷病手当金(健康保険) の計算ロジック
 *
 * 根拠(一次情報):
 * - 健康保険法(大正11年法律第70号)第99条
 *   https://laws.e-gov.go.jp/law/211AC0000000070 (2026年7月29日参照)
 *   ・第1項: 労務に服することができなくなった日から起算して3日を経過した日から支給(待期3日)
 *   ・第2項: 1日につき「支給を始める日の属する月以前の直近の継続した12月間の各月の標準報酬月額を
 *            平均した額の30分の1に相当する額(5円未満切捨て・5円以上10円未満は10円に切上げ)」の
 *            3分の2に相当する金額(50銭未満切捨て・50銭以上1円未満は1円に切上げ)
 *   ・第2項ただし書: 標準報酬月額が定められている月が12月に満たない場合は、
 *            (1)直近の継続した各月の標準報酬月額の平均額の30分の1 と
 *            (2)支給開始日の属する年度の前年度9月30日における全被保険者の標準報酬月額の平均額の30分の1
 *            のいずれか少ない額を用いる
 *   ・第4項: 支給期間は、同一の傷病について支給を始めた日から通算して1年6月間
 *
 * 前提:
 * - 給与の支払いがない期間についての計算。会社から報酬を受けた場合の調整・出産手当金や
 *   障害年金等との併給調整は含まない
 * - 通算1年6月の上限は暦にもとづくため、日数での上限は「18か月×30日=540日」を目安として扱う
 * - 上記(2)の全被保険者の平均額は保険者が年度ごとに定める。既定値は入力で差し替えられる
 */
(function (global) {
  "use strict";

  var MONTHLY_MAX = 3000000; // 標準報酬月額の入力上限(円)。実際の等級上限より広くとる
  var DAYS_MAX = 1000; // 支給対象日数の入力上限(日)
  var LIMIT_DAYS = 540; // 通算1年6月の目安日数(18か月×30日)

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 健康保険法第99条第2項の「30分の1」の端数処理。
   * 1円の位が5円未満なら切捨て、5円以上10円未満なら10円に切上げ(=10円単位に四捨五入)。
   * @param {number} yen 30で割った直後の金額(円)
   * @returns {number} 10円単位に丸めた金額(円)
   */
  function roundTo10(yen) {
    return Math.round(yen / 10) * 10;
  }

  /**
   * 健康保険法第99条第2項の「3分の2」の端数処理。
   * 50銭未満切捨て・50銭以上1円未満切上げ(=1円単位に四捨五入)。
   * @param {number} yen 3分の2を掛けた直後の金額(円)
   * @returns {number} 1円単位に丸めた金額(円)
   */
  function roundTo1(yen) {
    return Math.round(yen);
  }

  /**
   * 計算の基礎に使う標準報酬月額の平均額を決める。
   * 被保険者期間が12か月以上ならそのまま、12か月未満なら全被保険者の平均額との少ない方。
   * @param {number} averageMonthlyYen 支給開始日以前の各月の標準報酬月額の平均額(円)。0〜300万
   * @param {number} monthsCovered 標準報酬月額が定められている月数(月)。1〜600
   * @param {number} [allInsuredAverageYen=320000] 全被保険者の標準報酬月額の平均額(円)
   * @returns {{ok:true, baseMonthlyYen:number, usedAllInsuredAverage:boolean}
   *          |{ok:false, code:"invalid_average"|"invalid_months"|"invalid_all_insured_average"}}
   */
  function baseMonthly(averageMonthlyYen, monthsCovered, allInsuredAverageYen) {
    var all = allInsuredAverageYen === undefined ? 320000 : allInsuredAverageYen;
    if (!isFiniteNumber(averageMonthlyYen) || averageMonthlyYen <= 0 || averageMonthlyYen > MONTHLY_MAX) {
      return { ok: false, code: "invalid_average" };
    }
    if (!isFiniteNumber(monthsCovered) || monthsCovered < 1 || monthsCovered > 600) {
      return { ok: false, code: "invalid_months" };
    }
    if (!isFiniteNumber(all) || all <= 0 || all > MONTHLY_MAX) {
      return { ok: false, code: "invalid_all_insured_average" };
    }
    if (monthsCovered >= 12) {
      return { ok: true, baseMonthlyYen: averageMonthlyYen, usedAllInsuredAverage: false };
    }
    var used = Math.min(averageMonthlyYen, all);
    return { ok: true, baseMonthlyYen: used, usedAllInsuredAverage: used === all && all < averageMonthlyYen };
  }

  /**
   * 1日あたりの傷病手当金の額を求める。
   * @param {number} averageMonthlyYen 標準報酬月額の平均額(円)。0超〜300万
   * @returns {{ok:true, per30Yen:number, dailyYen:number}
   *          |{ok:false, code:"invalid_average"}}
   *   per30Yen は「平均額÷30」を10円単位に丸めた額、dailyYen はその3分の2を1円単位に丸めた額。
   */
  function dailyAmount(averageMonthlyYen) {
    if (!isFiniteNumber(averageMonthlyYen) || averageMonthlyYen <= 0 || averageMonthlyYen > MONTHLY_MAX) {
      return { ok: false, code: "invalid_average" };
    }
    var per30 = roundTo10(averageMonthlyYen / 30);
    return { ok: true, per30Yen: per30, dailyYen: roundTo1((per30 * 2) / 3) };
  }

  /**
   * 支給対象日数から傷病手当金の総額を求める。
   * @param {number} averageMonthlyYen 標準報酬月額の平均額(円)。0超〜300万
   * @param {number} days 支給対象日数(日)。1〜1000
   * @param {number} [monthsCovered=12] 標準報酬月額が定められている月数(月)
   * @param {number} [allInsuredAverageYen=320000] 全被保険者の標準報酬月額の平均額(円)
   * @returns {{ok:true, baseMonthlyYen:number, per30Yen:number, dailyYen:number, days:number,
   *            totalYen:number, overLimit:boolean, limitDays:number}
   *          |{ok:false, code:string}}
   *   overLimit は通算1年6月の目安日数(540日)を超えているかどうか。
   */
  function calculate(averageMonthlyYen, days, monthsCovered, allInsuredAverageYen) {
    var months = monthsCovered === undefined ? 12 : monthsCovered;
    var b = baseMonthly(averageMonthlyYen, months, allInsuredAverageYen);
    if (!b.ok) return b;
    if (!isFiniteNumber(days) || days < 1 || days > DAYS_MAX) {
      return { ok: false, code: "invalid_days" };
    }
    var d = dailyAmount(b.baseMonthlyYen);
    if (!d.ok) return d;
    var wholeDays = Math.floor(days);
    return {
      ok: true,
      baseMonthlyYen: b.baseMonthlyYen,
      usedAllInsuredAverage: b.usedAllInsuredAverage,
      per30Yen: d.per30Yen,
      dailyYen: d.dailyYen,
      days: wholeDays,
      totalYen: d.dailyYen * wholeDays,
      overLimit: wholeDays > LIMIT_DAYS,
      limitDays: LIMIT_DAYS
    };
  }

  function isRealDate(y, m, d) {
    if (!isFiniteNumber(y) || !isFiniteNumber(m) || !isFiniteNumber(d)) return false;
    if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return false;
    var dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }

  function pad2(n) {
    return (n < 10 ? "0" : "") + n;
  }

  /**
   * 待期3日の起算日から、支給が始まる日(待期完成の翌日)を求める。
   * 健康保険法第99条第1項「労務に服することができなくなった日から起算して3日を経過した日」。
   * @param {number} year 労務不能になった最初の日の年(1900〜2200)
   * @param {number} month 月(1〜12)
   * @param {number} day 日(1〜31)
   * @returns {{ok:true, waitEndIso:string, firstPayableIso:string,
   *            firstPayableYear:number, firstPayableMonth:number, firstPayableDay:number}
   *          |{ok:false, code:"invalid_date"}}
   *   waitEndIso は待期3日目(起算日+2日)、firstPayableIso は支給開始日(起算日+3日)。
   */
  function firstPayableDate(year, month, day) {
    if (!isRealDate(year, month, day)) return { ok: false, code: "invalid_date" };
    var start = Date.UTC(year, month - 1, day);
    var waitEnd = new Date(start + 2 * 86400000);
    var first = new Date(start + 3 * 86400000);
    return {
      ok: true,
      waitEndIso: waitEnd.getUTCFullYear() + "-" + pad2(waitEnd.getUTCMonth() + 1) + "-" + pad2(waitEnd.getUTCDate()),
      firstPayableIso: first.getUTCFullYear() + "-" + pad2(first.getUTCMonth() + 1) + "-" + pad2(first.getUTCDate()),
      firstPayableYear: first.getUTCFullYear(),
      firstPayableMonth: first.getUTCMonth() + 1,
      firstPayableDay: first.getUTCDate()
    };
  }

  var api = {
    LIMIT_DAYS: LIMIT_DAYS,
    baseMonthly: baseMonthly,
    dailyAmount: dailyAmount,
    calculate: calculate,
    firstPayableDate: firstPayableDate
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.ShobyoCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
