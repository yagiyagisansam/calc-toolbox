/*
 * ISO週番号・第何週 計算ロジック
 *
 * 根拠(一次情報):
 * - ISO「ISO 8601 Date and time format」 https://www.iso.org/iso-8601-date-and-time-format.html
 *   (2026年7月29日参照)
 * - ISO 8601-1:2019(Date and time — Representations for information interchange — Part 1)
 *   https://www.iso.org/standard/70907.html (2026年7月29日参照)
 *   ISO 8601 の暦週の定め:
 *     ・週は月曜日に始まり日曜日に終わる。
 *     ・その年の第1週は、その年の最初の木曜日を含む週(=1月4日を含む週)である。
 *     ・したがって1年は52週または53週になる。
 *     ・年末年始の日付は、隣の年の週に属することがある(週の年=ISO週年)。
 *
 * 前提:
 * - 日付はすべてグレゴリオ暦。時差は考えず、暦日だけで計算する。
 * - ISO週番号のほかに、「1月1日を含む週を第1週」とする日本の社内カレンダーでよく使われる
 *   数え方(週の開始曜日を選べる)も計算できるようにしている。両者は結果が異なる。
 * - 対象年は1583〜9999年(グレゴリオ暦が始まった翌年以降)。
 */
(function (global) {
  "use strict";

  var YEAR_MIN = 1583;
  var YEAR_MAX = 9999;
  var DAY_MS = 86400000;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function isInt(v) {
    return isFiniteNumber(v) && v === Math.floor(v);
  }

  function isLeap(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  }

  function daysInMonth(y, m) {
    return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }

  function validDate(y, m, d) {
    return isInt(y) && y >= YEAR_MIN && y <= YEAR_MAX &&
      isInt(m) && m >= 1 && m <= 12 &&
      isInt(d) && d >= 1 && d <= daysInMonth(y, m);
  }

  // 年月日 → UTC基準の通し日数(1970-01-01 = 0)。年が0〜99でも取り違えないようにsetUTCFullYearを使う
  function toUtc(y, m, d) {
    var dt = new Date(Date.UTC(2000, m - 1, d));
    dt.setUTCFullYear(y);
    return dt.getTime();
  }

  function fromUtc(ms) {
    var dt = new Date(ms);
    return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function pad4(n) { return ("000" + n).slice(-4); }

  function isoString(g) {
    return pad4(g.year) + "-" + pad2(g.month) + "-" + pad2(g.day);
  }

  // 月曜=1 … 日曜=7
  function isoWeekday(ms) {
    var d = new Date(ms).getUTCDay(); // 日曜=0
    return d === 0 ? 7 : d;
  }

  function dayOfYear(ms) {
    var g = fromUtc(ms);
    return Math.round((ms - toUtc(g.year, 1, 1)) / DAY_MS) + 1;
  }

  /**
   * その年のISO週が52週か53週かを返す。
   * 1月1日が木曜日の年、またはうるう年で1月1日が水曜日の年が53週になる。
   * @param {number} isoYear ISO週年(1583〜9999)
   * @returns {{ok:true, weeks:number}|{ok:false, code:"invalid_year"}}
   */
  function weeksInYear(isoYear) {
    if (!isInt(isoYear) || isoYear < YEAR_MIN || isoYear > YEAR_MAX) {
      return { ok: false, code: "invalid_year" };
    }
    var jan1 = isoWeekday(toUtc(isoYear, 1, 1));
    var has53 = jan1 === 4 || (isLeap(isoYear) && jan1 === 3);
    return { ok: true, weeks: has53 ? 53 : 52 };
  }

  /**
   * 日付からISO 8601の週番号を求める。
   * その日を含む週の木曜日が属する年をISO週年とし、
   * 週番号 = floor((その木曜日の年内通日 − 1) / 7) + 1 で求める。
   * @param {number} year 西暦年(1583〜9999)
   * @param {number} month 月(1〜12)
   * @param {number} day 日(1〜その月の日数)
   * @returns {{ok:true, isoYear:number, week:number, weekday:number, label:string,
   *            iso:string, mondayIso:string, sundayIso:string}
   *          |{ok:false, code:"invalid_date"}}
   *   weekday は 月曜=1 … 日曜=7。label は "2026-W05" 形式。
   */
  function isoWeek(year, month, day) {
    if (!validDate(year, month, day)) return { ok: false, code: "invalid_date" };
    var ms = toUtc(year, month, day);
    var wd = isoWeekday(ms);
    var thursday = ms + (4 - wd) * DAY_MS;
    var isoYear = fromUtc(thursday).year;
    var week = Math.floor((dayOfYear(thursday) - 1) / 7) + 1;
    var monday = ms - (wd - 1) * DAY_MS;
    return {
      ok: true,
      isoYear: isoYear,
      week: week,
      weekday: wd,
      label: pad4(isoYear) + "-W" + pad2(week),
      iso: isoString(fromUtc(ms)),
      mondayIso: isoString(fromUtc(monday)),
      sundayIso: isoString(fromUtc(monday + 6 * DAY_MS))
    };
  }

  /**
   * ISO週年と週番号から、その週の月曜〜日曜の日付を求める。
   * @param {number} isoYear ISO週年(1583〜9999)
   * @param {number} week 週番号(1以上、その年の週数以下)
   * @returns {{ok:true, isoYear:number, week:number, mondayIso:string, sundayIso:string,
   *            days:Array<{iso:string, weekday:number}>, label:string}
   *          |{ok:false, code:"invalid_year"|"invalid_week"}}
   *   days は月曜から日曜までの7日分。
   */
  function weekRange(isoYear, week) {
    var w = weeksInYear(isoYear);
    if (!w.ok) return w;
    if (!isInt(week) || week < 1 || week > w.weeks) {
      return { ok: false, code: "invalid_week" };
    }
    // 1月4日は必ず第1週に含まれる。その週の月曜日を起点にする
    var jan4 = toUtc(isoYear, 1, 4);
    var week1Monday = jan4 - (isoWeekday(jan4) - 1) * DAY_MS;
    var monday = week1Monday + (week - 1) * 7 * DAY_MS;
    var days = [];
    for (var i = 0; i < 7; i++) {
      days.push({ iso: isoString(fromUtc(monday + i * DAY_MS)), weekday: i + 1 });
    }
    return {
      ok: true,
      isoYear: isoYear,
      week: week,
      label: pad4(isoYear) + "-W" + pad2(week),
      mondayIso: days[0].iso,
      sundayIso: days[6].iso,
      days: days
    };
  }

  /**
   * 「1月1日を含む週を第1週」とする数え方で、その日が年内の第何週かを求める(ISOとは別)。
   * 日本の社内カレンダーや学校の週計算でよく使われる。
   * @param {number} year 西暦年(1583〜9999)
   * @param {number} month 月(1〜12)
   * @param {number} day 日(1〜その月の日数)
   * @param {number} [startWeekday=1] 週の開始曜日(月曜=1 … 日曜=7)
   * @returns {{ok:true, week:number, weekday:number, startIso:string, endIso:string}
   *          |{ok:false, code:"invalid_date"|"invalid_start_weekday"}}
   *   startIso/endIso はその週の初日と最終日(年をまたぐこともある)。
   */
  function simpleWeek(year, month, day, startWeekday) {
    if (startWeekday === undefined || startWeekday === null) startWeekday = 1;
    if (!validDate(year, month, day)) return { ok: false, code: "invalid_date" };
    if (!isInt(startWeekday) || startWeekday < 1 || startWeekday > 7) {
      return { ok: false, code: "invalid_start_weekday" };
    }
    var ms = toUtc(year, month, day);
    var jan1 = toUtc(year, 1, 1);
    // その日が属する週の初日
    function weekStart(t) {
      var offset = (isoWeekday(t) - startWeekday + 7) % 7;
      return t - offset * DAY_MS;
    }
    var start = weekStart(ms);
    var firstWeekStart = weekStart(jan1);
    var week = Math.round((start - firstWeekStart) / (7 * DAY_MS)) + 1;
    return {
      ok: true,
      week: week,
      weekday: isoWeekday(ms),
      startIso: isoString(fromUtc(start)),
      endIso: isoString(fromUtc(start + 6 * DAY_MS))
    };
  }

  var api = {
    isoWeek: isoWeek,
    weekRange: weekRange,
    weeksInYear: weeksInYear,
    simpleWeek: simpleWeek,
    YEAR_MIN: YEAR_MIN,
    YEAR_MAX: YEAR_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.ShubanCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
