/*
 * 家賃日割り計算ロジック(入居日・退去日から)
 *
 * 計算方法:
 * - 実日数方式: 日割り家賃 = 月額家賃 × 対象日数 ÷ その月の実日数(28〜31日)
 * - 30日固定方式: 日割り家賃 = 月額家賃 × 対象日数 ÷ 30
 * - 入居(movein)は「入居日〜月末」、退去(moveout)は「月初〜退去日」の日数
 * - 円未満は切り捨て。月額を超える場合は月額で頭打ち
 * - どちらの方式を使うかは賃貸借契約による(ページに明記)
 */
(function (global) {
  "use strict";

  var YEAR_MIN = 1900;
  var YEAR_MAX = 2200;

  function isLeapYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }

  function daysInMonth(y, m) {
    return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }

  function parseDate(iso) {
    if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    var y = parseInt(iso.slice(0, 4), 10);
    var m = parseInt(iso.slice(5, 7), 10);
    var d = parseInt(iso.slice(8, 10), 10);
    if (y < YEAR_MIN || y > YEAR_MAX) return null;
    if (m < 1 || m > 12) return null;
    if (d < 1 || d > daysInMonth(y, m)) return null;
    return { y: y, m: m, d: d };
  }

  /**
   * 家賃の日割り額を計算する。
   * @param {number} rent 月額家賃(円)
   * @param {string} iso 入居日または退去日 "YYYY-MM-DD"
   * @param {string} mode "movein"(入居日〜月末) | "moveout"(月初〜退去日)
   * @returns {{ok: true, days: number, daysInMonth: number,
   *            actual: number, by30: number}
   *          |{ok: false, code: string}}
   *   days: 日割り対象日数 / actual: 実日数方式の金額 / by30: 30日固定方式の金額
   *   code: "invalid_rent" | "invalid_date" | "invalid_mode"
   */
  function prorate(rent, iso, mode) {
    if (typeof rent !== "number" || !isFinite(rent) || rent <= 0 || rent > 10000000) {
      return { ok: false, code: "invalid_rent" };
    }
    var p = parseDate(iso);
    if (!p) return { ok: false, code: "invalid_date" };
    if (mode !== "movein" && mode !== "moveout") {
      return { ok: false, code: "invalid_mode" };
    }
    var dim = daysInMonth(p.y, p.m);
    var days = mode === "movein" ? dim - p.d + 1 : p.d;
    return {
      ok: true,
      days: days,
      daysInMonth: dim,
      actual: Math.min(rent, Math.floor(rent * days / dim)),
      by30: Math.min(rent, Math.floor(rent * days / 30))
    };
  }

  var api = {
    prorate: prorate,
    YEAR_MIN: YEAR_MIN,
    YEAR_MAX: YEAR_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.HiwariCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
