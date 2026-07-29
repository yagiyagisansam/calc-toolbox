/*
 * 育児休業給付金の計算ロジック
 *
 * 根拠(一次情報):
 * - 厚生労働省・都道府県労働局・ハローワーク「令和7年8月1日から支給限度額が変更になります」
 *   https://www.mhlw.go.jp/content/001520023.pdf (2026年7月29日参照)
 *   育児休業給付金 支給上限額: 支給率67% = 323,811円 / 支給率50% = 241,650円
 *   出生時育児休業給付金 支給上限額: 支給率67% = 302,223円
 *   出生後休業支援給付金 支給上限額: 支給率13% = 58,640円
 * - ハローワークインターネットサービス「育児休業等給付」
 *   https://www.hellowork.mhlw.go.jp/insurance/insurance_childcareleave.html (2026年7月29日参照)
 *
 * 制度・金額の時点:
 * - 上限額は【令和7年8月1日〜令和8年7月31日】に適用される額。毎月勤労統計の平均定期給与額の
 *   増減をもとに毎年8月1日に改定されるため、それ以降は金額が変わる。
 * - 上限額から逆算した休業開始時賃金日額の上限は 16,110円
 *   (16,110円 × 30日 × 67% = 323,811円、× 30日 × 50% = 241,650円、× 28日 × 13% = 58,640円、
 *    × 28日 × 67% = 302,223円 と、公表されている4つの上限額すべてに一致する)。
 *
 * 前提:
 * - 休業開始時賃金日額 = 休業開始前6か月間の賃金総額 ÷ 180(1円未満切り捨て)。
 * - 支給単位期間は30日として計算する。支給率は休業開始から通算180日目まで67%、181日目以降50%。
 * - 賃金日額には下限額も定められているが、本計算では上限のみを扱う(下限に該当する場合、
 *   実際の支給額は本計算より多くなることがある)。
 * - 休業中に賃金の支払いがある場合の減額、社会保険料免除、税の非課税扱いは考慮しない。
 */
