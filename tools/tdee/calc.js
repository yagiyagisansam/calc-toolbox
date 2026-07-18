/*
 * 1日の摂取カロリー目安(推定エネルギー必要量)計算ロジック
 *
 * 計算式の根拠(一次情報):
 * - 推定エネルギー必要量(kcal/日) = 基礎代謝量(kcal/日) × 身体活動レベル
 * - 基礎代謝量 = 基礎代謝基準値(食事摂取基準の年齢区分別・男女別) × 体重
 *   出典: 厚生労働省 e-ヘルスネット「加齢とエネルギー代謝」
 *   https://kennet.mhlw.go.jp/information/information/food/e-07-002.html
 * - 身体活動レベル(成人の代表値): Ⅰ低い=1.50 / Ⅱふつう=1.75 / Ⅲ高い=2.00
 *   出典: 厚生労働省「日本人の食事摂取基準」策定資料
 *   https://www.mhlw.go.jp/content/10904750/001396865.pdf
 *
 * 前提:
 * - 対象は成人(18歳以上)。高齢者の身体活動レベルは代表値よりやや低くなる傾向(ページに注記)
 * - 基準値表は tools/bmr/ と同一(食事摂取基準2015年版の表から転記)
 */
(function (global) {
  "use strict";

  var AGE_MIN = 18;
  var AGE_MAX = 120;
  var WEIGHT_MIN_KG = 20;
  var WEIGHT_MAX_KG = 300;

  var STANDARD_VALUES = [
    [18, 29, 24.0, 22.1],
    [30, 49, 22.3, 21.7],
    [50, 69, 21.5, 20.7],
    [70, 120, 21.5, 20.7]
  ];

  var PAL = { low: 1.50, normal: 1.75, high: 2.00 };

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * 1日の摂取カロリー目安を計算する。
   * @param {number} age 年齢(18〜120・整数)
   * @param {string} sex "male" | "female"
   * @param {number} weightKg 体重(kg)
   * @param {string} pal "low"(Ⅰ) | "normal"(Ⅱ) | "high"(Ⅲ)
   * @returns {{ok: true, bmrKcal: number, palValue: number, tdeeKcal: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_age" | "invalid_sex" | "invalid_weight" | "invalid_pal"
   */
  function calculate(age, sex, weightKg, pal) {
    if (!isFiniteNumber(age) || age !== Math.floor(age) || age < AGE_MIN || age > AGE_MAX) {
      return { ok: false, code: "invalid_age" };
    }
    if (sex !== "male" && sex !== "female") {
      return { ok: false, code: "invalid_sex" };
    }
    if (!isFiniteNumber(weightKg) || weightKg < WEIGHT_MIN_KG || weightKg > WEIGHT_MAX_KG) {
      return { ok: false, code: "invalid_weight" };
    }
    if (!(pal in PAL)) {
      return { ok: false, code: "invalid_pal" };
    }
    var std = null;
    for (var i = 0; i < STANDARD_VALUES.length; i++) {
      if (age >= STANDARD_VALUES[i][0] && age <= STANDARD_VALUES[i][1]) {
        std = sex === "male" ? STANDARD_VALUES[i][2] : STANDARD_VALUES[i][3];
        break;
      }
    }
    var bmrRaw = std * weightKg;
    return {
      ok: true,
      bmrKcal: Math.round(bmrRaw),
      palValue: PAL[pal],
      tdeeKcal: Math.round(bmrRaw * PAL[pal])
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
    global.TdeeCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
