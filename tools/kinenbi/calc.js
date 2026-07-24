/*
 * 記念日・節目カウント計算ロジック(生まれて何日/付き合って何日目/1万日記念日)
 *
 * 計算方法:
 * - グレゴリオ暦の通日変換(tools/days/ と同じアルゴリズム)で日数差・加算を計算
 * - 「N日目」は初日(記念日当日)を1日目と数える(N日目 = 記念日 + (N−1)日)
 *   ※お食い初め(100日目)や交際記念日の一般的な数え方に合わせた前提。ページに明記
 */
(function (global) {
  "use strict";

  var YEAR_MIN = 1900;
  var YEAR_MAX = 2200;
  var WEEKDAYS = ["月", "火", "水", "木", "金", "土", "日"];
  var MILESTONES = [100, 200, 300, 365, 500, 777, 1000, 2000, 3000, 5000, 7777, 10000, 15000, 20000, 25000, 30000];

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

  function pad(n, len) {
    var s = String(n);
    while (s.length < len) s = "0" + s;
    return s;
  }

  /**
   * 記念日からの経過日数と節目の日付一覧を計算する。
   * @param {string} baseIso 記念日(誕生日・交際開始日など)"YYYY-MM-DD"
   * @param {string} asOfIso 基準日 "YYYY-MM-DD"(UI初期値は今日)
   * @returns {{ok: true, elapsedDays: number, dayNumber: number,
   *            milestones: Array<{n: number, date: string, weekday: string, daysUntil: number}>}
   *          |{ok: false, code: string}}
   *   elapsedDays: 経過日数(初日含まず) / dayNumber: 基準日は何日目か(初日=1日目)
   *   daysUntil: 節目まであと何日(0=当日・負=過去)
   *   code: "invalid_base" | "invalid_asof" | "base_after_asof"
   */
  function milestones(baseIso, asOfIso) {
    var b = parseDate(baseIso);
    if (!b) return { ok: false, code: "invalid_base" };
    var a = parseDate(asOfIso);
    if (!a) return { ok: false, code: "invalid_asof" };
    var bs = toSerial(b.y, b.m, b.d);
    var as = toSerial(a.y, a.m, a.d);
    if (as < bs) return { ok: false, code: "base_after_asof" };
    var list = [];
    for (var i = 0; i < MILESTONES.length; i++) {
      var n = MILESTONES[i];
      var serial = bs + n - 1;
      var c = fromSerial(serial);
      if (c.y > YEAR_MAX) continue;
      list.push({
        n: n,
        date: pad(c.y, 4) + "-" + pad(c.m, 2) + "-" + pad(c.d, 2),
        weekday: WEEKDAYS[((serial + 3) % 7 + 7) % 7],
        daysUntil: serial - as
      });
    }
    return {
      ok: true,
      elapsedDays: as - bs,
      dayNumber: as - bs + 1,
      milestones: list
    };
  }

  var api = {
    milestones: milestones,
    MILESTONES: MILESTONES,
    YEAR_MIN: YEAR_MIN,
    YEAR_MAX: YEAR_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.KinenbiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