(function (global) {
  "use strict";

  var DAILY_WAGE_CAP = 16110; // 休業開始時賃金日額の上限(円、令和7年8月1日〜)
  var CAP_67 = 323811; // 育児休業給付金 支給上限額(支給率67%、支給日数30日)
  var CAP_50 = 241650; // 育児休業給付金 支給上限額(支給率50%、支給日数30日)
  var CAP_SANGO = 58640; // 出生後休業支援給付金 支給上限額(支給率13%、28日)
  var CAP_SHUSSHOJI = 302223; // 出生時育児休業給付金 支給上限額(支給率67%、28日)
  var UNIT_DAYS = 30; // 1支給単位期間の日数
  var MONTHS_67 = 6; // 67%が適用される支給単位期間の数(180日 ÷ 30日)
  var MONTHS_MAX = 24; // 育児休業給付の対象となる最長の月数(最長2歳まで)
  var WAGE_TOTAL_MAX = 100000000; // 6か月賃金総額の上限(円)

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /** 円未満を切り捨てる(給付額は1円未満切り捨てで計算する) */
  function yen(v) {
    return Math.floor(v);
  }

  /**
   * 休業開始時賃金日額を求める。
   * @param {number} wageTotal6m 休業開始前6か月間の賃金総額(円、0より大きい)
   * @param {boolean} [applyCap=true] 上限額(16,110円)を適用するか
   * @returns {{ok:true, dailyWage:number, dailyWageUsed:number, capped:boolean}
   *          |{ok:false, code:"invalid_wage"}}
   *   dailyWage: 計算上の賃金日額(円、1円未満切り捨て)
   *   dailyWageUsed: 上限適用後の賃金日額(円)
   *   capped: 上限に達したか
   */
  function dailyWage(wageTotal6m, applyCap) {
    if (!isFiniteNumber(wageTotal6m) || wageTotal6m <= 0 || wageTotal6m > WAGE_TOTAL_MAX) {
      return { ok: false, code: "invalid_wage" };
    }
    var cap = applyCap !== false;
    var raw = yen(wageTotal6m / 180);
    var used = cap ? Math.min(raw, DAILY_WAGE_CAP) : raw;
    return { ok: true, dailyWage: raw, dailyWageUsed: used, capped: cap && raw > DAILY_WAGE_CAP };
  }

  /**
   * 育児休業給付金の月額と総額を、67%期間と50%期間に分けて計算する。
   * @param {number} wageTotal6m 休業開始前6か月間の賃金総額(円)
   * @param {number} months 育休の月数(1〜24。1か月=支給単位期間30日として扱う)
   * @param {boolean} [applyCap=true] 支給上限額を適用するか
   * @returns {{ok:true, dailyWage:number, dailyWageUsed:number, capped:boolean,
   *            monthly67:number, monthly50:number, months67:number, months50:number,
   *            total67:number, total50:number, total:number}
   *          |{ok:false, code:"invalid_wage"|"invalid_months"}}
   *   monthly67/monthly50: 支給単位期間(30日)あたりの支給額(円、1円未満切り捨て)
   *   total: 育休期間全体の支給総額(円)
   */
  function calculate(wageTotal6m, months, applyCap) {
    var d = dailyWage(wageTotal6m, applyCap);
    if (!d.ok) return d;
    if (!isFiniteNumber(months) || months < 1 || months > MONTHS_MAX || Math.floor(months) !== months) {
      return { ok: false, code: "invalid_months" };
    }
    // 賃金日額 × 30日 × 給付率。整数どうしの計算にして浮動小数の誤差を避ける
    var monthly67 = yen(d.dailyWageUsed * UNIT_DAYS * 67 / 100);
    var monthly50 = yen(d.dailyWageUsed * UNIT_DAYS * 50 / 100);
    var months67 = Math.min(months, MONTHS_67);
    var months50 = Math.max(0, months - MONTHS_67);
    return {
      ok: true,
      dailyWage: d.dailyWage,
      dailyWageUsed: d.dailyWageUsed,
      capped: d.capped,
      monthly67: monthly67,
      monthly50: monthly50,
      months67: months67,
      months50: months50,
      total67: monthly67 * months67,
      total50: monthly50 * months50,
      total: monthly67 * months67 + monthly50 * months50
    };
  }

  /**
   * 出生後休業支援給付金(育児休業給付に13%を上乗せする給付。令和7年4月創設)を計算する。
   * @param {number} wageTotal6m 休業開始前6か月間の賃金総額(円)
   * @param {number} days 出生後休業の日数(1〜28。上限28日)
   * @param {boolean} [applyCap=true] 上限額を適用するか
   * @returns {{ok:true, dailyWageUsed:number, days:number, amount:number}
   *          |{ok:false, code:"invalid_wage"|"invalid_days"}}
   *   amount: 支給額(円、1円未満切り捨て。上限58,640円)
   */
  function sangoShien(wageTotal6m, days, applyCap) {
    var d = dailyWage(wageTotal6m, applyCap);
    if (!d.ok) return d;
    if (!isFiniteNumber(days) || days < 1 || days > 28 || Math.floor(days) !== days) {
      return { ok: false, code: "invalid_days" };
    }
    var amount = yen(d.dailyWageUsed * days * 13 / 100);
    if (applyCap !== false) amount = Math.min(amount, CAP_SANGO);
    return { ok: true, dailyWageUsed: d.dailyWageUsed, days: days, amount: amount };
  }

  /**
   * 出生時育児休業給付金(産後パパ育休。支給率67%、通算28日が上限)を計算する。
   * @param {number} wageTotal6m 休業開始前6か月間の賃金総額(円)
   * @param {number} days 出生時育児休業の日数(1〜28)
   * @param {boolean} [applyCap=true] 上限額を適用するか
   * @returns {{ok:true, dailyWageUsed:number, days:number, amount:number}
   *          |{ok:false, code:"invalid_wage"|"invalid_days"}}
   *   amount: 支給額(円、1円未満切り捨て。上限302,223円)
   */
  function shusshoji(wageTotal6m, days, applyCap) {
    var d = dailyWage(wageTotal6m, applyCap);
    if (!d.ok) return d;
    if (!isFiniteNumber(days) || days < 1 || days > 28 || Math.floor(days) !== days) {
      return { ok: false, code: "invalid_days" };
    }
    var amount = yen(d.dailyWageUsed * days * 67 / 100);
    if (applyCap !== false) amount = Math.min(amount, CAP_SHUSSHOJI);
    return { ok: true, dailyWageUsed: d.dailyWageUsed, days: days, amount: amount };
  }

  var api = {
    DAILY_WAGE_CAP: DAILY_WAGE_CAP,
    CAP_67: CAP_67,
    CAP_50: CAP_50,
    CAP_SANGO: CAP_SANGO,
    CAP_SHUSSHOJI: CAP_SHUSSHOJI,
    dailyWage: dailyWage,
    calculate: calculate,
    sangoShien: sangoShien,
    shusshoji: shusshoji
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.IkujiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
