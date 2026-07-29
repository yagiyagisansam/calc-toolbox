/*
 * HbA1c ⇔ 推定平均血糖値(eAG)の換算ロジック
 *
 * 根拠(一次情報):
 * - Nathan DM, Kuenen J, Borg R, Zheng H, Schoenfeld D, Heine RJ; A1c-Derived Average Glucose (ADAG)
 *   Study Group.「Translating the A1C assay into estimated average glucose values」
 *   Diabetes Care. 2008 Aug;31(8):1473-8. doi:10.2337/dc08-0545 / PMID: 18540046
 *   https://pubmed.ncbi.nlm.nih.gov/18540046/ (2026年7月29日参照)
 *   報告された回帰式: AG(mg/dl) = 28.7 × A1C − 46.7 (R² = 0.84, P < 0.0001)
 *                     AG(mmol/l) = 1.59 × A1C − 2.59
 * - 日本糖尿病学会「日常臨床及び特定健診・保健指導におけるHbA1c国際標準化(NGSP値)」
 *   https://www.jds.or.jp/uploads/files/document/HbA1c_basicpolicy,signage-guideline.pdf
 *   (2026年7月29日参照) 2012年4月1日から日常臨床でもNGSP値を使用
 *
 * 前提:
 * - HbA1cは NGSP値(%)。日本の健診・臨床では2012年4月からNGSP値で報告されている
 * - eAG は過去1〜2か月の平均血糖の推定値。特定の時刻の血糖値ではない
 * - 貧血・腎不全・異常ヘモグロビン症・輸血後などではHbA1cが実際の血糖を反映しない
 * - mg/dL と mmol/L は原著が別々に示した回帰式で計算する(単位換算ではない)ため、
 *   互いに厳密な換算関係にはならない
 * - 表示用の丸めは mg/dL が小数第1位、mmol/L が小数第2位、HbA1c が小数第1位
 */
(function (global) {
  "use strict";

  var A1C_MIN = 4;
  var A1C_MAX = 20;
  var EAG_MIN = 68; // A1C 4.0% に相当する eAG(68.1 mg/dL)を下回る値は換算対象外
  var EAG_MAX = 528; // A1C 20.0% に相当する eAG(527.3 mg/dL)

  var MGDL_SLOPE = 28.7;
  var MGDL_INTERCEPT = 46.7;
  var MMOL_SLOPE = 1.59;
  var MMOL_INTERCEPT = 2.59;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round(v, digits) {
    var f = Math.pow(10, digits);
    return Math.round(v * f) / f;
  }

  /**
   * HbA1c(NGSP値)から推定平均血糖値(eAG)を求める。
   * @param {number} a1cPercent HbA1c(NGSP値・%。4〜20)
   * @returns {{ok:true, eagMgDl:number, eagMmolL:number, a1c:number}
   *          |{ok:false, code:"invalid_a1c"}}
   *   eagMgDl は 28.7 × A1C − 46.7 を小数第1位で四捨五入した値(mg/dL)、
   *   eagMmolL は 1.59 × A1C − 2.59 を小数第2位で四捨五入した値(mmol/L)。
   */
  function toEag(a1cPercent) {
    if (!isFiniteNumber(a1cPercent) || a1cPercent < A1C_MIN || a1cPercent > A1C_MAX) {
      return { ok: false, code: "invalid_a1c" };
    }
    return {
      ok: true,
      a1c: round(a1cPercent, 1),
      eagMgDl: round(MGDL_SLOPE * a1cPercent - MGDL_INTERCEPT, 1),
      eagMmolL: round(MMOL_SLOPE * a1cPercent - MMOL_INTERCEPT, 2)
    };
  }

  /**
   * 推定平均血糖値(mg/dL)からHbA1c(NGSP値)を逆算する。
   * @param {number} eagMgDl 推定平均血糖値(mg/dL。68〜528)
   * @returns {{ok:true, a1c:number, eagMgDl:number}
   *          |{ok:false, code:"invalid_eag"}}
   *   a1c は (eAG + 46.7) ÷ 28.7 を小数第1位で四捨五入した値(%)。
   */
  function fromEag(eagMgDl) {
    if (!isFiniteNumber(eagMgDl) || eagMgDl < EAG_MIN || eagMgDl > EAG_MAX) {
      return { ok: false, code: "invalid_eag" };
    }
    return {
      ok: true,
      eagMgDl: round(eagMgDl, 1),
      a1c: round((eagMgDl + MGDL_INTERCEPT) / MGDL_SLOPE, 1)
    };
  }

  /**
   * HbA1cの範囲を指定して換算表を作る。
   * @param {number} fromPercent 開始のHbA1c(%。4〜20)
   * @param {number} toPercent 終了のHbA1c(%。4〜20。fromPercent以上)
   * @param {number} stepPercent 刻み幅(%。0.1〜5)
   * @returns {{ok:true, rows:Array<{a1c:number, eagMgDl:number, eagMmolL:number}>}
   *          |{ok:false, code:"invalid_from"|"invalid_to"|"invalid_step"|"invalid_range"}}
   *   rows は最大200行まで。
   */
  function table(fromPercent, toPercent, stepPercent) {
    if (!isFiniteNumber(fromPercent) || fromPercent < A1C_MIN || fromPercent > A1C_MAX) {
      return { ok: false, code: "invalid_from" };
    }
    if (!isFiniteNumber(toPercent) || toPercent < A1C_MIN || toPercent > A1C_MAX) {
      return { ok: false, code: "invalid_to" };
    }
    if (!isFiniteNumber(stepPercent) || stepPercent < 0.1 || stepPercent > 5) {
      return { ok: false, code: "invalid_step" };
    }
    if (toPercent < fromPercent) return { ok: false, code: "invalid_range" };

    var rows = [];
    var steps = Math.floor(round((toPercent - fromPercent) / stepPercent, 6));
    if (steps > 199) steps = 199;
    for (var i = 0; i <= steps; i++) {
      var a1c = round(fromPercent + stepPercent * i, 2);
      var r = toEag(a1c);
      if (!r.ok) break;
      rows.push({ a1c: r.a1c, eagMgDl: r.eagMgDl, eagMmolL: r.eagMmolL });
    }
    return { ok: true, rows: rows };
  }

  var api = {
    toEag: toEag,
    fromEag: fromEag,
    table: table
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.KettouHeikinCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
