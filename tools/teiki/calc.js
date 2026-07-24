/*
 * 定期券損益分岐計算ロジック
 *
 * 計算方法:
 * - 都度払いの月額 = 片道運賃 × 2(往復) × 利用日数
 * - 損益分岐日数 = 定期券価格 ÷ (片道運賃 × 2) の切り上げ
 *   (この日数以上乗れば定期のほうが安い)
 * - 差額 = 都度払い月額 − 定期券価格(正なら定期が得)
 */
(function (global) {
  "use strict";

  function num(v, min, max) {
    return typeof v === "number" && isFinite(v) && v >= min && v <= max;
  }

  /**
   * 定期券と都度払いを比較する。
   * @param {number} passPrice 定期券の価格(円・1ヶ月分)
   * @param {number} oneWayFare 片道運賃(円)
   * @param {number} daysPerMonth 月の利用日数(往復ベース・1〜31)
   * @returns {{ok: true, payg: number, diff: number, breakEvenDays: number, better: string}
   *          |{ok: false, code: string}}
   *   payg: 都度払いの月額 / diff: 都度払い−定期(正=定期が得) /
   *   breakEvenDays: 元が取れる日数 / better: "pass" | "payg" | "even"
   *   code: "invalid_pass" | "invalid_fare" | "invalid_days"
   */
  function compare(passPrice, oneWayFare, daysPerMonth) {
    if (!num(passPrice, 1, 1000000)) return { ok: false, code: "invalid_pass" };
    if (!num(oneWayFare, 1, 100000)) return { ok: false, code: "invalid_fare" };
    if (typeof daysPerMonth !== "number" || !isFinite(daysPerMonth) ||
        daysPerMonth !== Math.floor(daysPerMonth) || daysPerMonth < 1 || daysPerMonth > 31) {
      return { ok: false, code: "invalid_days" };
    }
    var payg = oneWayFare * 2 * daysPerMonth;
    var diff = payg - passPrice;
    return {
      ok: true,
      payg: payg,
      diff: diff,
      breakEvenDays: Math.ceil(passPrice / (oneWayFare * 2)),
      better: diff > 0 ? "pass" : diff < 0 ? "payg" : "even"
    };
  }

  var api = { compare: compare };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.TeikiCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
