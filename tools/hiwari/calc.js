/*
 * 家賃日割り計算ロジック(入居日・退去日から)
 *
 * 計算方法:
 * - 実日数方式: 日割り家賃 = 月額家賃 × 対象日数 ÷ その月の実日数(28〜31日)
 * - 30日固定方式: 日割り家賃 = 月額家賃 × 対象日数 ÷ 30
 * - 入居(movein)は「入居日〜月末」、退去(moveout)は「月初〜退去日」の日数
 * - 円未満は切り捨て。月額を超える場合は月額で頭打ち
 * - どちらの方式を使うかは賃貸借契約による(ページに明記)
 */
(function (global) {
  "use strict";

  var YEAR_MIN = 1900;
  var YEAR_MAX = 2200;

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

  /**
   * 家賃の日割り額を計算する。
   * @param {number} rent 月額家賃(円)
   * @param {string} iso 入居日または退去日 "YYYY-MM-DD"
   * @param {string} mode "movein"(入居日〜月末) | "moveout"(月初〜退去日)
   * @returns {{ok: true, days: number, daysInMonth: number,
   *            actual: number, by30: number}
   *          |{ok: false, code: string}}
   *   days: 日割り対象日数 / actual: 実日数方式の金額 / by30: 30日固定方式の金額
   *   code: "invalid_rent" | "invalid_date" | "invalid_mode"
   */
  function prorate(rent, iso, mode) {
    if (typeof rent !== "number" || !isFinite(rent) || rent <= 0 || rent > 10000000) {
      return { ok: false, code: "invalid_rent" };
    }
    var p = parseDate(iso);
    if (!p) return { ok: false, code: "invalid_date" };
    if (mode !== "movein" && mode !== "moveout") {
      return { ok: false, code: "invalid_mode" };
    }
    var dim = daysInMonth(p.y, p.m);
    var days = mode === "movein" ? dim - p.d + 1 : p.d;
    return {
      ok: true,
      days: days,
      daysInMonth: dim,
      actual: Math.min(rent, Math.floor(rent * days / dim)),
      by30: Math.min(rent, Math.floor(rent * days / 30))
    };
  }

  /**
   * 入居時の初期費用の総額を計算する(日割り家賃+敷金・礼金・仲介手数料・前家賃+その他)。
   * - 日割り家賃は prorate の実日数方式(入居日〜月末をその月の日数で割る・円未満切り捨て)
   * - 敷金・礼金・仲介手数料・前家賃は「家賃の何ヶ月分」で指定し、円未満四捨五入
   * - その他(保証会社利用料・火災保険・鍵交換代など)は金額でそのまま加算
   * - monthsOfRent: 総額が家賃の約何ヶ月分か(小数第1位)
   * @param {number} rent 月額家賃(円)
   * @param {string} iso 入居日 "YYYY-MM-DD"
   * @param {number} shikikinMonths 敷金(ヶ月・0〜12)
   * @param {number} reikinMonths 礼金(ヶ月・0〜12)
   * @param {number} chukaiMonths 仲介手数料(ヶ月・0〜12)
   * @param {number} maeYachinMonths 前家賃(ヶ月・0〜12。翌月分を先払いするなら1)
   * @param {number} [otherYen=0] その他の費用(円・0〜10,000,000)
   * @returns {{ok: true, days: number, prorated: number, shikikin: number, reikin: number,
   *            chukai: number, maeYachin: number, other: number, total: number, monthsOfRent: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_rent" | "invalid_date" | "invalid_months" | "invalid_other"
   */
  function initialCost(rent, iso, shikikinMonths, reikinMonths, chukaiMonths, maeYachinMonths, otherYen) {
    var pr = prorate(rent, iso, "movein");
    if (!pr.ok) return pr;
    var months = [shikikinMonths, reikinMonths, chukaiMonths, maeYachinMonths];
    for (var i = 0; i < months.length; i++) {
      if (typeof months[i] !== "number" || !isFinite(months[i]) || months[i] < 0 || months[i] > 12) {
        return { ok: false, code: "invalid_months" };
      }
    }
    var other = otherYen === undefined || otherYen === null ? 0 : otherYen;
    if (typeof other !== "number" || !isFinite(other) || other < 0 || other > 10000000) {
      return { ok: false, code: "invalid_other" };
    }
    var shikikin = Math.round(rent * shikikinMonths);
    var reikin = Math.round(rent * reikinMonths);
    var chukai = Math.round(rent * chukaiMonths);
    var mae = Math.round(rent * maeYachinMonths);
    var otherR = Math.round(other);
    var total = pr.actual + shikikin + reikin + chukai + mae + otherR;
    return {
      ok: true,
      days: pr.days,
      prorated: pr.actual,
      shikikin: shikikin,
      reikin: reikin,
      chukai: chukai,
      maeYachin: mae,
      other: otherR,
      total: total,
      monthsOfRent: Math.round(total / rent * 10) / 10
    };
  }

  var api = {
    initialCost: initialCost,
    prorate: prorate,
    YEAR_MIN: YEAR_MIN,
    YEAR_MAX: YEAR_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.HiwariCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
