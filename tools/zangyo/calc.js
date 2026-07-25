/*
 * 残業代(割増賃金)計算ロジック
 *
 * 割増率の根拠(一次情報):
 * - 時間外労働: 25%以上 / 月60時間を超える時間外: 50%以上 / 深夜労働(22時〜5時): 25%以上を加算
 *   出典: 労働基準法 第37条 https://laws.e-gov.go.jp/law/322AC0000000049
 * - 法定休日労働: 35%以上
 *   出典: 労働基準法第37条第1項の割増賃金に係る率の最低限度を定める政令
 *   https://laws.e-gov.go.jp/law/406CO0000000005
 *
 * 前提(ページにも明記):
 * - 法定の最低割増率(25%/50%/35%/深夜+25%)で計算。会社の規定がこれより高い場合は実額も高くなる
 * - 深夜分は「加算分(+25%)のみ」を表示(深夜の基本部分1.0は通常の賃金に含まれるため)
 * - 基礎時給は割増賃金の算定基礎(家族手当・通勤手当等の除外賃金を除いたもの)
 */
(function (global) {
  "use strict";

  var HOURLY_MIN_YEN = 500;
  var HOURLY_MAX_YEN = 50000;
  var HOURS_MIN = 0;
  var HOURS_MAX = 200;
  var MONTHLY_MIN_YEN = 50000;
  var MONTHLY_MAX_YEN = 10000000;
  var AVG_HOURS_MIN = 100;
  var AVG_HOURS_MAX = 200;

  var RATE_OVERTIME = 1.25;
  var RATE_OVERTIME_OVER60 = 1.5;
  var RATE_HOLIDAY = 1.35;
  var RATE_LATE_NIGHT_EXTRA = 0.25;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function validHours(v) {
    return isFiniteNumber(v) && v >= HOURS_MIN && v <= HOURS_MAX;
  }

  /**
   * 月給から基礎時給を求める。
   * @param {number} monthlyYen 月給のうち割増の算定基礎となる額(円)
   * @param {number} avgMonthlyHours 月平均所定労働時間
   * @returns {{ok: true, hourlyYen: number}|{ok: false, code: string}}
   *   code: "invalid_monthly" | "invalid_avg_hours"
   */
  function hourlyFromMonthly(monthlyYen, avgMonthlyHours) {
    if (!isFiniteNumber(monthlyYen) || monthlyYen < MONTHLY_MIN_YEN || monthlyYen > MONTHLY_MAX_YEN) {
      return { ok: false, code: "invalid_monthly" };
    }
    if (!isFiniteNumber(avgMonthlyHours) || avgMonthlyHours < AVG_HOURS_MIN || avgMonthlyHours > AVG_HOURS_MAX) {
      return { ok: false, code: "invalid_avg_hours" };
    }
    return { ok: true, hourlyYen: Math.round(monthlyYen / avgMonthlyHours) };
  }

  /**
   * 残業代(割増賃金)を計算する。
   * @param {number} baseHourlyYen 基礎時給(円)
   * @param {number} overtimeHours 時間外労働時間(月60時間以内の分)
   * @param {number} overtime60Hours 月60時間を超える時間外労働時間
   * @param {number} holidayHours 法定休日労働時間
   * @param {number} lateNightHours 深夜(22時〜5時)労働時間
   * @returns {{ok: true, overtimePay: number, overtime60Pay: number, holidayPay: number,
   *            lateNightExtra: number, totalPay: number}|{ok: false, code: string}}
   *   code: "invalid_hourly" | "invalid_hours"
   */
  function calculate(baseHourlyYen, overtimeHours, overtime60Hours, holidayHours, lateNightHours) {
    if (!isFiniteNumber(baseHourlyYen) || baseHourlyYen < HOURLY_MIN_YEN || baseHourlyYen > HOURLY_MAX_YEN) {
      return { ok: false, code: "invalid_hourly" };
    }
    if (!validHours(overtimeHours) || !validHours(overtime60Hours) ||
        !validHours(holidayHours) || !validHours(lateNightHours)) {
      return { ok: false, code: "invalid_hours" };
    }
    var overtimePay = Math.round(baseHourlyYen * RATE_OVERTIME * overtimeHours);
    var overtime60Pay = Math.round(baseHourlyYen * RATE_OVERTIME_OVER60 * overtime60Hours);
    var holidayPay = Math.round(baseHourlyYen * RATE_HOLIDAY * holidayHours);
    var lateNightExtra = Math.round(baseHourlyYen * RATE_LATE_NIGHT_EXTRA * lateNightHours);
    return {
      ok: true,
      overtimePay: overtimePay,
      overtime60Pay: overtime60Pay,
      holidayPay: holidayPay,
      lateNightExtra: lateNightExtra,
      totalPay: overtimePay + overtime60Pay + holidayPay + lateNightExtra
    };
  }

  var PAID_MIN_YEN = 0;
  var PAID_MAX_YEN = 10000000;

  /**
   * 月の時間外合計から、60時間超の分を自動で振り分けて残業代を計算する。
   * 割増率は労働基準法第37条の法定最低率:
   * - 時間外労働(月60時間以内): 25%(労働基準法第37条第1項本文)
   * - 月60時間を超える時間外労働: 50%(同条第1項ただし書)
   * - 法定休日労働: 35%(労働基準法第37条第1項の割増賃金に係る率の
   *   最低限度を定める政令)
   * - 深夜労働(22時〜5時): 25%を加算(同条第4項)。深夜分は加算分のみ計上
   * 各区分の金額は円未満を四捨五入して合算する。
   * @param {number} baseHourlyYen 基礎時給(円・500〜50,000)
   * @param {number} totalOvertimeHours 月の時間外労働の合計(時間・0〜200)。
   *        60時間以内は25%、超えた分は50%で自動計算
   * @param {number} holidayHours 法定休日労働(時間・0〜200)
   * @param {number} lateNightHours 深夜労働(時間・0〜200)
   * @param {number} [paidYen] 実際に支払われた残業代(円・0〜10,000,000)。
   *        指定すると不足額 shortfallYen も返す
   * @returns {{ok: true, within60Hours: number, over60Hours: number,
   *            overtimePay: number, overtime60Pay: number, holidayPay: number,
   *            lateNightExtra: number, totalPay: number, shortfallYen?: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_hourly" | "invalid_hours" | "invalid_paid"
   */
  function calculateDetailed(baseHourlyYen, totalOvertimeHours, holidayHours, lateNightHours, paidYen) {
    if (!isFiniteNumber(baseHourlyYen) || baseHourlyYen < HOURLY_MIN_YEN || baseHourlyYen > HOURLY_MAX_YEN) {
      return { ok: false, code: "invalid_hourly" };
    }
    if (!validHours(totalOvertimeHours) || !validHours(holidayHours) || !validHours(lateNightHours)) {
      return { ok: false, code: "invalid_hours" };
    }
    var hasPaid = paidYen !== undefined && paidYen !== null;
    if (hasPaid && (!isFiniteNumber(paidYen) || paidYen < PAID_MIN_YEN || paidYen > PAID_MAX_YEN)) {
      return { ok: false, code: "invalid_paid" };
    }
    var within60 = Math.min(totalOvertimeHours, 60);
    var over60 = Math.max(0, totalOvertimeHours - 60);
    var overtimePay = Math.round(baseHourlyYen * RATE_OVERTIME * within60);
    var overtime60Pay = Math.round(baseHourlyYen * RATE_OVERTIME_OVER60 * over60);
    var holidayPay = Math.round(baseHourlyYen * RATE_HOLIDAY * holidayHours);
    var lateNightExtra = Math.round(baseHourlyYen * RATE_LATE_NIGHT_EXTRA * lateNightHours);
    var total = overtimePay + overtime60Pay + holidayPay + lateNightExtra;
    var out = {
      ok: true,
      within60Hours: within60,
      over60Hours: over60,
      overtimePay: overtimePay,
      overtime60Pay: overtime60Pay,
      holidayPay: holidayPay,
      lateNightExtra: lateNightExtra,
      totalPay: total
    };
    if (hasPaid) out.shortfallYen = total - paidYen;
    return out;
  }

  var api = {
    calculateDetailed: calculateDetailed,
    calculate: calculate,
    hourlyFromMonthly: hourlyFromMonthly,
    HOURLY_MIN_YEN: HOURLY_MIN_YEN,
    HOURLY_MAX_YEN: HOURLY_MAX_YEN,
    HOURS_MAX: HOURS_MAX,
    AVG_HOURS_MIN: AVG_HOURS_MIN,
    AVG_HOURS_MAX: AVG_HOURS_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.ZangyoCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
