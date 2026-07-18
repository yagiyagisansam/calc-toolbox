/*
 * 日数計算(日付の差・○日後)ロジック
 *
 * 計算方法:
 * - グレゴリオ暦の通日(シリアル値)に変換して差・加算を求める(うるう年対応)
 * - 通日変換は civil-from-days / days-from-civil の標準的なアルゴリズム
 * - 曜日は通日 mod 7 から算出
 *
 * 前提(ページにも明記):
 * - 「経過日数」は初日を含まない(7/18→7/19 は1日)。「両端を含む日数」も併記
 */
(function (global) {
  "use strict";

  var YEAR_MIN = 1600;
  var YEAR_MAX = 2500;
  var ADD_MIN = -36500;
  var ADD_MAX = 36500;
  var WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];

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

  // 1970-01-01 を 0 とする通日(Howard Hinnant の days_from_civil)
  function toSerial(y, m, d) {
    y -= m <= 2 ? 1 : 0;
    var era = Math.floor(y / 400);
    var yoe = y - era * 400;
    var doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }

  // 通日→ {y, m, d}(civil_from_days)
  function fromSerial(z) {
    z += 719468;
    var era = Math.floor(z / 146097);
    var doe = z - era * 146097;
    var yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
    var y = yoe + era * 400;
    var doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    var mp = Math.floor((5 * doy + 2) / 153);
    var d = doy - Math.floor((153 * mp + 2) / 5) + 1;
    var m = mp + (mp < 10 ? 3 : -9);
    return { y: y + (m <= 2 ? 1 : 0), m: m, d: d };
  }

  function pad(n, len) {
    var s = String(n);
    while (s.length < len) s = "0" + s;
    return s;
  }

  function toIso(c) {
    return pad(c.y, 4) + "-" + pad(c.m, 2) + "-" + pad(c.d, 2);
  }

  function weekdayOf(serial) {
    // 1970-01-01(serial 0)は木曜日 → WEEKDAYS[3]
    return WEEKDAYS[((serial + 3) % 7 + 7) % 7];
  }

  /**
   * 2つの日付の間の日数。
   * @returns {{ok: true, days: number, inclusiveDays: number}|{ok: false, code: string}}
   *   days: 初日を含まない経過日数 / inclusiveDays: 両端を含む日数
   *   code: "invalid_from" | "invalid_to" | "from_after_to"
   */
  function between(fromIso, toIsoStr) {
    var f = parseDate(fromIso);
    if (!f) return { ok: false, code: "invalid_from" };
    var t = parseDate(toIsoStr);
    if (!t) return { ok: false, code: "invalid_to" };
    var diff = toSerial(t.y, t.m, t.d) - toSerial(f.y, f.m, f.d);
    if (diff < 0) return { ok: false, code: "from_after_to" };
    return { ok: true, days: diff, inclusiveDays: diff + 1 };
  }

  /**
   * 基準日のN日後(負なら前)の日付と曜日。
   * @returns {{ok: true, date: string, weekday: string}|{ok: false, code: string}}
   *   code: "invalid_base" | "invalid_offset" | "out_of_range"
   */
  function addDays(baseIso, offsetDays) {
    var b = parseDate(baseIso);
    if (!b) return { ok: false, code: "invalid_base" };
    if (typeof offsetDays !== "number" || !isFinite(offsetDays) ||
        offsetDays !== Math.floor(offsetDays) || offsetDays < ADD_MIN || offsetDays > ADD_MAX) {
      return { ok: false, code: "invalid_offset" };
    }
    var serial = toSerial(b.y, b.m, b.d) + offsetDays;
    var c = fromSerial(serial);
    if (c.y < YEAR_MIN || c.y > YEAR_MAX) return { ok: false, code: "out_of_range" };
    return { ok: true, date: toIso(c), weekday: weekdayOf(serial) };
  }

  var api = {
    between: between,
    addDays: addDays,
    YEAR_MIN: YEAR_MIN,
    YEAR_MAX: YEAR_MAX,
    ADD_MIN: ADD_MIN,
    ADD_MAX: ADD_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.DaysCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
