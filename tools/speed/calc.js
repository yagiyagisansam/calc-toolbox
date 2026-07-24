/*
 * 速さ・時間・距離計算ロジック(「はじき」の計算)
 *
 * 計算方法:
 * - 距離 = 速さ × 時間 / 速さ = 距離 ÷ 時間 / 時間 = 距離 ÷ 速さ
 * - 3つのうちちょうど2つを渡すと残り1つを計算する(時間は分で扱う)
 * - 表示は小数第2位で四捨五入
 */
(function (global) {
  "use strict";

  function round2(x) { return Math.round(x * 100) / 100; }

  function valid(v, max) {
    return typeof v === "number" && isFinite(v) && v > 0 && v <= max;
  }

  /**
   * 速さ・距離・時間のうち2つから残りを計算する。
   * @param {{speedKmh?: number, distanceKm?: number, timeMin?: number}} given
   *   ちょうど2つを指定する(残りは undefined/null)
   * @returns {{ok: true, speedKmh: number, distanceKm: number, timeMin: number,
   *            timeH: number, timeM: number}|{ok: false, code: string}}
   *   timeH/timeM: 時間の「○時間△分」表記(分は四捨五入)
   *   code: "invalid_input" | "invalid_value"
   */
  function solve(given) {
    if (!given || typeof given !== "object") return { ok: false, code: "invalid_input" };
    var s = given.speedKmh;
    var d = given.distanceKm;
    var t = given.timeMin;
    var count = (s != null ? 1 : 0) + (d != null ? 1 : 0) + (t != null ? 1 : 0);
    if (count !== 2) return { ok: false, code: "invalid_input" };
    if (s != null && !valid(s, 5000)) return { ok: false, code: "invalid_value" };
    if (d != null && !valid(d, 100000)) return { ok: false, code: "invalid_value" };
    if (t != null && !valid(t, 100000)) return { ok: false, code: "invalid_value" };
    if (s == null) s = d / (t / 60);
    else if (d == null) d = s * (t / 60);
    else t = d / s * 60;
    var totalMin = Math.round(t);
    return {
      ok: true,
      speedKmh: round2(s),
      distanceKm: round2(d),
      timeMin: round2(t),
      timeH: Math.floor(totalMin / 60),
      timeM: totalMin % 60
    };
  }

  var api = { solve: solve };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.SpeedCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
