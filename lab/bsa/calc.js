/*
 * 体表面積(BSA)の計算ロジック
 *
 * 根拠(一次情報):
 * - 日本臨床腫瘍研究グループ(JCOG)「体表面積、Ccr計算」
 *   藤本式: BSA = W^0.444 × H^0.663 × 0.008883
 *   DuBois式: BSA = W^0.425 × H^0.725 × 0.007184
 *   (W は体重kg、H は身長cm、BSA の単位は m²)
 *   https://jcog.jp/doctor/tool/calc/ (2026年7月29日参照)
 * - JCOG「体表面積表(藤本式)」
 *   https://jcog.jp/C_150_0030_01.pdf (2026年7月29日参照)
 *
 * 出典に示された原著:
 * - 藤本薫喜ほか「日本人の体表面積に関する研究 第18篇 三期にまとめた算出式」日衛誌23(5), 443-450, 1968年
 * - DuBois D, DuBois EF. Arch Intern Med 1916;17:863-71.
 *
 * 前提:
 * - 藤本式は日本人の実測値をもとにした式、DuBois式は欧米で広く使われる式
 * - 抗がん剤などの投与量計算に使われるが、実際の投与量は医師が決める。本ツールは目安のみ
 * - 妊娠中・浮腫がある場合・極端な肥満/痩せでは実際の体表面積とずれる
 * - 計算結果は小数第4位で四捨五入する(臨床では小数第2位まで使うことが多い)
 */
(function (global) {
  "use strict";

  var HEIGHT_MIN = 30;
  var HEIGHT_MAX = 250;
  var WEIGHT_MIN = 1;
  var WEIGHT_MAX = 300;

  var FORMULAS = {
    fujimoto: { coef: 0.008883, hExp: 0.663, wExp: 0.444 },
    dubois: { coef: 0.007184, hExp: 0.725, wExp: 0.425 }
  };

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round(v, digits) {
    var f = Math.pow(10, digits);
    return Math.round(v * f) / f;
  }

  /**
   * 身長と体重から体表面積(BSA)を計算する。
   * @param {number} heightCm 身長(cm。30〜250)
   * @param {number} weightKg 体重(kg。1〜300)
   * @param {string} formula 計算式。"fujimoto"(藤本式) または "dubois"(DuBois式)。省略時は藤本式
   * @returns {{ok:true, bsa:number, bsaRaw:number, formula:"fujimoto"|"dubois"}
   *          |{ok:false, code:"invalid_height"|"invalid_weight"|"invalid_formula"}}
   *   bsa は小数第4位で四捨五入した体表面積(m²)、bsaRaw は丸める前の値。
   */
  function calculate(heightCm, weightKg, formula) {
    if (!isFiniteNumber(heightCm) || heightCm < HEIGHT_MIN || heightCm > HEIGHT_MAX) {
      return { ok: false, code: "invalid_height" };
    }
    if (!isFiniteNumber(weightKg) || weightKg < WEIGHT_MIN || weightKg > WEIGHT_MAX) {
      return { ok: false, code: "invalid_weight" };
    }
    if (formula === undefined) formula = "fujimoto";
    var f = FORMULAS[formula];
    if (!f) return { ok: false, code: "invalid_formula" };

    var raw = f.coef * Math.pow(heightCm, f.hExp) * Math.pow(weightKg, f.wExp);
    return { ok: true, bsa: round(raw, 4), bsaRaw: raw, formula: formula };
  }

  /**
   * 藤本式とDuBois式の両方をまとめて計算する。
   * @param {number} heightCm 身長(cm。30〜250)
   * @param {number} weightKg 体重(kg。1〜300)
   * @returns {{ok:true, fujimoto:number, dubois:number, diff:number}
   *          |{ok:false, code:"invalid_height"|"invalid_weight"}}
   *   diff は「DuBois式 − 藤本式」の差(m²・小数第4位で四捨五入)。
   */
  function both(heightCm, weightKg) {
    var a = calculate(heightCm, weightKg, "fujimoto");
    if (!a.ok) return a;
    var b = calculate(heightCm, weightKg, "dubois");
    if (!b.ok) return b;
    return {
      ok: true,
      fujimoto: a.bsa,
      dubois: b.bsa,
      diff: round(b.bsaRaw - a.bsaRaw, 4)
    };
  }

  /**
   * 体表面積あたりの投与量から、必要量の目安を求める。
   * @param {number} heightCm 身長(cm。30〜250)
   * @param {number} weightKg 体重(kg。1〜300)
   * @param {number} dosePerM2 体表面積1m²あたりの投与量(mg/m² など。0より大きい値)
   * @param {string} formula "fujimoto" または "dubois"。省略時は藤本式
   * @returns {{ok:true, bsa:number, dose:number}
   *          |{ok:false, code:"invalid_height"|"invalid_weight"|"invalid_formula"|"invalid_dose"}}
   *   dose は「体表面積 × 1m²あたりの投与量」を小数第2位で四捨五入した値。医師の指示が優先される目安。
   */
  function doseFromBsa(heightCm, weightKg, dosePerM2, formula) {
    var r = calculate(heightCm, weightKg, formula);
    if (!r.ok) return r;
    if (!isFiniteNumber(dosePerM2) || dosePerM2 <= 0 || dosePerM2 > 1000000) {
      return { ok: false, code: "invalid_dose" };
    }
    return { ok: true, bsa: r.bsa, dose: round(r.bsaRaw * dosePerM2, 2) };
  }

  var api = {
    calculate: calculate,
    both: both,
    doseFromBsa: doseFromBsa
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.BsaCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
