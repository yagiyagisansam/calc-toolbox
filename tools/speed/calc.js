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

  /**
   * 出発時刻+距離+速さ(+休憩)から到着予定時刻を計算する。
   * 移動時間(分) = 距離 ÷ 速さ × 60 を分単位に四捨五入し、休憩(分)を足して出発時刻に加算。
   * 丸め方針: 移動時間は分単位で四捨五入。
   * @param {number} depH 出発時刻の時(0〜23)
   * @param {number} depM 出発時刻の分(0〜59)
   * @param {number} distanceKm 距離(km)
   * @param {number} speedKmh 速さ(km/h)
   * @param {number} breakMin 休憩時間の合計(分)。0以上
   * @returns {{ok:true, arriveH:number, arriveM:number, daysLater:number,
   *            travelMin:number, totalMin:number}
   *          |{ok:false, code:string}}
   *   daysLater: 日をまたぐ場合の日数(0=当日、1=翌日) / code: "invalid_time" | "invalid_value"
   */
  function arrival(depH, depM, distanceKm, speedKmh, breakMin) {
    if (!Number.isInteger(depH) || depH < 0 || depH > 23 ||
        !Number.isInteger(depM) || depM < 0 || depM > 59) {
      return { ok: false, code: "invalid_time" };
    }
    if (!valid(distanceKm, 100000) || !valid(speedKmh, 5000)) {
      return { ok: false, code: "invalid_value" };
    }
    if (typeof breakMin !== "number" || !isFinite(breakMin) || breakMin < 0 || breakMin > 100000) {
      return { ok: false, code: "invalid_value" };
    }
    var travelMin = Math.round(distanceKm / speedKmh * 60);
    var totalMin = travelMin + Math.round(breakMin);
    var abs = depH * 60 + depM + totalMin;
    return {
      ok: true,
      arriveH: Math.floor((abs % 1440) / 60),
      arriveM: abs % 60,
      daysLater: Math.floor(abs / 1440),
      travelMin: travelMin,
      totalMin: totalMin
    };
  }

  /**
   * 到着したい時刻から逆算して、出発すべき時刻を計算する。
   * 所要時間の計算は arrival と同じ(移動時間は分単位で四捨五入+休憩)。
   * @param {number} arrH 到着したい時刻の時(0〜23)
   * @param {number} arrM 到着したい時刻の分(0〜59)
   * @param {number} distanceKm 距離(km)
   * @param {number} speedKmh 速さ(km/h)
   * @param {number} breakMin 休憩時間の合計(分)。0以上
   * @returns {{ok:true, depH:number, depM:number, prevDay:boolean,
   *            travelMin:number, totalMin:number}
   *          |{ok:false, code:string}}
   *   prevDay: 前日に出発する必要がある場合 true / code: "invalid_time" | "invalid_value"
   */
  function departure(arrH, arrM, distanceKm, speedKmh, breakMin) {
    if (!Number.isInteger(arrH) || arrH < 0 || arrH > 23 ||
        !Number.isInteger(arrM) || arrM < 0 || arrM > 59) {
      return { ok: false, code: "invalid_time" };
    }
    if (!valid(distanceKm, 100000) || !valid(speedKmh, 5000)) {
      return { ok: false, code: "invalid_value" };
    }
    if (typeof breakMin !== "number" || !isFinite(breakMin) || breakMin < 0 || breakMin > 100000) {
      return { ok: false, code: "invalid_value" };
    }
    var travelMin = Math.round(distanceKm / speedKmh * 60);
    var totalMin = travelMin + Math.round(breakMin);
    var abs = arrH * 60 + arrM - totalMin;
    var prevDay = abs < 0;
    while (abs < 0) abs += 1440;
    return {
      ok: true,
      depH: Math.floor(abs / 60),
      depM: abs % 60,
      prevDay: prevDay,
      travelMin: travelMin,
      totalMin: totalMin
    };
  }

  /**
   * 時速(km/h)を分速(m/分)と秒速(m/s)に換算する。理科の宿題向け。
   * 分速(m/分) = 時速 × 1000 ÷ 60 / 秒速(m/s) = 時速 ÷ 3.6
   * 丸め方針: 小数第2位で四捨五入。
   * @param {number} kmh 時速(km/h)
   * @returns {{ok:true, mPerMin:number, mPerSec:number}|{ok:false, code:string}}
   */
  function speedUnits(kmh) {
    if (!valid(kmh, 5000)) return { ok: false, code: "invalid_value" };
    return {
      ok: true,
      mPerMin: round2(kmh * 1000 / 60),
      mPerSec: round2(kmh / 3.6)
    };
  }

  var api = {
    speedUnits: speedUnits,
    departure: departure,
    arrival: arrival, solve: solve };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.SpeedCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
