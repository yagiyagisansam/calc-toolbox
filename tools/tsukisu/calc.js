/*
 * ○ヶ月後・月数計算ロジック
 *
 * 計算方法:
 * - ○ヶ月後 = 月に加算し、日はそのまま。相手の月に同じ日がなければ月末に丸める
 *   (1/31の1ヶ月後 → 2/28(うるう年は2/29))
 * - 月数差 = 年月の差から、日が足りなければ1ヶ月引く(満○ヶ月の数え方)
 */
(function (global) {
  "use strict";

  var YEAR_MIN = 1900;
  var YEAR_MAX = 2200;

  function isLeapYear(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function daysInMonth(y, m) {
    return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }
  function parseDate(iso) {
    if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    var y = parseInt(iso.slice(0, 4), 10);
    var m = parseInt(iso.slice(5, 7), 10);
    var d = parseInt(iso.slice(8, 10), 10);
    if (y < YEAR_MIN || y > YEAR_MAX || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
    return { y: y, m: m, d: d };
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /**
   * ○ヶ月後(前)の日付を計算する(月末調整つき)。
   * @param {string} iso 基準日 "YYYY-MM-DD"
   * @param {number} n 加算する月数(-1200〜1200。負は○ヶ月前)
   * @returns {{ok: true, date: string, clamped: boolean}|{ok: false, code: string}}
   *   clamped: 月末調整が発生したか / code: "invalid_date" | "invalid_n" | "out_of_range"
   */
  function addMonths(iso, n) {
    var p = parseDate(iso);
    if (!p) return { ok: false, code: "invalid_date" };
    if (typeof n !== "number" || !isFinite(n) || n !== Math.floor(n) || n < -1200 || n > 1200) {
      return { ok: false, code: "invalid_n" };
    }
    var total = p.y * 12 + (p.m - 1) + n;
    var y = Math.floor(total / 12);
    var m = total - y * 12 + 1;
    if (y < YEAR_MIN || y > YEAR_MAX) return { ok: false, code: "out_of_range" };
    var dim = daysInMonth(y, m);
    var d = Math.min(p.d, dim);
    return { ok: true, date: y + "-" + pad(m) + "-" + pad(d), clamped: d !== p.d };
  }

  /**
   * 2つの日付の月数差(満○ヶ月)と残り日数を計算する。
   * @returns {{ok: true, months: number, extraDays: number}|{ok: false, code: string}}
   */
  function monthsBetween(fromIso, toIso) {
    var a = parseDate(fromIso);
    var b = parseDate(toIso);
    if (!a) return { ok: false, code: "invalid_date" };
    if (!b) return { ok: false, code: "invalid_date" };
    if (b.y * 10000 + b.m * 100 + b.d < a.y * 10000 + a.m * 100 + a.d) {
      return { ok: false, code: "date_order" };
    }
    var months = (b.y - a.y) * 12 + (b.m - a.m);
    if (b.d < a.d) months--;
    // 残り日数: from に months ヶ月足した日から to まで
    var base = addMonths(fromIso, months);
    var bp = parseDate(base.date);
    function serial(x) {
      var yy = x.y - (x.m <= 2 ? 1 : 0);
      var era = Math.floor(yy / 400);
      var yoe = yy - era * 400;
      var doy = Math.floor((153 * (x.m + (x.m > 2 ? -3 : 9)) + 2) / 5) + x.d - 1;
      return era * 146097 + yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy - 719468;
    }
    return { ok: true, months: months, extraDays: serial(b) - serial(bp) };
  }

  var api = { addMonths: addMonths, monthsBetween: monthsBetween };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.TsukisuCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
