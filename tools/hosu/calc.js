/*
 * 歩数→距離・カロリー換算ロジック
 *
 * 計算方法(目安):
 * - 歩幅の目安 = 身長 × 0.45(ふつうに歩くときの一般的な目安係数)
 * - 距離 = 歩数 × 歩幅
 * - 時間の目安 = 距離 ÷ 4km/h(ふつうの歩行速度)
 * - 消費カロリー = 1.05 × 3.0METs × 時間(h) × 体重(kg)(歩行のMETs値・厚労省の式)
 */
(function (global) {
  "use strict";

  var STRIDE_RATE = 0.45;
  var SPEED_KMH = 4;
  var METS = 3.0;

  function round1(x) { return Math.round(x * 10) / 10; }
  function round2(x) { return Math.round(x * 100) / 100; }

  /**
   * 歩数から距離・時間・消費カロリーを計算する。
   * @param {number} steps 歩数(1〜200,000)
   * @param {number} heightCm 身長(cm・100〜250)
   * @param {number} [weightKg] 体重(kg・任意。入れるとカロリーも計算)
   * @returns {{ok: true, strideCm: number, distanceKm: number, timeMin: number, kcal?: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_steps" | "invalid_height" | "invalid_weight"
   */
  function calc(steps, heightCm, weightKg) {
    if (typeof steps !== "number" || !isFinite(steps) || steps < 1 || steps > 200000) {
      return { ok: false, code: "invalid_steps" };
    }
    if (typeof heightCm !== "number" || !isFinite(heightCm) || heightCm < 100 || heightCm > 250) {
      return { ok: false, code: "invalid_height" };
    }
    var strideM = heightCm * STRIDE_RATE / 100;
    var km = steps * strideM / 1000;
    var hours = km / SPEED_KMH;
    var out = {
      ok: true,
      strideCm: round1(heightCm * STRIDE_RATE),
      distanceKm: round2(km),
      timeMin: Math.round(hours * 60)
    };
    if (weightKg !== undefined && weightKg !== null) {
      if (typeof weightKg !== "number" || !isFinite(weightKg) || weightKg < 20 || weightKg > 300) {
        return { ok: false, code: "invalid_weight" };
      }
      out.kcal = Math.round(1.05 * METS * hours * weightKg);
    }
    return out;
  }

  var api = { calc: calc, STRIDE_RATE: STRIDE_RATE };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.HosuCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
