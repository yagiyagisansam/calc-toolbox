/*
 * 入学・卒業年計算ロジック
 *
 * 計算方法:
 * - 学年は「4月2日生まれ〜翌年4月1日生まれ」が同学年(学校教育法・年齢計算に関する法律の
 *   運用: 4月1日生まれは誕生日の前日に満6歳に達するため上の学年になる)
 * - 小学校入学年 = 4/2〜12/31生まれ → 生まれ年+7 / 1/1〜4/1生まれ(早生まれ)→ 生まれ年+6
 * - 以降: 小学校6年・中学校3年・高校3年・大学4年(入学は4月・卒業は3月)
 */
(function (global) {
  "use strict";

  var YEAR_MIN = 1900;
  var YEAR_MAX = 2100;

  function isLeapYear(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function daysInMonth(y, m) {
    return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }

  /**
   * 西暦年を和暦表記にする(明治〜令和)。
   */
  function wareki(year) {
    if (year >= 2019) return "令和" + (year - 2018 === 1 ? "元" : year - 2018) + "年";
    if (year >= 1989) return "平成" + (year - 1988 === 1 ? "元" : year - 1988) + "年";
    if (year >= 1926) return "昭和" + (year - 1925 === 1 ? "元" : year - 1925) + "年";
    if (year >= 1912) return "大正" + (year - 1911 === 1 ? "元" : year - 1911) + "年";
    return "明治" + (year - 1867) + "年";
  }

  /**
   * 生年月日から入学・卒業年を計算する。
   * @param {string} birthIso 生年月日 "YYYY-MM-DD"
   * @returns {{ok: true, hayaumare: boolean, elemIn: number, elemOut: number,
   *            jhsIn: number, jhsOut: number, hsIn: number, hsOut: number,
   *            uniIn: number, uniOut: number}|{ok: false, code: string}}
   *   各値は西暦年(入学=その年の4月、卒業=その年の3月) / code: "invalid_date"
   */
  function schoolYears(birthIso) {
    if (typeof birthIso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(birthIso)) {
      return { ok: false, code: "invalid_date" };
    }
    var y = parseInt(birthIso.slice(0, 4), 10);
    var m = parseInt(birthIso.slice(5, 7), 10);
    var d = parseInt(birthIso.slice(8, 10), 10);
    if (y < YEAR_MIN || y > YEAR_MAX || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) {
      return { ok: false, code: "invalid_date" };
    }
    var hayaumare = m === 1 || m === 2 || m === 3 || (m === 4 && d === 1);
    var elemIn = y + (hayaumare ? 6 : 7);
    return {
      ok: true,
      hayaumare: hayaumare,
      elemIn: elemIn, elemOut: elemIn + 6,
      jhsIn: elemIn + 6, jhsOut: elemIn + 9,
      hsIn: elemIn + 9, hsOut: elemIn + 12,
      uniIn: elemIn + 12, uniOut: elemIn + 16
    };
  }

  var api = { schoolYears: schoolYears, wareki: wareki };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.RirekiCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
