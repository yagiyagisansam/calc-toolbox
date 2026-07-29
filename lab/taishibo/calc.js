/*
 * 体脂肪率(米海軍式 / U.S. Navy method)の推定ロジック
 *
 * 根拠:
 * - Calculator.net "Body Fat Calculator"(U.S. Navy法の計算式をメートル法・米国式の両方で明記)
 *   男性: BFP = 495 / (1.0324 − 0.19077×log10(waist − neck) + 0.15456×log10(height)) − 450
 *   女性: BFP = 495 / (1.29579 − 0.35004×log10(waist + hip − neck) + 0.22100×log10(height)) − 450
 *   (waist / neck / hip / height はいずれも cm)
 *   https://www.calculator.net/body-fat-calculator.html (2026年7月29日参照)
 * - 体脂肪率の区分は同ページ掲載の American Council on Exercise (ACE) の分類による
 *   男性: 必須脂肪2-5% / アスリート6-13% / フィットネス14-17% / 平均18-24% / 肥満25%以上
 *   女性: 必須脂肪10-13% / アスリート14-20% / フィットネス21-24% / 平均25-31% / 肥満32%以上
 *
 * 基準の時点:
 * - 2026年7月29日時点の上記ページの記載内容にもとづく。米海軍式の式・ACEの区分とも
 *   日本の公的機関が定めた基準ではない。
 *
 * 前提:
 * - 測定はすべて cm。男性は首囲と腹囲(へそ回り)、女性は首囲・腹囲(最も細い位置)・腰囲(ヒップ)を使う。
 * - 統計式による推定であり、体組成計やDXAの実測値とは差が出る。
 * - 男性は 腹囲 − 首囲 > 0、女性は 腹囲 + 腰囲 − 首囲 > 0 でないと計算できない(対数の中身が0以下になる)。
 *
 * 丸め:
 * - 体脂肪率は小数第1位に四捨五入する(統計式の精度を考えるとこれ以上細かくしても意味がないため)。
 * - 体脂肪量・除脂肪体重は小数第1位に四捨五入する。
 */
(function (global) {
  "use strict";

  function isNum(v) {
    return typeof v === "number" && isFinite(v);
  }
  function log10(v) {
    return Math.log(v) / Math.LN10;
  }
  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  // ACE(American Council on Exercise)の区分。[下限%, 名称] の昇順
  var CATEGORIES = {
    male: [[0, "必須脂肪"], [6, "アスリート"], [14, "フィットネス"], [18, "平均"], [25, "肥満"]],
    female: [[0, "必須脂肪"], [14, "アスリート"], [21, "フィットネス"], [25, "平均"], [32, "肥満"]]
  };

  /**
   * 体脂肪率から ACE の区分名を返す。
   * @param {"male"|"female"} sex 性別
   * @param {number} bodyFatPct 体脂肪率(%)
   * @returns {string} 区分名。性別が不正なら空文字
   */
  function category(sex, bodyFatPct) {
    var list = CATEGORIES[sex];
    if (!list) return "";
    var name = list[0][1];
    for (var i = 0; i < list.length; i++) {
      if (bodyFatPct >= list[i][0]) name = list[i][1];
    }
    return name;
  }

  /**
   * 米海軍式で体脂肪率を推定する。
   * @param {"male"|"female"} sex 性別
   * @param {number} heightCm 身長(cm)。100〜250
   * @param {number} neckCm 首囲(cm)。20〜80
   * @param {number} waistCm 腹囲(cm)。40〜200。男性はへそ回り、女性は最も細い位置
   * @param {number} [hipCm] 腰囲(ヒップ、cm)。40〜200。女性のみ必須
   * @returns {{ok:true, bodyFatPct:number, category:string}
   *          |{ok:false, code:"invalid_sex"|"invalid_height"|"invalid_neck"|"invalid_waist"
   *                          |"invalid_hip"|"invalid_measure"}}
   *   invalid_measure は 対数の中身が0以下になる、または推定値が0%以下になる場合。
   */
  function calculate(sex, heightCm, neckCm, waistCm, hipCm) {
    if (sex !== "male" && sex !== "female") return { ok: false, code: "invalid_sex" };
    if (!isNum(heightCm) || heightCm < 100 || heightCm > 250) return { ok: false, code: "invalid_height" };
    if (!isNum(neckCm) || neckCm < 20 || neckCm > 80) return { ok: false, code: "invalid_neck" };
    if (!isNum(waistCm) || waistCm < 40 || waistCm > 200) return { ok: false, code: "invalid_waist" };

    var inner;
    var denom;
    if (sex === "male") {
      inner = waistCm - neckCm;
      if (inner <= 0) return { ok: false, code: "invalid_measure" };
      denom = 1.0324 - 0.19077 * log10(inner) + 0.15456 * log10(heightCm);
    } else {
      if (!isNum(hipCm) || hipCm < 40 || hipCm > 200) return { ok: false, code: "invalid_hip" };
      inner = waistCm + hipCm - neckCm;
      if (inner <= 0) return { ok: false, code: "invalid_measure" };
      denom = 1.29579 - 0.35004 * log10(inner) + 0.22100 * log10(heightCm);
    }
    if (!isNum(denom) || denom <= 0) return { ok: false, code: "invalid_measure" };

    var bfp = 495 / denom - 450;
    if (!isNum(bfp) || bfp <= 0) return { ok: false, code: "invalid_measure" };
    var r = round1(bfp);
    return { ok: true, bodyFatPct: r, category: category(sex, r) };
  }

  /**
   * 体重も入れて、体脂肪量と除脂肪体重を求める。
   * @param {"male"|"female"} sex 性別
   * @param {number} heightCm 身長(cm)
   * @param {number} neckCm 首囲(cm)
   * @param {number} waistCm 腹囲(cm)
   * @param {number|null} hipCm 腰囲(cm)。男性は null でよい
   * @param {number} weightKg 体重(kg)。20〜300
   * @returns {{ok:true, bodyFatPct:number, category:string, fatMassKg:number, leanMassKg:number}
   *          |{ok:false, code:string}}
   *   fatMassKg = 体重 × 体脂肪率、leanMassKg = 体重 − 体脂肪量(いずれも小数第1位)。
   */
  function withWeight(sex, heightCm, neckCm, waistCm, hipCm, weightKg) {
    var r = calculate(sex, heightCm, neckCm, waistCm, hipCm);
    if (!r.ok) return r;
    if (!isNum(weightKg) || weightKg < 20 || weightKg > 300) return { ok: false, code: "invalid_weight" };
    var fat = weightKg * (r.bodyFatPct / 100);
    return {
      ok: true,
      bodyFatPct: r.bodyFatPct,
      category: r.category,
      fatMassKg: round1(fat),
      leanMassKg: round1(weightKg - fat)
    };
  }

  var api = {
    calculate: calculate,
    withWeight: withWeight,
    category: category
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.TaishiboCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
