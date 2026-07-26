/*
 * 日本の祝日カレンダー ロジック(2026年・2027年)
 *
 * 祝日データの根拠(一次情報):
 * - 「国民の祝日に関する法律」に基づく内閣府「国民の祝日について」
 *   https://www8.cao.go.jp/chosei/shukujitsu/gaiyou.html
 * - 振替休日・国民の休日を含む。日付は tools/eigyobi/calc.js と同一
 *   (祝日を追加更新するときは両方のファイルを更新すること)
 *
 * 前提:
 * - 対応範囲は 2026-01-01〜2027-12-31(翌年分は内閣府の公表後に追加。例年2月頃)
 */
(function (global) {
  "use strict";

  // [ISO日付, 祝日名]
  var HOLIDAYS = [
    ["2026-01-01", "元日"],
    ["2026-01-12", "成人の日"],
    ["2026-02-11", "建国記念の日"],
    ["2026-02-23", "天皇誕生日"],
    ["2026-03-20", "春分の日"],
    ["2026-04-29", "昭和の日"],
    ["2026-05-03", "憲法記念日"],
    ["2026-05-04", "みどりの日"],
    ["2026-05-05", "こどもの日"],
    ["2026-05-06", "振替休日"],
    ["2026-07-20", "海の日"],
    ["2026-08-11", "山の日"],
    ["2026-09-21", "敬老の日"],
    ["2026-09-22", "国民の休日"],
    ["2026-09-23", "秋分の日"],
    ["2026-10-12", "スポーツの日"],
    ["2026-11-03", "文化の日"],
    ["2026-11-23", "勤労感謝の日"],
    ["2027-01-01", "元日"],
    ["2027-01-11", "成人の日"],
    ["2027-02-11", "建国記念の日"],
    ["2027-02-23", "天皇誕生日"],
    ["2027-03-21", "春分の日"],
    ["2027-03-22", "振替休日"],
    ["2027-04-29", "昭和の日"],
    ["2027-05-03", "憲法記念日"],
    ["2027-05-04", "みどりの日"],
    ["2027-05-05", "こどもの日"],
    ["2027-07-19", "海の日"],
    ["2027-08-11", "山の日"],
    ["2027-09-20", "敬老の日"],
    ["2027-09-23", "秋分の日"],
    ["2027-10-11", "スポーツの日"],
    ["2027-11-03", "文化の日"],
    ["2027-11-23", "勤労感謝の日"]
  ];
  var YEAR_MIN = 2026;
  var YEAR_MAX = 2027;

  function isLeapYear(y) { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }
  function daysInMonth(y, m) {
    return [31, isLeapYear(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  }
  function parseDate(iso) {
    if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    var y = parseInt(iso.slice(0, 4), 10);
    var m = parseInt(iso.slice(5, 7), 10);
    var d = parseInt(iso.slice(8, 10), 10);
    if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
    return { y: y, m: m, d: d };
  }
  // 1970-01-01 を 0 とする通算日(タイムゾーン非依存)
  function toSerial(y, m, d) {
    y -= m <= 2 ? 1 : 0;
    var era = Math.floor(y / 400);
    var yoe = y - era * 400;
    var doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }
  function isoToSerial(iso) {
    var p = parseDate(iso);
    return p ? toSerial(p.y, p.m, p.d) : null;
  }
  function youbiIndex(iso) {
    // 1970-01-01 は木曜(=4)
    var s = isoToSerial(iso);
    return ((s + 4) % 7 + 7) % 7; // 0=日
  }
  var YOUBI = ["日", "月", "火", "水", "木", "金", "土"];

  var MAP = {};
  for (var i = 0; i < HOLIDAYS.length; i++) MAP[HOLIDAYS[i][0]] = HOLIDAYS[i][1];

  /**
   * 指定年の祝日一覧。
   * @returns {{ok:true, holidays:Array<{date:string, name:string, youbi:string}>}
   *          |{ok:false, code:"invalid_year"}}
   */
  function listHolidays(year) {
    if (typeof year !== "number" || year < YEAR_MIN || year > YEAR_MAX) {
      return { ok: false, code: "invalid_year" };
    }
    var out = [];
    for (var i = 0; i < HOLIDAYS.length; i++) {
      if (HOLIDAYS[i][0].slice(0, 4) === String(year)) {
        out.push({ date: HOLIDAYS[i][0], name: HOLIDAYS[i][1], youbi: YOUBI[youbiIndex(HOLIDAYS[i][0])] });
      }
    }
    return { ok: true, holidays: out };
  }

  /**
   * 基準日以降(当日を含む)で最も近い祝日。
   * @returns {{ok:true, date:string, name:string, youbi:string, daysUntil:number}
   *          |{ok:false, code:"invalid_date"|"out_of_range"}}
   */
  function nextHoliday(todayIso) {
    var s = isoToSerial(todayIso);
    if (s === null) return { ok: false, code: "invalid_date" };
    for (var i = 0; i < HOLIDAYS.length; i++) {
      var hs = isoToSerial(HOLIDAYS[i][0]);
      if (hs >= s) {
        return { ok: true, date: HOLIDAYS[i][0], name: HOLIDAYS[i][1], youbi: YOUBI[youbiIndex(HOLIDAYS[i][0])], daysUntil: hs - s };
      }
    }
    return { ok: false, code: "out_of_range" };
  }

  /**
   * 指定年の3連休以上(土日+祝日で3日以上連続した休み)の一覧。
   * 年をまたぐ連休は、開始日がその年に属するものを載せる。
   * @returns {{ok:true, runs:Array<{start:string, end:string, days:number, names:string[]}>}
   *          |{ok:false, code:"invalid_year"}}
   */
  function longWeekends(year) {
    if (typeof year !== "number" || year < YEAR_MIN || year > YEAR_MAX) {
      return { ok: false, code: "invalid_year" };
    }
    function serialToIso(s) {
      var z = s + 719468;
      var era = Math.floor(z / 146097);
      var doe = z - era * 146097;
      var yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
      var y = yoe + era * 400;
      var doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
      var mp = Math.floor((5 * doy + 2) / 153);
      var d = doy - Math.floor((153 * mp + 2) / 5) + 1;
      var m = mp + (mp < 10 ? 3 : -9);
      y += m <= 2 ? 1 : 0;
      return y + "-" + (m < 10 ? "0" : "") + m + "-" + (d < 10 ? "0" : "") + d;
    }
    function isOff(iso) {
      var w = youbiIndex(iso);
      return w === 0 || w === 6 || !!MAP[iso];
    }
    var start = toSerial(year, 1, 1);
    var end = toSerial(year, 12, 31);
    var runs = [];
    var s = start;
    while (s <= end) {
      var iso = serialToIso(s);
      if (isOff(iso)) {
        var runStart = s;
        var names = [];
        while (isOff(serialToIso(s))) {
          var n = MAP[serialToIso(s)];
          if (n) names.push(n);
          s++;
        }
        var days = s - runStart;
        if (days >= 3) {
          runs.push({ start: serialToIso(runStart), end: serialToIso(s - 1), days: days, names: names });
        }
      } else {
        s++;
      }
    }
    return { ok: true, runs: runs };
  }

  var api = {
    listHolidays: listHolidays,
    nextHoliday: nextHoliday,
    longWeekends: longWeekends,
    HOLIDAYS: HOLIDAYS,
    YEAR_MIN: YEAR_MIN,
    YEAR_MAX: YEAR_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.ShukujitsuCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
