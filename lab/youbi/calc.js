/*
 * 指定日の曜日を調べる計算ロジック
 *
 * 根拠(一次情報):
 * - 国立天文台 暦計算室 暦Wiki「グレゴリオ暦」(置閏法: 4で割り切れる年は閏年、
 *   ただし100で割り切れる年は平年、400で割り切れる年は閏年。1582年10月4日の翌日が10月15日)
 *   https://eco.mtk.nao.ac.jp/koyomi/wiki/A5B0A5ECA5B4A5EAA5AACEF1.html (2026年7月29日参照)
 * - 国立天文台 暦計算室「通日・曜日・干支」(曜日の確認に使用)
 *   https://eco.mtk.nao.ac.jp/cgi-bin/koyomi/cande/cale2j.cgi (2026年7月29日参照)
 * - Calculator.net "Day of the Week Calculator"(ツェラーの公式を用いる旨の記載)
 *   https://www.calculator.net/day-of-the-week-calculator.html (2026年7月29日参照)
 *
 * 計算式(ツェラーの公式・グレゴリオ暦):
 *   1月・2月は前年の13月・14月として扱う
 *   h = (q + ⌊13(m+1)/5⌋ + K + ⌊K/4⌋ + ⌊J/4⌋ + 5J) mod 7
 *   q=日、m=月(3〜14)、K=年の下2桁、J=年の上2桁
 *   h は 0=土曜、1=日曜、2=月曜 … 6=金曜
 *
 * 前提:
 * - グレゴリオ暦のみを扱う。1583年〜9999年を対象とする(1582年10月15日より前はユリウス暦のため対象外)
 * - 日本は1873年(明治6年)1月1日にグレゴリオ暦へ移行した。それ以前の日本の日付は旧暦(天保暦など)であり、
 *   本ツールの結果は「その日付をグレゴリオ暦とみなした場合の曜日」になる
 */
(function (global) {
  "use strict";

  var YEAR_MIN = 1583;
  var YEAR_MAX = 9999;
  // 0=日曜 … 6=土曜
  var KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function isInteger(v) {
    return isFiniteNumber(v) && Math.floor(v) === v;
  }

  /**
   * うるう年かどうかを判定する(グレゴリオ暦の置閏法)。
   * @param {number} year 西暦年(1583〜9999)
   * @returns {{ok:true, leap:boolean}|{ok:false, code:"invalid_year"}}
   */
  function isLeapYear(year) {
    if (!isInteger(year) || year < YEAR_MIN || year > YEAR_MAX) return { ok: false, code: "invalid_year" };
    return { ok: true, leap: (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 };
  }

  /**
   * その月の日数を返す。
   * @param {number} year 西暦年(1583〜9999)
   * @param {number} month 月(1〜12)
   * @returns {{ok:true, days:number}|{ok:false, code:"invalid_year"|"invalid_month"}}
   */
  function daysInMonth(year, month) {
    var leap = isLeapYear(year);
    if (!leap.ok) return leap;
    if (!isInteger(month) || month < 1 || month > 12) return { ok: false, code: "invalid_month" };
    var table = [31, leap.leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return { ok: true, days: table[month - 1] };
  }

  /**
   * 指定した年月日の曜日をツェラーの公式で求める。
   * @param {number} year 西暦年(1583〜9999)
   * @param {number} month 月(1〜12)
   * @param {number} day 日(1〜その月の日数)
   * @returns {{ok:true, index:number, key:string, zellerH:number}
   *          |{ok:false, code:"invalid_year"|"invalid_month"|"invalid_day"}}
   *   index は 0=日曜 … 6=土曜。key は "sunday"〜"saturday"。
   *   zellerH は公式そのままの値(0=土曜 … 6=金曜)。
   */
  function dayOfWeek(year, month, day) {
    var dim = daysInMonth(year, month);
    if (!dim.ok) return dim;
    if (!isInteger(day) || day < 1 || day > dim.days) return { ok: false, code: "invalid_day" };

    var m = month;
    var y = year;
    if (m < 3) { m += 12; y -= 1; }
    var K = y % 100;
    var J = Math.floor(y / 100);
    var h = (day + Math.floor((13 * (m + 1)) / 5) + K + Math.floor(K / 4) + Math.floor(J / 4) + 5 * J) % 7;
    h = ((h % 7) + 7) % 7;
    var index = (h + 6) % 7; // 0=土曜 → 0=日曜 の並びに直す
    return { ok: true, index: index, key: KEYS[index], zellerH: h };
  }

  /**
   * 同じ月日の曜日を、指定した年の範囲で一覧にする。
   * 2月29日のように存在しない年はスキップする。
   * @param {number} month 月(1〜12)
   * @param {number} day 日(1〜31)
   * @param {number} fromYear 開始年(1583〜9999)
   * @param {number} toYear 終了年(1583〜9999、開始年以上)
   * @returns {{ok:true, rows:Array<{year:number, index:number, key:string}>, skipped:number}
   *          |{ok:false, code:"invalid_month"|"invalid_day"|"invalid_year"|"invalid_range"}}
   *   rows は年の昇順。skipped は日付が存在せず飛ばした年数。
   */
  function sameDayEachYear(month, day, fromYear, toYear) {
    if (!isInteger(month) || month < 1 || month > 12) return { ok: false, code: "invalid_month" };
    if (!isInteger(day) || day < 1 || day > 31) return { ok: false, code: "invalid_day" };
    if (!isInteger(fromYear) || fromYear < YEAR_MIN || fromYear > YEAR_MAX) {
      return { ok: false, code: "invalid_year" };
    }
    if (!isInteger(toYear) || toYear < YEAR_MIN || toYear > YEAR_MAX) {
      return { ok: false, code: "invalid_year" };
    }
    if (toYear < fromYear || toYear - fromYear > 200) return { ok: false, code: "invalid_range" };
    var rows = [];
    var skipped = 0;
    for (var y = fromYear; y <= toYear; y++) {
      var r = dayOfWeek(y, month, day);
      if (r.ok) rows.push({ year: y, index: r.index, key: r.key });
      else skipped++;
    }
    return { ok: true, rows: rows, skipped: skipped };
  }

  /**
   * その日が「第何週の何曜日」かを求める(第3月曜日など)。
   * @param {number} year 西暦年(1583〜9999)
   * @param {number} month 月(1〜12)
   * @param {number} day 日(1〜その月の日数)
   * @returns {{ok:true, nth:number, index:number, key:string, isLast:boolean}
   *          |{ok:false, code:string}}
   *   nth は同じ曜日の中で何番目か。isLast はその月で最後の同じ曜日かどうか。
   */
  function nthWeekdayOfMonth(year, month, day) {
    var r = dayOfWeek(year, month, day);
    if (!r.ok) return r;
    var dim = daysInMonth(year, month);
    return {
      ok: true,
      nth: Math.floor((day - 1) / 7) + 1,
      index: r.index,
      key: r.key,
      isLast: day + 7 > dim.days
    };
  }

  var api = {
    KEYS: KEYS,
    isLeapYear: isLeapYear,
    daysInMonth: daysInMonth,
    dayOfWeek: dayOfWeek,
    sameDayEachYear: sameDayEachYear,
    nthWeekdayOfMonth: nthWeekdayOfMonth
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.YoubiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
