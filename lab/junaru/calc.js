/*
 * 純アルコール量(g)の計算ロジック
 *
 * 根拠(一次情報):
 * - 厚生労働省「健康に配慮した飲酒に関するガイドライン」(令和6年=2024年2月公表)
 *   https://www.mhlw.go.jp/stf/newpage_38541.html (2026年7月29日参照)
 *   純アルコール量の計算式: 摂取量(ml) × アルコール濃度(度数/100) × 0.8(アルコールの比重)
 *   例: ビール500ml(5%) → 500 × 0.05 × 0.8 = 20g
 * - 同ガイドラインが引用する「生活習慣病のリスクを高める飲酒量」(健康日本21)
 *   1日あたりの純アルコール量が 男性40g以上・女性20g以上。
 *   「節度ある適度な飲酒」は1日あたり純アルコール量20g程度。
 *
 * 基準の時点:
 * - ガイドラインおよび基準値は【2024年(令和6年)2月公表】のもの(2026年7月29日時点で有効)。
 *
 * 前提:
 * - 0.8 はエタノールの比重(g/ml)。
 * - 純アルコール量は体格・年齢・体質(アルコール分解能力)を考慮しない摂取量そのもの。
 * - 基準値は「1日あたり」の量であり、週単位でまとめて飲んでよいという意味ではない。
 */
(function (global) {
  "use strict";

  var ETHANOL_DENSITY = 0.8; // アルコールの比重(g/ml)
  var RISK_MALE = 40; // 生活習慣病のリスクを高める量(男性、g/日)
  var RISK_FEMALE = 20; // 生活習慣病のリスクを高める量(女性、g/日)
  var MODERATE = 20; // 節度ある適度な飲酒量(g/日)
  var ML_MAX = 10000; // 1杯あたりの量の上限(ml)
  var CUPS_MAX = 100; // 杯数の上限

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /** 小数第n位で四捨五入する */
  function round(v, n) {
    var f = Math.pow(10, n);
    return Math.round(v * f) / f;
  }

  /**
   * 純アルコール量(g)を求める。
   * @param {number} ml 1杯あたりの飲酒量(ml、0より大きくML_MAX以下)
   * @param {number} abvPct アルコール度数(%、0より大きく100以下)
   * @param {number} [cups=1] 杯数(0より大きくCUPS_MAX以下)
   * @returns {{ok:true, grams:number, gramsPerCup:number, totalMl:number}
   *          |{ok:false, code:"invalid_ml"|"invalid_abv"|"invalid_cups"}}
   *   grams: 純アルコール量の合計(g、小数第1位で四捨五入)
   *   gramsPerCup: 1杯あたりの純アルコール量(g、小数第1位で四捨五入)
   */
  function grams(ml, abvPct, cups) {
    if (!isFiniteNumber(ml) || ml <= 0 || ml > ML_MAX) {
      return { ok: false, code: "invalid_ml" };
    }
    if (!isFiniteNumber(abvPct) || abvPct <= 0 || abvPct > 100) {
      return { ok: false, code: "invalid_abv" };
    }
    var n = cups === undefined ? 1 : cups;
    if (!isFiniteNumber(n) || n <= 0 || n > CUPS_MAX) {
      return { ok: false, code: "invalid_cups" };
    }
    var perCup = ml * (abvPct / 100) * ETHANOL_DENSITY;
    return {
      ok: true,
      grams: round(perCup * n, 1),
      gramsPerCup: round(perCup, 1),
      totalMl: round(ml * n, 1)
    };
  }

  /**
   * 純アルコール量を「生活習慣病のリスクを高める飲酒量」と比べる。
   * @param {number} g 1日あたりの純アルコール量(g、0以上)
   * @param {string} sex 性別。"male"(男性、基準40g) または "female"(女性、基準20g)
   * @returns {{ok:true, grams:number, threshold:number, overThreshold:boolean,
   *            overModerate:boolean, ratio:number}
   *          |{ok:false, code:"invalid_grams"|"invalid_sex"}}
   *   threshold: その性別の基準値(g/日)
   *   overThreshold: 生活習慣病のリスクを高める量に達しているか(基準値以上で true)
   *   overModerate: 節度ある適度な飲酒量(20g)を超えているか
   *   ratio: 基準値に対する割合(%、小数第1位で四捨五入)
   */
  function assess(g, sex) {
    if (!isFiniteNumber(g) || g < 0 || g > 100000) {
      return { ok: false, code: "invalid_grams" };
    }
    if (sex !== "male" && sex !== "female") {
      return { ok: false, code: "invalid_sex" };
    }
    var threshold = sex === "male" ? RISK_MALE : RISK_FEMALE;
    return {
      ok: true,
      grams: round(g, 1),
      threshold: threshold,
      overThreshold: g >= threshold,
      overModerate: g > MODERATE,
      ratio: round((g / threshold) * 100, 1)
    };
  }

  /**
   * 飲酒量から純アルコール量を計算し、基準値との比較までまとめて返す。
   * @param {number} ml 1杯あたりの飲酒量(ml)
   * @param {number} abvPct アルコール度数(%)
   * @param {number} cups 杯数
   * @param {string} sex 性別("male" / "female")
   * @returns {{ok:true, grams:number, gramsPerCup:number, totalMl:number, threshold:number,
   *            overThreshold:boolean, overModerate:boolean, ratio:number, beer500Equiv:number}
   *          |{ok:false, code:string}}
   *   beer500Equiv: ビール500ml(5%、純アルコール20g)に換算した杯数(小数第1位で四捨五入)
   */
  function calculate(ml, abvPct, cups, sex) {
    var g = grams(ml, abvPct, cups);
    if (!g.ok) return g;
    var a = assess(g.grams, sex);
    if (!a.ok) return a;
    return {
      ok: true,
      grams: g.grams,
      gramsPerCup: g.gramsPerCup,
      totalMl: g.totalMl,
      threshold: a.threshold,
      overThreshold: a.overThreshold,
      overModerate: a.overModerate,
      ratio: a.ratio,
      beer500Equiv: round(g.grams / 20, 1)
    };
  }

  var api = {
    RISK_MALE: RISK_MALE,
    RISK_FEMALE: RISK_FEMALE,
    MODERATE: MODERATE,
    grams: grams,
    assess: assess,
    calculate: calculate
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.JunaruCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
