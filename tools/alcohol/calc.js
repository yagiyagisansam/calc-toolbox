/*
 * 純アルコール量 計算ロジック
 *
 * 計算式の根拠(一次情報):
 * - 純アルコール量(g) = 摂取量(mL) × アルコール度数(%)/100 × 0.8(アルコールの比重)
 *   出典: 厚生労働省 e-ヘルスネット「飲酒量の単位」(健康日本21アクション支援システム)
 *   https://kennet.mhlw.go.jp/information/information/alcohol/a-02-001.html
 * - 生活習慣病のリスクを高める飲酒量: 1日あたり純アルコール 男性40g以上・女性20g以上
 *   出典: 厚生労働省「健康に配慮した飲酒に関するガイドライン」(2024)
 *   https://www.mhlw.go.jp/stf/newpage_38541.html
 *
 * 前提:
 * - 判定は「表示値(小数第1位に四捨五入した純アルコール量)」に対して行う
 * - ドリンク数は国際的に用いられる 1ドリンク=純アルコール10g で換算
 */
(function (global) {
  "use strict";

  var VOLUME_MIN_ML = 1;
  var VOLUME_MAX_ML = 10000;
  var ABV_MIN = 0.1;
  var ABV_MAX = 96;
  var RISK_THRESHOLD_G = { male: 40, female: 20 };

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  /**
   * 純アルコール量を計算する。
   * @param {number} volumeMl 摂取量(mL)
   * @param {number} abvPercent アルコール度数(%)
   * @param {string} sex "male" | "female"(リスク判定の閾値に使用)
   * @returns {{ok: true, grams: number, drinks: number, exceedsRisk: boolean}
   *          |{ok: false, code: string}}
   *   code: "invalid_volume" | "invalid_abv" | "invalid_sex"
   */
  function calculate(volumeMl, abvPercent, sex) {
    if (!isFiniteNumber(volumeMl) || volumeMl < VOLUME_MIN_ML || volumeMl > VOLUME_MAX_ML) {
      return { ok: false, code: "invalid_volume" };
    }
    if (!isFiniteNumber(abvPercent) || abvPercent < ABV_MIN || abvPercent > ABV_MAX) {
      return { ok: false, code: "invalid_abv" };
    }
    if (sex !== "male" && sex !== "female") {
      return { ok: false, code: "invalid_sex" };
    }
    var grams = round1(volumeMl * (abvPercent / 100) * 0.8);
    return {
      ok: true,
      grams: grams,
      drinks: round1(grams / 10),
      exceedsRisk: grams >= RISK_THRESHOLD_G[sex]
    };
  }

  var api = {
    calculate: calculate,
    VOLUME_MIN_ML: VOLUME_MIN_ML,
    VOLUME_MAX_ML: VOLUME_MAX_ML,
    ABV_MIN: ABV_MIN,
    ABV_MAX: ABV_MAX
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.AlcoholCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
