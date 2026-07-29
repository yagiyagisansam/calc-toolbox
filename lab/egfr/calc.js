/*
 * eGFR(推算糸球体濾過量)の計算ロジック
 *
 * 根拠(一次情報):
 * - 日本腎臓学会「CKD診療ガイド2012」eGFR男女・年齢別早見表
 *   eGFRcreat = 194 × Cr^(-1.094) × 年齢(歳)^(-0.287)  女性はこれに × 0.739
 *   https://cdn.jsn.or.jp/guideline/pdf/CKDguide2012_3.pdf (2026年7月29日参照)
 * - 日本腎臓学会 診療ガイドライン一覧
 *   https://jsn.or.jp/medic/guideline/ (2026年7月29日参照)
 * - 厚生労働科学研究 腎疾患政策研究事業「腎機能(eGFR)測定ツール」GFR区分(G1〜G5)
 *   https://ckd-research.jp/admin/calculate_egfr/ (2026年7月29日参照)
 *
 * 前提:
 * - 日本人向けの3変数式(血清クレアチニン・年齢・性別)。18歳以上の成人が対象で、小児には使えない
 * - 血清クレアチニン値は酵素法で測定した値(mg/dL)
 * - 体表面積1.73m²あたりに補正した値(mL/分/1.73m²)。薬の投与量調整には個別補正が必要
 * - 筋肉量の影響を受けるため、極端な痩せ・筋肉質・四肢欠損では実際の腎機能とずれる
 * - GFR区分は日本腎臓学会の早見表にならい小数点以下2桁の値で判定する
 *   (表示するeGFRは小数第1位で四捨五入するため、境界付近では表示値と区分が食い違って見えることがある)
 */
(function (global) {
  "use strict";

  var CR_MIN = 0.1;
  var CR_MAX = 30;
  var AGE_MIN = 18;
  var AGE_MAX = 120;

  var COEF = 194;
  var CR_EXP = -1.094;
  var AGE_EXP = -0.287;
  var FEMALE_FACTOR = 0.739;

  // [区分, この値以上ならこの区分]。上から順に判定する
  var STAGES = [
    ["G1", 90],
    ["G2", 60],
    ["G3a", 45],
    ["G3b", 30],
    ["G4", 15],
    ["G5", 0]
  ];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round(v, digits) {
    var f = Math.pow(10, digits);
    return Math.round(v * f) / f;
  }

  /**
   * eGFRの値からCKDのGFR区分を判定する。
   * @param {number} egfr eGFR(mL/分/1.73m²)
   * @returns {"G1"|"G2"|"G3a"|"G3b"|"G4"|"G5"} GFR区分
   */
  function stageOf(egfr) {
    var v = round(egfr, 2);
    for (var i = 0; i < STAGES.length; i++) {
      if (v >= STAGES[i][1]) return STAGES[i][0];
    }
    return "G5";
  }

  /**
   * 血清クレアチニン値・年齢・性別からeGFRとCKDのGFR区分を計算する。
   * @param {number} crMgDl 血清クレアチニン値(mg/dL。0.1〜30)
   * @param {number} age 年齢(歳。18〜120)
   * @param {string} sex 性別。"male"(男性) または "female"(女性)
   * @returns {{ok:true, egfr:number, egfrRaw:number, stage:"G1"|"G2"|"G3a"|"G3b"|"G4"|"G5"}
   *          |{ok:false, code:"invalid_cr"|"invalid_age"|"invalid_sex"}}
   *   egfr は小数第1位で四捨五入した表示用の値(mL/分/1.73m²)、egfrRaw は丸める前の値。
   *   stage は小数第2位まで考慮して判定したGFR区分。
   */
  function calculate(crMgDl, age, sex) {
    if (!isFiniteNumber(crMgDl) || crMgDl < CR_MIN || crMgDl > CR_MAX) {
      return { ok: false, code: "invalid_cr" };
    }
    if (!isFiniteNumber(age) || age < AGE_MIN || age > AGE_MAX) {
      return { ok: false, code: "invalid_age" };
    }
    if (sex !== "male" && sex !== "female") {
      return { ok: false, code: "invalid_sex" };
    }
    var raw = COEF * Math.pow(crMgDl, CR_EXP) * Math.pow(age, AGE_EXP);
    if (sex === "female") raw *= FEMALE_FACTOR;
    return {
      ok: true,
      egfr: round(raw, 1),
      egfrRaw: raw,
      stage: stageOf(raw)
    };
  }

  /**
   * ある年齢・性別で、指定したGFR区分の境界に当たる血清クレアチニン値を逆算する。
   * eGFR = 194 × Cr^(-1.094) × 年齢^(-0.287) × 係数 を Cr について解く。
   * @param {number} targetEgfr 目標のeGFR(mL/分/1.73m²。1〜300)
   * @param {number} age 年齢(歳。18〜120)
   * @param {string} sex "male" または "female"
   * @returns {{ok:true, crMgDl:number}|{ok:false, code:"invalid_egfr"|"invalid_age"|"invalid_sex"}}
   *   crMgDl は小数第2位で四捨五入した血清クレアチニン値(mg/dL)。
   */
  function creatinineFor(targetEgfr, age, sex) {
    if (!isFiniteNumber(targetEgfr) || targetEgfr < 1 || targetEgfr > 300) {
      return { ok: false, code: "invalid_egfr" };
    }
    if (!isFiniteNumber(age) || age < AGE_MIN || age > AGE_MAX) {
      return { ok: false, code: "invalid_age" };
    }
    if (sex !== "male" && sex !== "female") {
      return { ok: false, code: "invalid_sex" };
    }
    var factor = COEF * Math.pow(age, AGE_EXP) * (sex === "female" ? FEMALE_FACTOR : 1);
    var cr = Math.pow(targetEgfr / factor, 1 / CR_EXP);
    return { ok: true, crMgDl: round(cr, 2) };
  }

  var api = {
    calculate: calculate,
    stageOf: stageOf,
    creatinineFor: creatinineFor
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.EgfrCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
