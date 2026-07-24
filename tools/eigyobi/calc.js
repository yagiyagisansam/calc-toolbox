/*
 * 営業日計算ロジック(土日+日本の祝日を除く)
 *
 * 計算方法:
 * - 営業日 = 土曜・日曜・祝日(振替休日・国民の休日を含む)以外の日
 * - 「○営業日後」= 起算日の翌日から数えて○番目の営業日
 * - 期間の営業日数 = 開始日・終了日の両方を含めて数える
 * - 祝日は「国民の祝日に関する法律」に基づく2026年・2027年の祝日
 *   (内閣府公表の一覧に基づく静的データ。対応範囲外の日付はエラー)
 */
(function (global) {
  "use strict";

  // 内閣府「国民の祝日について」に基づく(振替休日・国民の休日を含む)
  var HOLIDAYS = {
    "2026-01-01": 1, "2026-01-12": 1, "2026-02-11": 1, "2026-02-23": 1,
    "2026-03-20": 1, "2026-04-29": 1, "2026-05-03": 1, "2026-05-04": 1,
    "2026-05-05": 1, "2026-05-06": 1, "2026-07-20": 1, "2026-08-11": 1,
    "2026-09-21": 1, "2026-09-22": 1, "2026-09-23": 1, "2026-10-12": 1,
    "2026-11-03": 1, "2026-11-23": 1,
    "2027-01-01": 1, "2027-01-11": 1, "2027-02-11": 1, "2027-02-23": 1,
    "2027-03-21": 1, "2027-03-22": 1, "2027-04-29": 1, "2027-05-03": 1,
    "2027-05-04": 1, "2027-05-05": 1, "2027-07-19": 1, "2027-08-11": 1,
    "2027-09-20": 1, "2027-09-23": 1, "2027-10-11": 1, "2027-11-03": 1,
    "2027-11-23": 1
  };
  var RANGE_MIN = "2026-01-01";
  var RANGE_MAX = "2027-12-31";

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
  function toSerial(y, m, d) {
    y -= m <= 2 ? 1 : 0;
    var era = Math.floor(y / 400);
    var yoe = y - era * 400;
    var doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
    var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
  }
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
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function toIso(z) {
    var d = fromSerial(z);
    return d.y + "-" + pad(d.m) + "-" + pad(d.d);
  }
  function isBusinessDay(serial) {
    var dow = ((serial + 3) % 7 + 7) % 7; // 0=月 … 5=土 6=日
    if (dow >= 5) return false;
    return !HOLIDAYS[toIso(serial)];
  }
  function inRange(iso) { return iso >= RANGE_MIN && iso <= RANGE_MAX; }

  /**
   * ○営業日後の日付を求める(起算日の翌日から数える)。
   * @param {string} startIso 起算日 "YYYY-MM-DD"
   * @param {number} n 営業日数(1〜200)
   * @returns {{ok: true, date: string, weekday: string}|{ok: false, code: string}}
   *   code: "invalid_date" | "invalid_n" | "out_of_range"
   */
  function addBusinessDays(startIso, n) {
    var p = parseDate(startIso);
    if (!p || !inRange(startIso)) return { ok: false, code: p ? "out_of_range" : "invalid_date" };
    if (typeof n !== "number" || n !== Math.floor(n) || n < 1 || n > 200) {
      return { ok: false, code: "invalid_n" };
    }
    var serial = toSerial(p.y, p.m, p.d);
    var count = 0;
    while (count < n) {
      serial++;
      if (!inRange(toIso(serial))) return { ok: false, code: "out_of_range" };
      if (isBusinessDay(serial)) count++;
    }
    var WD = ["月", "火", "水", "木", "金", "土", "日"];
    return { ok: true, date: toIso(serial), weekday: WD[((serial + 3) % 7 + 7) % 7] };
  }

  /**
   * 期間内の営業日数を数える(開始日・終了日を含む)。
   * @returns {{ok: true, businessDays: number, totalDays: number}|{ok: false, code: string}}
   */
  function countBusinessDays(startIso, endIso) {
    var s = parseDate(startIso);
    var e = parseDate(endIso);
    if (!s || !inRange(startIso)) return { ok: false, code: s ? "out_of_range" : "invalid_date" };
    if (!e || !inRange(endIso)) return { ok: false, code: e ? "out_of_range" : "invalid_date" };
    var ss = toSerial(s.y, s.m, s.d);
    var es = toSerial(e.y, e.m, e.d);
    if (es < ss) return { ok: false, code: "date_order" };
    var count = 0;
    for (var z = ss; z <= es; z++) { if (isBusinessDay(z)) count++; }
    return { ok: true, businessDays: count, totalDays: es - ss + 1 };
  }

  var api = { addBusinessDays: addBusinessDays, countBusinessDays: countBusinessDays,
    HOLIDAYS: HOLIDAYS, RANGE_MIN: RANGE_MIN, RANGE_MAX: RANGE_MAX };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.EigyobiCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
