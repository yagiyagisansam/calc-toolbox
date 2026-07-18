/*
 * 基礎代謝量 計算ロジック
 *
 * 計算式の根拠(一次情報):
 * - 基礎代謝量(kcal/日) = 基礎代謝基準値(kcal/kg体重/日) × 体重(kg)
 * - 基礎代謝基準値は「日本人の食事摂取基準(2015年版)」の年齢区分別・男女別の値
 *   出典: 厚生労働省 e-ヘルスネット「加齢とエネルギー代謝」(健康日本21アクション支援システム)
 *   https://kennet.mhlw.go.jp/information/information/food/e-07-002.html
 *   (基準値表は上記ページの表1から転記。2026-07-18参照)
 *
 * 前提:
 * - 基準値は各年齢区分の「参照体重」における平均値。体格・筋肉量による個人差は反映されない
 * - 対象は1歳以上
 */
(function (global) {
  "use strict";

  var AGE_MIN = 1;
  var AGE_MAX = 120;
  var WEIGHT_MIN_KG = 5;
  var WEIGHT_MAX_KG = 300;

  // 基礎代謝基準値(kcal/kg体重/日)。[年齢下限, 年齢上限, 男性, 女性]
  var STANDARD_VALUES = [
    [1, 2, 61.0, 59.7],
    [3, 5, 54.8, 52.2],
    [6, 7, 44.3, 41.9],
    [8, 9, 40.8, 38.3],
    [10, 11, 37.4, 34.8],
    [12, 14, 31.0, 29.6],
    [15, 17, 27.0, 25.3],
    [18, 29, 24.0, 22.1],
    [30, 49, 22.3, 21.7],
    [50, 69, 21.5, 20.7],
    [70, 120, 21.5, 20.7]
  ];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 基礎代謝量を計算する。
   * @param {number} age 年齢(歳・整数)
   * @param {string} sex "male" | "female"
   * @param {number} weightKg 体重(kg)
   * @returns {{ok: true, standardValue: number, bmrKcal: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_age" | "invalid_sex" | "invalid_weight"
   */
  function calculate(age, sex, weightKg) {
    if (!isFiniteNumber(age) || age !== Math.floor(age) || age < AGE_MIN || age > AGE_MAX) {
      return { ok: false, code: "invalid_age" };
    }
    if (sex !== "male" && sex !== "female") {
      return { ok: false, code: "invalid_sex" };
    }
    if (!isFiniteNumber(weightKg) || weightKg < WEIGHT_MIN_KG || weightKg > WEIGHT_MAX_KG) {
      return { ok: false, code: "invalid_weight" };
    }
    var std = null;
    for (var i = 0; i < STANDARD_VALUES.length; i++) {
      var row = STANDARD_VALUES[i];
      if (age >= row[0] && age <= row[1]) {
        std = sex === "male" ? row[2] : row[3];
        break;
      }
    }
    return {
      ok: true,
      standardValue: std,
      bmrKcal: Math.round(std * weightKg)
    };
  }

  var api = {
    calculate: calculate,
    AGE_MIN: AGE_MIN,
    AGE_MAX: AGE_MAX,
    WEIGHT_MIN_KG: WEIGHT_MIN_KG,
    WEIGHT_MAX_KG: WEIGHT_MAX_KG
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.BmrCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
