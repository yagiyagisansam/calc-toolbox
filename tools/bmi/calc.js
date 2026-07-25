/*
 * BMI・適正体重 計算ロジック
 *
 * 計算式の根拠(一次情報):
 * - BMI = 体重(kg) ÷ 身長(m)²、適正体重(標準体重) = 22 × 身長(m)²
 *   出典: 厚生労働省 e-ヘルスネット「BMI」
 *   https://kennet.mhlw.go.jp/information/information/dictionary/metabolic/ym-002.html
 * - 肥満度判定基準(成人): 日本肥満学会「肥満症診療ガイドライン2016」
 *   (18.5未満=低体重 / 18.5以上25未満=普通体重 / 25以上=肥満(1〜4度))
 *
 * 前提:
 * - 対象は成人。小児・妊婦には適用しない(ページ側に明記)
 * - 判定カテゴリは「表示値(小数第1位に四捨五入したBMI)」に対して適用する。
 *   表示されるBMIと判定が食い違わないようにするため
 *
 * ブラウザでは window.BmiCalc、Node(テストランナー)では module.exports で公開する。
 */
(function (global) {
  "use strict";

  // 入力の対応範囲(この範囲外は入力誤りとみなす)
  var HEIGHT_MIN_CM = 100;
  var HEIGHT_MAX_CM = 250;
  var WEIGHT_MIN_KG = 20;
  var WEIGHT_MAX_KG = 300;

  // 日本肥満学会の判定基準(下限値と判定名。上から順に評価)
  var CATEGORIES = [
    { min: 40, label: "肥満(4度)" },
    { min: 35, label: "肥満(3度)" },
    { min: 30, label: "肥満(2度)" },
    { min: 25, label: "肥満(1度)" },
    { min: 18.5, label: "普通体重" },
    { min: 0, label: "低体重" }
  ];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  function categorize(bmi) {
    for (var i = 0; i < CATEGORIES.length; i++) {
      if (bmi >= CATEGORIES[i].min) return CATEGORIES[i].label;
    }
    return CATEGORIES[CATEGORIES.length - 1].label;
  }

  /**
   * BMIと適正体重を計算する。
   * @param {number} heightCm 身長(cm)
   * @param {number} weightKg 体重(kg)
   * @returns {{ok: true, bmi: number, category: string, idealWeightKg: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_height" | "invalid_weight"
   */
  function calculate(heightCm, weightKg) {
    if (!isFiniteNumber(heightCm) || heightCm < HEIGHT_MIN_CM || heightCm > HEIGHT_MAX_CM) {
      return { ok: false, code: "invalid_height" };
    }
    if (!isFiniteNumber(weightKg) || weightKg < WEIGHT_MIN_KG || weightKg > WEIGHT_MAX_KG) {
      return { ok: false, code: "invalid_weight" };
    }
    var heightM = heightCm / 100;
    var bmi = round1(weightKg / (heightM * heightM));
    return {
      ok: true,
      bmi: bmi,
      category: categorize(bmi),
      idealWeightKg: round1(22 * heightM * heightM)
    };
  }

  /**
   * 目標BMIから目標体重と現在との差を逆算する。
   * 丸め方針: 目標体重は小数第1位に四捨五入し、差は「現在の体重 − 丸めた目標体重」を
   * さらに小数第1位に四捨五入(表示値どうしで矛盾しないようにするため)。
   * @param {number} heightCm 身長(cm・100〜250)
   * @param {number} weightKg 現在の体重(kg・20〜300)
   * @param {number} [targetBmi] 目標BMI(10〜40)。省略時は22(適正体重の基準)
   * @returns {{ok:true, targetBmi:number, targetWeightKg:number, diffKg:number}
   *          |{ok:false, code:string}}
   *   diffKg>0: あとdiffKg減量が必要 / diffKg<0: 増量が必要
   *   code: "invalid_height" | "invalid_weight" | "invalid_target_bmi"
   */
  function targetFromBmi(heightCm, weightKg, targetBmi) {
    if (!isFiniteNumber(heightCm) || heightCm < HEIGHT_MIN_CM || heightCm > HEIGHT_MAX_CM) {
      return { ok: false, code: "invalid_height" };
    }
    if (!isFiniteNumber(weightKg) || weightKg < WEIGHT_MIN_KG || weightKg > WEIGHT_MAX_KG) {
      return { ok: false, code: "invalid_weight" };
    }
    if (targetBmi === undefined || targetBmi === null) targetBmi = 22;
    if (!isFiniteNumber(targetBmi) || targetBmi < 10 || targetBmi > 40) {
      return { ok: false, code: "invalid_target_bmi" };
    }
    var heightM = heightCm / 100;
    var targetWeightKg = round1(targetBmi * heightM * heightM);
    return {
      ok: true,
      targetBmi: targetBmi,
      targetWeightKg: targetWeightKg,
      diffKg: round1(weightKg - targetWeightKg)
    };
  }

  /**
   * 身長からBMI別の体重早見表を作る(BMI 18.5 / 20 / 22 / 25 / 30)。
   * 丸め方針: 体重は小数第1位に四捨五入。
   * @param {number} heightCm 身長(cm・100〜250)
   * @returns {{ok:true, rows:Array<{bmi:number, weightKg:number, label:string}>}
   *          |{ok:false, code:string}}  code: "invalid_height"
   */
  function bmiWeightTable(heightCm) {
    if (!isFiniteNumber(heightCm) || heightCm < HEIGHT_MIN_CM || heightCm > HEIGHT_MAX_CM) {
      return { ok: false, code: "invalid_height" };
    }
    var heightM = heightCm / 100;
    var POINTS = [
      { bmi: 18.5, label: "低体重との境界" },
      { bmi: 20, label: "細めの普通体重" },
      { bmi: 22, label: "適正体重(統計的に病気が最も少ない)" },
      { bmi: 25, label: "肥満(1度)との境界" },
      { bmi: 30, label: "肥満(2度)との境界" }
    ];
    var rows = [];
    for (var i = 0; i < POINTS.length; i++) {
      rows.push({
        bmi: POINTS[i].bmi,
        label: POINTS[i].label,
        weightKg: round1(POINTS[i].bmi * heightM * heightM)
      });
    }
    return { ok: true, rows: rows };
  }

  var api = {
    bmiWeightTable: bmiWeightTable,
    targetFromBmi: targetFromBmi,
    calculate: calculate,
    HEIGHT_MIN_CM: HEIGHT_MIN_CM,
    HEIGHT_MAX_CM: HEIGHT_MAX_CM,
    WEIGHT_MIN_KG: WEIGHT_MIN_KG,
    WEIGHT_MAX_KG: WEIGHT_MAX_KG
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.BmiCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
