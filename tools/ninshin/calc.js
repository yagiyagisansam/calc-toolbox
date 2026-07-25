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

  /**
   * 出産予定日(=妊娠40週0日)から逆算して、基準日時点の妊娠週数を求める。
   * 経過日数 = 280 − (予定日 − 基準日)。dueDate と同じ通日変換・区分を使用。
   * 妊娠0週0日より前は too_early、43週0日以降(経過301日以上)は out_of_range。
   * @param {string} dueIso 出産予定日 "YYYY-MM-DD"
   * @param {string} asOfIso 基準日 "YYYY-MM-DD"
   * @returns {{ok:true, week:number, day:number, elapsedDays:number, trimester:string}
   *          |{ok:false, code:string}}
   *   code: "invalid_due" | "invalid_asof" | "too_early" | "out_of_range"
   */
  function weeksFromDue(dueIso, asOfIso) {
    var due = parseDate(dueIso);
    if (!due) return { ok: false, code: "invalid_due" };
    var asOf = parseDate(asOfIso);
    if (!asOf) return { ok: false, code: "invalid_asof" };
    var elapsed = 280 - (toSerial(due.y, due.m, due.d) - toSerial(asOf.y, asOf.m, asOf.d));
    if (elapsed < 0) return { ok: false, code: "too_early" };
    if (elapsed > 300) return { ok: false, code: "out_of_range" };
    var week = Math.floor(elapsed / 7);
    return {
      ok: true,
      week: week,
      day: elapsed - week * 7,
      elapsedDays: elapsed,
      trimester: week < 14 ? "初期" : week < 28 ? "中期" : "後期"
    };
  }

  /**
   * 出産予定日(=妊娠40週0日)から、主要な節目の日付一覧を計算する。
   * 各節目は「予定日 − (40 − 週数) × 7日」で求める(dueDate と同じ通日変換を使用)。
   * 産前休業の開始は労働基準法第65条の「予定日の6週間前」(= 34週0日。多胎妊娠は14週間前)、
   * 産後休業の終了は同条の「出産の8週間後」を予定日基準で計算した目安。
   * あくまで概算であり、医学的判断は医師が優先。
   * @param {string} dueIso 出産予定日 "YYYY-MM-DD"
   * @returns {{ok:true, rows:Array<{label:string, weeks:string, date:string}>}
   *          |{ok:false, code:string}}  code: "invalid_due"
   */
  function milestones(dueIso) {
    var due = parseDate(dueIso);
    if (!due) return { ok: false, code: "invalid_due" };
    var ds = toSerial(due.y, due.m, due.d);
    var defs = [
      { label: "妊娠中期の開始", weeks: "14週0日", off: -26 * 7 },
      { label: "安定期の目安(16週)", weeks: "16週0日", off: -24 * 7 },
      { label: "妊娠後期の開始", weeks: "28週0日", off: -12 * 7 },
      { label: "産前休業の開始(予定日の6週間前)", weeks: "34週0日", off: -6 * 7 },
      { label: "正期産の開始", weeks: "37週0日", off: -3 * 7 },
      { label: "出産予定日", weeks: "40週0日", off: 0 },
      { label: "産後休業の終了(出産の8週間後)", weeks: "出産の8週間後", off: 8 * 7 }
    ];
    var rows = [];
    for (var i = 0; i < defs.length; i++) {
      var m = defs[i];
      var d = fromSerial(ds + m.off);
      rows.push({
        label: m.label,
        weeks: m.weeks,
        date: pad(d.y, 4) + "-" + pad(d.m, 2) + "-" + pad(d.d, 2)
      });
    }
    return { ok: true, rows: rows };
  }

  var api = {
    milestones: milestones,
    weeksFromDue: weeksFromDue,
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
