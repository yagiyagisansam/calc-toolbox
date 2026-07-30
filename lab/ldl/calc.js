/*
 * LDLコレステロール計算(Friedewald式) 計算ロジック
 *
 * 根拠(一次情報):
 * - 日本動脈硬化学会「LDL-C計算ツール(Friedewald式)」
 *   https://www.j-athero.org/tools/ldl_calc_tool.html (2026年7月29日参照)
 * - 日本動脈硬化学会「脂質異常症診療のQ&A」
 *   https://www.j-athero.org/jp/publications/si_qanda/ (2026年7月29日参照)
 *   ・LDL-C は Friedewald の式(TC − HDL-C − TG/5)で計算する。
 *   ・この式は TG ≧ 400 mg/dL または随時(非空腹時)検体では使用できない。
 *   ・「空腹時」は10時間以上の絶食(水やお茶などカロリーのない水分は可)。
 *   ・TG ≧ 400 mg/dL や食後採血では non-HDL-C(= TC − HDL-C)か LDL-C 直接法を用いる。
 * - 日本動脈硬化学会「動脈硬化性疾患予防ガイドライン2022年版」の脂質異常症診断基準
 *   https://www.j-athero.org/jp/wp-content/uploads/publications/pdf/GL2022_s/02_230210.pdf
 *   (2026年7月29日参照)
 *   高LDL-C血症 140以上 / 境界域高LDL-C血症 120〜139
 *   低HDL-C血症 40未満
 *   高TG血症 空腹時150以上・随時175以上
 *   高non-HDL-C血症 170以上 / 境界域高non-HDL-C血症 150〜169
 *
 * 前提:
 * - 単位はすべて mg/dL。
 * - 診断基準はスクリーニングのための値であり、治療の目標値とは異なる。
 * - 計算結果は健診結果の読み方を補うためのもので、診断ではない。
 * - 計算値は小数第1位で四捨五入して返す。判定は表示と同じ丸め後の値で行う
 *   (丸め前の値で判定すると、表示値140.0なのに判定が境界域になる等のずれが生じるため)。
 */
(function (global) {
  "use strict";

  var TC_MIN = 50, TC_MAX = 1000;
  var HDL_MIN = 5, HDL_MAX = 200;
  var TG_MIN = 10, TG_MAX = 5000;
  var FRIEDEWALD_TG_LIMIT = 400; // この値以上ではFriedewald式を使えない

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round1(v) {
    return Math.round(v * 10) / 10;
  }

  function ldlCategory(ldl) {
    if (ldl >= 140) return "high";
    if (ldl >= 120) return "borderline";
    return "normal";
  }

  function nonHdlCategory(v) {
    if (v >= 170) return "high";
    if (v >= 150) return "borderline";
    return "normal";
  }

  function hdlCategory(v) {
    return v < 40 ? "low" : "normal";
  }

  function tgCategory(tg, fasting) {
    if (fasting) return tg >= 150 ? "high" : "normal";
    return tg >= 175 ? "high" : "normal";
  }

  /**
   * Friedewald式でLDLコレステロールとnon-HDLコレステロールを計算し、
   * 動脈硬化性疾患予防ガイドラインの診断基準で区分する。
   *   LDL-C = TC − HDL-C − TG/5   (空腹時採血かつ TG < 400 mg/dL のときだけ使える)
   *   non-HDL-C = TC − HDL-C      (採血条件を問わず計算できる)
   * @param {number} tc 総コレステロール TC(mg/dL、50以上1000以下)
   * @param {number} hdl HDLコレステロール HDL-C(mg/dL、5以上200以下)
   * @param {number} tg 中性脂肪 TG(mg/dL、10以上5000以下)
   * @param {boolean} [fasting=true] 10時間以上の絶食後(空腹時)の採血なら true、随時採血なら false
   * @returns {{ok:true, ldl:(number|null), ldlCategory:(string|null), nonHdl:number,
   *            nonHdlCategory:string, hdlCategory:string, tgCategory:string,
   *            friedewaldUsable:boolean, fasting:boolean, tgOver400:boolean}
   *          |{ok:false, code:"invalid_tc"|"invalid_hdl"|"invalid_tg"|"inconsistent_values"}}
   *   friedewaldUsable が false のとき ldl と ldlCategory は null になる。
   *   category は "high"|"borderline"|"normal"、HDLのみ "low"|"normal"。
   */
  function calculate(tc, hdl, tg, fasting) {
    if (fasting === undefined || fasting === null) fasting = true;
    if (!isFiniteNumber(tc) || tc < TC_MIN || tc > TC_MAX) {
      return { ok: false, code: "invalid_tc" };
    }
    if (!isFiniteNumber(hdl) || hdl < HDL_MIN || hdl > HDL_MAX) {
      return { ok: false, code: "invalid_hdl" };
    }
    if (!isFiniteNumber(tg) || tg < TG_MIN || tg > TG_MAX) {
      return { ok: false, code: "invalid_tg" };
    }
    // HDLがTC以上になることは通常ありえない(入力の取り違えを弾く)
    if (hdl >= tc) return { ok: false, code: "inconsistent_values" };

    var nonHdl = tc - hdl;
    var tgOver400 = tg >= FRIEDEWALD_TG_LIMIT;
    var usable = !!fasting && !tgOver400;

    var ldl = null;
    var ldlCat = null;
    if (usable) {
      var raw = tc - hdl - tg / 5;
      // 計算値がマイナスになる組み合わせは入力の誤りとみなす
      if (raw < 0) return { ok: false, code: "inconsistent_values" };
      ldl = round1(raw);
      ldlCat = ldlCategory(ldl);
    }

    return {
      ok: true,
      ldl: ldl,
      ldlCategory: ldlCat,
      nonHdl: round1(nonHdl),
      nonHdlCategory: nonHdlCategory(round1(nonHdl)),
      hdlCategory: hdlCategory(hdl),
      tgCategory: tgCategory(tg, fasting),
      friedewaldUsable: usable,
      fasting: !!fasting,
      tgOver400: tgOver400
    };
  }

  /**
   * mg/dL と mmol/L を相互に換算する(日本の健診はmg/dL表記)。
   * コレステロール(TC・LDL-C・HDL-C)は 1 mmol/L = 38.67 mg/dL、
   * 中性脂肪(TG)は 1 mmol/L = 88.57 mg/dL で換算する。
   * @param {number} value 換算する値
   * @param {string} kind "cholesterol"(TC/LDL/HDL) または "triglyceride"(TG)
   * @param {string} direction "toMmol"(mg/dL→mmol/L) または "toMgdl"(mmol/L→mg/dL)
   * @returns {{ok:true, value:number}|{ok:false, code:"invalid_value"|"invalid_kind"|"invalid_direction"}}
   *   mmol/Lは小数第2位、mg/dLは小数第1位で四捨五入する
   */
  function convertUnit(value, kind, direction) {
    if (!isFiniteNumber(value) || value < 0 || value > 100000) {
      return { ok: false, code: "invalid_value" };
    }
    var factor;
    if (kind === "cholesterol") factor = 38.67;
    else if (kind === "triglyceride") factor = 88.57;
    else return { ok: false, code: "invalid_kind" };

    if (direction === "toMmol") return { ok: true, value: Math.round(value / factor * 100) / 100 };
    if (direction === "toMgdl") return { ok: true, value: round1(value * factor) };
    return { ok: false, code: "invalid_direction" };
  }

  var api = {
    calculate: calculate,
    convertUnit: convertUnit,
    FRIEDEWALD_TG_LIMIT: FRIEDEWALD_TG_LIMIT
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.LdlCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
