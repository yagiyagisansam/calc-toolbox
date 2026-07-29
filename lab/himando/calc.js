/*
 * 子どもの肥満度(学校保健統計方式)の計算ロジック
 *
 * 根拠(一次情報):
 * - 文部科学省「学校保健統計調査」(参考)肥満・痩身傾向児の算出方法について
 *   https://www.mext.go.jp/content/20260213-mxt_chousa01-000046876_3.pdf (2026年7月29日参照)
 *   ・肥満度(過体重度) = 〔実測体重(kg) − 身長別標準体重(kg)〕 ÷ 身長別標準体重(kg) × 100(%)
 *   ・身長別標準体重(kg) = a × 実測身長(cm) − b (係数a・bは性別・年齢別)
 *   ・肥満度が20%以上の者を肥満傾向児、−20%以下の者を痩身傾向児とする(平成18年度から)
 *   ・係数の出典は公益財団法人日本学校保健会「児童生徒の健康診断マニュアル(平成27年度改訂版)」
 * - 一覧ページ: 文部科学省「学校保健統計調査」
 *   https://www.mext.go.jp/b_menu/toukei/chousa05/hoken/1268826.htm (2026年7月29日参照)
 *
 * 前提:
 * - 対象は5歳〜17歳。この式は乳幼児(4歳以下)や18歳以上には使えない
 * - 年齢は文部科学省の調査に合わせ、その年度の4月1日時点の満年齢を想定
 * - 丸め: 身長別標準体重は小数第1位まで(四捨五入)。肥満度も小数第1位まで(四捨五入)し、
 *   丸めた肥満度で判定する(20.0%以上/−20.0%以下が境界)
 * - 肥満度の計算では丸める前の標準体重を使う(表示だけを小数第1位に丸める)
 */
(function (global) {
  "use strict";

  // 係数[年齢] = [男子a, 男子b, 女子a, 女子b] (文部科学省の算出方法PDFの表そのまま)
  var COEF = {
    5: [0.386, 23.699, 0.377, 22.750],
    6: [0.461, 32.382, 0.458, 32.079],
    7: [0.513, 38.878, 0.508, 38.367],
    8: [0.592, 48.804, 0.561, 45.006],
    9: [0.687, 61.390, 0.652, 56.992],
    10: [0.752, 70.461, 0.730, 68.091],
    11: [0.782, 75.106, 0.803, 78.846],
    12: [0.783, 75.642, 0.796, 76.934],
    13: [0.815, 81.348, 0.655, 54.234],
    14: [0.832, 83.695, 0.594, 43.264],
    15: [0.766, 70.989, 0.560, 37.002],
    16: [0.656, 51.822, 0.578, 39.057],
    17: [0.672, 53.642, 0.598, 42.339]
  };

  var MIN_AGE = 5;
  var MAX_AGE = 17;
  var MIN_HEIGHT = 80;   // cm
  var MAX_HEIGHT = 220;  // cm
  var MIN_WEIGHT = 5;    // kg
  var MAX_WEIGHT = 200;  // kg

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  /**
   * 身長別標準体重を求める(学校保健統計方式)。
   * @param {"male"|"female"} sex 性別
   * @param {number} age 年齢(5〜17の整数)
   * @param {number} heightCm 実測身長(cm。80〜220)
   * @returns {{ok:true, standardWeightKg:number, exactWeightKg:number, a:number, b:number}
   *          |{ok:false, code:"invalid_sex"|"invalid_age"|"invalid_height"|"invalid_result"}}
   *   standardWeightKg は小数第1位に丸めた値、exactWeightKg は丸める前の値
   *   計算結果が0以下になる身長では invalid_result を返す(式の適用範囲外)
   */
  function standardWeight(sex, age, heightCm) {
    if (sex !== "male" && sex !== "female") return { ok: false, code: "invalid_sex" };
    if (!isFiniteNumber(age) || age !== Math.floor(age) || age < MIN_AGE || age > MAX_AGE) {
      return { ok: false, code: "invalid_age" };
    }
    if (!isFiniteNumber(heightCm) || heightCm < MIN_HEIGHT || heightCm > MAX_HEIGHT) {
      return { ok: false, code: "invalid_height" };
    }
    var c = COEF[age];
    var a = sex === "male" ? c[0] : c[2];
    var b = sex === "male" ? c[1] : c[3];
    var w = a * heightCm - b;
    if (!(w > 0)) return { ok: false, code: "invalid_result" };
    return { ok: true, standardWeightKg: round1(w), exactWeightKg: w, a: a, b: b };
  }

  /**
   * 肥満度(過体重度)を計算し、肥満傾向・痩身傾向を判定する。
   * @param {"male"|"female"} sex 性別
   * @param {number} age 年齢(5〜17の整数)
   * @param {number} heightCm 実測身長(cm。80〜220)
   * @param {number} weightKg 実測体重(kg。5〜200)
   * @returns {{ok:true, standardWeightKg:number, degreePercent:number, category:string,
   *            diffKg:number}
   *          |{ok:false, code:"invalid_sex"|"invalid_age"|"invalid_height"|"invalid_weight"
   *                          |"invalid_result"}}
   *   degreePercent: 肥満度(%、小数第1位。プラスが肥満方向)
   *   category: "肥満傾向"(+20.0%以上) / "痩身傾向"(−20.0%以下) / "標準"
   *   diffKg: 実測体重 − 標準体重(小数第1位)
   */
  function calculate(sex, age, heightCm, weightKg) {
    var s = standardWeight(sex, age, heightCm);
    if (!s.ok) return s;
    if (!isFiniteNumber(weightKg) || weightKg < MIN_WEIGHT || weightKg > MAX_WEIGHT) {
      return { ok: false, code: "invalid_weight" };
    }
    var degree = round1(((weightKg - s.exactWeightKg) / s.exactWeightKg) * 100);
    var category = degree >= 20 ? "肥満傾向" : (degree <= -20 ? "痩身傾向" : "標準");
    return {
      ok: true,
      standardWeightKg: s.standardWeightKg,
      degreePercent: degree,
      category: category,
      diffKg: round1(weightKg - s.exactWeightKg)
    };
  }

  /**
   * 肥満傾向・痩身傾向の境界となる体重(±20%)を返す。
   * @param {"male"|"female"} sex 性別
   * @param {number} age 年齢(5〜17の整数)
   * @param {number} heightCm 実測身長(cm)
   * @returns {{ok:true, standardWeightKg:number, obeseFromKg:number, thinUpToKg:number}
   *          |{ok:false, code:string}}
   *   obeseFromKg: この体重以上で肥満傾向 / thinUpToKg: この体重以下で痩身傾向
   *   境界がずれないよう小数第2位まで残す
   */
  function thresholds(sex, age, heightCm) {
    var s = standardWeight(sex, age, heightCm);
    if (!s.ok) return s;
    return {
      ok: true,
      standardWeightKg: s.standardWeightKg,
      obeseFromKg: round2(s.exactWeightKg * 1.2),
      thinUpToKg: round2(s.exactWeightKg * 0.8)
    };
  }

  var api = {
    standardWeight: standardWeight,
    calculate: calculate,
    thresholds: thresholds
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.HimandoCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
