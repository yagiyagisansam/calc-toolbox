/*
 * ウォーキング消費カロリー計算ロジック(METs方式)
 *
 * 計算方法:
 * - 消費エネルギー(kcal) = 1.05 × METs × 時間(h) × 体重(kg)
 *   (厚生労働省「健康づくりのための運動指針2006(エクササイズガイド)」の式)
 * - 歩く速さごとのMETs値は「身体活動のメッツ(METs)表」(国立健康・栄養研究所)より:
 *   ゆっくり(約3.2km/h)=2.8 / ふつう(約4.0km/h)=3.0 / やや速め(約4.8km/h)=3.5 /
 *   速歩(約5.6km/h)=4.3 / かなり速い(約6.4km/h)=5.0
 * - 脂肪換算は体脂肪1kg≒7,200kcalの目安で計算(e-ヘルスネット)
 */
(function (global) {
  "use strict";

  var METS = {
    slow: 2.8,
    normal: 3.0,
    brisk: 3.5,
    fast: 4.3,
    veryfast: 5.0
  };

  /**
   * ウォーキングの消費カロリーを計算する。
   * @param {number} weightKg 体重(kg)
   * @param {number} minutes 歩いた時間(分)
   * @param {string} speed 歩く速さ "slow"|"normal"|"brisk"|"fast"|"veryfast"
   * @returns {{ok: true, kcal: number, fatG: number, mets: number}
   *          |{ok: false, code: string}}
   *   kcal: 消費エネルギー(kcal) / fatG: 脂肪換算(g) / mets: 使用したMETs値
   *   code: "invalid_weight" | "invalid_minutes" | "invalid_speed"
   */
  function calories(weightKg, minutes, speed) {
    if (typeof weightKg !== "number" || !isFinite(weightKg) || weightKg < 20 || weightKg > 300) {
      return { ok: false, code: "invalid_weight" };
    }
    if (typeof minutes !== "number" || !isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
      return { ok: false, code: "invalid_minutes" };
    }
    if (!Object.prototype.hasOwnProperty.call(METS, speed)) {
      return { ok: false, code: "invalid_speed" };
    }
    var mets = METS[speed];
    var raw = 1.05 * mets * (minutes / 60) * weightKg;
    return {
      ok: true,
      kcal: Math.round(raw),
      fatG: Math.round(raw / 7.2),
      mets: mets
    };
  }

  var api = {
    calories: calories,
    METS: METS
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.WalkingCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
