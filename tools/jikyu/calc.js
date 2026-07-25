/*
 * 時給⇔月収・年収 換算ロジック
 *
 * 計算式:
 * - 月収(額面) = 時給 × 1日の労働時間 × 月の勤務日数
 * - 年収(額面) = 月収 × 12
 * - 時給(逆算) = 月収 ÷ (1日の労働時間 × 月の勤務日数)
 *
 * 前提(ページにも明記):
 * - すべて「額面」(税金・社会保険料の控除前)。手取りは扶養・保険加入状況で
 *   大きく変わるため本ツールでは扱わない
 * - 残業代・賞与・交通費は含まない単純計算
 */
(function (global) {
  "use strict";

  var HOURLY_MIN_YEN = 100;
  var HOURLY_MAX_YEN = 100000;
  var MONTHLY_MIN_YEN = 10000;
  var MONTHLY_MAX_YEN = 100000000;
  var HOURS_MIN = 0.5;
  var HOURS_MAX = 24;
  var DAYS_MIN = 1;
  var DAYS_MAX = 31;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function validateWork(hoursPerDay, daysPerMonth) {
    if (!isFiniteNumber(hoursPerDay) || hoursPerDay < HOURS_MIN || hoursPerDay > HOURS_MAX) {
      return "invalid_hours";
    }
    if (!isFiniteNumber(daysPerMonth) || daysPerMonth !== Math.floor(daysPerMonth) ||
        daysPerMonth < DAYS_MIN || daysPerMonth > DAYS_MAX) {
      return "invalid_days";
    }
    return null;
  }

  /**
   * 時給→月収・年収(額面)。
   * @returns {{ok: true, monthlyYen: number, yearlyYen: number}|{ok: false, code: string}}
   *   code: "invalid_hourly" | "invalid_hours" | "invalid_days"
   */
  function toMonthly(hourlyYen, hoursPerDay, daysPerMonth) {
    if (!isFiniteNumber(hourlyYen) || hourlyYen < HOURLY_MIN_YEN || hourlyYen > HOURLY_MAX_YEN) {
      return { ok: false, code: "invalid_hourly" };
    }
    var workError = validateWork(hoursPerDay, daysPerMonth);
    if (workError) return { ok: false, code: workError };
    var monthly = Math.round(hourlyYen * hoursPerDay * daysPerMonth);
    return { ok: true, monthlyYen: monthly, yearlyYen: monthly * 12 };
  }

  /**
   * 月収→時給(額面)。
   * @returns {{ok: true, hourlyYen: number}|{ok: false, code: string}}
   *   code: "invalid_monthly" | "invalid_hours" | "invalid_days"
   */
  function toHourly(monthlyYen, hoursPerDay, daysPerMonth) {
    if (!isFiniteNumber(monthlyYen) || monthlyYen < MONTHLY_MIN_YEN || monthlyYen > MONTHLY_MAX_YEN) {
      return { ok: false, code: "invalid_monthly" };
    }
    var workError = validateWork(hoursPerDay, daysPerMonth);
    if (workError) return { ok: false, code: workError };
    return { ok: true, hourlyYen: Math.round(monthlyYen / (hoursPerDay * daysPerMonth)) };
  }

  var COMMUTE_MIN = 0;
  var COMMUTE_MAX = 300;

  /**
   * 通勤時間も労働とみなした場合の「実質時給」を計算する。
   * 実質時給 = (時給 × 労働時間 × 日数) ÷ ((労働時間 + 往復通勤時間) × 日数)
   * 通勤に賃金は出ないため、同じ月収を「家を出てから帰るまでの拘束時間」で
   * 割り直した値。円未満は四捨五入、月の通勤時間は小数第1位まで。
   * @param {number} hourlyYen 時給(円・100〜100,000)
   * @param {number} hoursPerDay 1日の労働時間(0.5〜24)
   * @param {number} daysPerMonth 月の勤務日数(1〜31・整数)
   * @param {number} commuteOneWayMin 片道の通勤時間(分・0〜300)
   * @returns {{ok: true, effectiveHourlyYen: number, monthlyYen: number,
   *            commuteHoursPerMonth: number, dropYen: number}
   *          |{ok: false, code: string}}
   *   dropYen: 額面時給との差(実質いくら目減りしているか)
   *   code: "invalid_hourly" | "invalid_hours" | "invalid_days" | "invalid_commute"
   */
  function effectiveHourly(hourlyYen, hoursPerDay, daysPerMonth, commuteOneWayMin) {
    if (!isFiniteNumber(hourlyYen) || hourlyYen < HOURLY_MIN_YEN || hourlyYen > HOURLY_MAX_YEN) {
      return { ok: false, code: "invalid_hourly" };
    }
    var workError = validateWork(hoursPerDay, daysPerMonth);
    if (workError) return { ok: false, code: workError };
    if (!isFiniteNumber(commuteOneWayMin) || commuteOneWayMin < COMMUTE_MIN || commuteOneWayMin > COMMUTE_MAX) {
      return { ok: false, code: "invalid_commute" };
    }
    var monthlyRaw = hourlyYen * hoursPerDay * daysPerMonth;
    var commuteHoursPerDay = commuteOneWayMin * 2 / 60;
    var effRaw = monthlyRaw / ((hoursPerDay + commuteHoursPerDay) * daysPerMonth);
    return {
      ok: true,
      effectiveHourlyYen: Math.round(effRaw),
      monthlyYen: Math.round(monthlyRaw),
      commuteHoursPerMonth: Math.round(commuteHoursPerDay * daysPerMonth * 10) / 10,
      dropYen: Math.round(hourlyYen - effRaw)
    };
  }

  var api = {
    effectiveHourly: effectiveHourly,
    toMonthly: toMonthly,
    toHourly: toHourly,
    HOURLY_MIN_YEN: HOURLY_MIN_YEN,
    HOURLY_MAX_YEN: HOURLY_MAX_YEN,
    MONTHLY_MIN_YEN: MONTHLY_MIN_YEN,
    MONTHLY_MAX_YEN: MONTHLY_MAX_YEN,
    HOURS_MIN: HOURS_MIN,
    HOURS_MAX: HOURS_MAX,
    DAYS_MIN: DAYS_MIN,
    DAYS_MAX: DAYS_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.JikyuCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
