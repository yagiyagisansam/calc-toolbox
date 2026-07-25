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

  /**
   * 1ヶ月・3ヶ月・6ヶ月定期と都度払いをまとめて比較する。
   * - 月あたり額: 3ヶ月定期は÷3、6ヶ月定期は÷6(円未満四捨五入して表示)
   * - 損益分岐日数: 月あたり額 ÷ (片道運賃×2) の切り上げ(丸め前の値で計算)
   * - 年間額: 1ヶ月×12 / 3ヶ月×4 / 6ヶ月×2
   * - best: 月あたり額(丸め前)が最小の選択肢。同額の場合は
   *   都度払い > 1ヶ月 > 3ヶ月 > 6ヶ月 の順で柔軟なほうを選ぶ
   * @param {number} pass1 1ヶ月定期の価格(円)
   * @param {number} pass3 3ヶ月定期の価格(円)
   * @param {number} pass6 6ヶ月定期の価格(円)
   * @param {number} oneWayFare 片道運賃(円)
   * @param {number} daysPerMonth 月の利用日数(往復・1〜31の整数)
   * @returns {{ok: true, payg: number, perMonth1: number, perMonth3: number, perMonth6: number,
   *            breakEven1: number, breakEven3: number, breakEven6: number,
   *            year1: number, year3: number, year6: number, best: string}
   *          |{ok: false, code: string}}
   *   best: "payg" | "m1" | "m3" | "m6"
   *   code: "invalid_pass1" | "invalid_pass3" | "invalid_pass6" | "invalid_fare" | "invalid_days"
   */
  function comparePasses(pass1, pass3, pass6, oneWayFare, daysPerMonth) {
    if (!num(pass1, 1, 1000000)) return { ok: false, code: "invalid_pass1" };
    if (!num(pass3, 1, 3000000)) return { ok: false, code: "invalid_pass3" };
    if (!num(pass6, 1, 6000000)) return { ok: false, code: "invalid_pass6" };
    if (!num(oneWayFare, 1, 100000)) return { ok: false, code: "invalid_fare" };
    if (typeof daysPerMonth !== "number" || !isFinite(daysPerMonth) ||
        daysPerMonth !== Math.floor(daysPerMonth) || daysPerMonth < 1 || daysPerMonth > 31) {
      return { ok: false, code: "invalid_days" };
    }
    var roundTrip = oneWayFare * 2;
    var payg = roundTrip * daysPerMonth;
    var raw1 = pass1;
    var raw3 = pass3 / 3;
    var raw6 = pass6 / 6;
    var options = [
      { key: "payg", raw: payg },
      { key: "m1", raw: raw1 },
      { key: "m3", raw: raw3 },
      { key: "m6", raw: raw6 }
    ];
    var best = options[0];
    for (var i = 1; i < options.length; i++) {
      if (options[i].raw < best.raw) best = options[i];
    }
    return {
      ok: true,
      payg: payg,
      perMonth1: Math.round(raw1),
      perMonth3: Math.round(raw3),
      perMonth6: Math.round(raw6),
      breakEven1: Math.ceil(raw1 / roundTrip),
      breakEven3: Math.ceil(raw3 / roundTrip),
      breakEven6: Math.ceil(raw6 / roundTrip),
      year1: pass1 * 12,
      year3: pass3 * 4,
      year6: pass6 * 2,
      best: best.key
    };
  }

  var api = {
    comparePasses: comparePasses, compare: compare };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.TeikiCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
