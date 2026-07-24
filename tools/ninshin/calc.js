/*
 * 出産予定日・妊娠週数計算ロジック(最終月経開始日から)
 *
 * 計算方法:
 * - 出産予定日 = 最終月経開始日 + 280日(妊娠40週0日。ネーゲレの概算法)
 * - 月経周期が28日でない場合は (周期 − 28)日 を補正して計算
 * - 妊娠週数 = 補正後の起点からの経過日数 ÷ 7(切り捨て)、余りが「日」
 * - 区分: 〜13週=妊娠初期 / 14〜27週=妊娠中期 / 28週〜=妊娠後期
 * - 日付計算はグレゴリオ暦の通日変換(tools/days/ と同じアルゴリズム)
 * - あくまで概算。実際の予定日は医師の診断が優先(ページに明記)
 */
(function (global) {
  "use strict";

  var YEAR_MIN = 1900;
  var YEAR_MAX = 2200;
  var CYCLE_MIN = 20;
  var CYCLE_MAX = 45;

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
   * 出産予定日と妊娠週数を計算する。
   * @param {string} lmpIso 最終月経開始日 "YYYY-MM-DD"
   * @param {string} asOfIso 基準日 "YYYY-MM-DD"(UI初期値は今日)
   * @param {number} [cycleDays=28] 月経周期(日・20〜45)
   * @returns {{ok: true, due: string, week: number, day: number,
   *            elapsedDays: number, trimester: string}
   *          |{ok: false, code: string}}
   *   due: 出産予定日 / week・day: 妊娠週数(○週△日) / trimester: "初期"|"中期"|"後期"
   *   code: "invalid_lmp" | "invalid_asof" | "invalid_cycle" | "lmp_after_asof"
   */
  function dueDate(lmpIso, asOfIso, cycleDays) {
    var lmp = parseDate(lmpIso);
    if (!lmp) return { ok: false, code: "invalid_lmp" };
    var asOf = parseDate(asOfIso);
    if (!asOf) return { ok: false, code: "invalid_asof" };
    var cycle = cycleDays === undefined || cycleDays === null ? 28 : cycleDays;
    if (typeof cycle !== "number" || !isFinite(cycle) || cycle !== Math.floor(cycle) ||
        cycle < CYCLE_MIN || cycle > CYCLE_MAX) {
      return { ok: false, code: "invalid_cycle" };
    }
    var ls = toSerial(lmp.y, lmp.m, lmp.d);
    var as = toSerial(asOf.y, asOf.m, asOf.d);
    if (as < ls) return { ok: false, code: "lmp_after_asof" };
    var eff = ls + (cycle - 28);
    var dueSerial = eff + 280;
    var due = fromSerial(dueSerial);
    var elapsed = Math.max(0, as - eff);
    var week = Math.floor(elapsed / 7);
    return {
      ok: true,
      due: pad(due.y, 4) + "-" + pad(due.m, 2) + "-" + pad(due.d, 2),
      week: week,
      day: elapsed - week * 7,
      elapsedDays: elapsed,
      trimester: week < 14 ? "初期" : week < 28 ? "中期" : "後期"
    };
  }

  var api = {
    dueDate: dueDate,
    YEAR_MIN: YEAR_MIN,
    YEAR_MAX: YEAR_MAX,
    CYCLE_MIN: CYCLE_MIN,
    CYCLE_MAX: CYCLE_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.NinshinCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
