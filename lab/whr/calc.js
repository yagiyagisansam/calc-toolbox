/*
 * ウエストヒップ比(WHR: waist–hip ratio)の計算ロジック
 *
 * 根拠(一次情報):
 * - WHO『Waist circumference and waist–hip ratio: Report of a WHO expert consultation,
 *   Geneva, 8–11 December 2008』(2011年発行)
 *   https://www.who.int/publications/i/item/9789241501491 (2026年7月29日参照)
 *   Annex A / Table A1 "World Health Organization cut-off points and risk of metabolic
 *   complications" より:
 *     Waist circumference  >94 cm (M) / >80 cm (W)  → Increased
 *     Waist circumference  >102 cm (M) / >88 cm (W) → Substantially increased
 *     Waist–hip ratio      ≥0.90 (M) / ≥0.85 (W)    → Substantially increased
 *   (WHRの基準はWHO 1999年の糖尿病報告書におけるメタボリックシンドロームの
 *    「腹部肥満」の定義に由来する)
 *
 * 前提:
 * - WHRは腹囲(ウエスト周囲径)÷腰囲(ヒップ周囲径)。単位は揃っていれば cm でも inch でもよい
 * - 上記のカットオフ値は主にヨーロッパ系集団を基準としたもの。同報告書は
 *   アジア系ではより低い値(例: 男0.90/女0.80)を示した研究があることにも触れている
 * - 丸め: WHRは小数第2位まで四捨五入し、丸めた値で判定する
 * - これは統計的なリスク区分であり、医学的な診断ではない
 */
(function (global) {
  "use strict";

  var MIN_CM = 30;
  var MAX_CM = 250;

  // WHRのカットオフ(この値以上で腹部肥満)
  var WHR_CUTOFF = { male: 0.90, female: 0.85 };
  // 腹囲のカットオフ [増加, 著しく増加]
  var WAIST_CUTOFF = { male: [94, 102], female: [80, 88] };

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  /**
   * ウエストヒップ比(WHR)を計算し、WHOの基準で腹部肥満かどうかを判定する。
   * @param {"male"|"female"} sex 性別
   * @param {number} waistCm ウエスト周囲径(cm。30〜250)
   * @param {number} hipCm ヒップ周囲径(cm。30〜250)
   * @returns {{ok:true, whr:number, cutoff:number, category:string, isAbdominalObesity:boolean}
   *          |{ok:false, code:"invalid_sex"|"invalid_waist"|"invalid_hip"}}
   *   whr: 小数第2位まで四捨五入した比 / cutoff: 適用した基準値
   *   category: "腹部肥満"(基準値以上) / "基準内"
   */
  function calculate(sex, waistCm, hipCm) {
    if (sex !== "male" && sex !== "female") return { ok: false, code: "invalid_sex" };
    if (!isFiniteNumber(waistCm) || waistCm < MIN_CM || waistCm > MAX_CM) {
      return { ok: false, code: "invalid_waist" };
    }
    if (!isFiniteNumber(hipCm) || hipCm < MIN_CM || hipCm > MAX_CM) {
      return { ok: false, code: "invalid_hip" };
    }
    var whr = round2(waistCm / hipCm);
    var cutoff = WHR_CUTOFF[sex];
    var obese = whr >= cutoff;
    return {
      ok: true,
      whr: whr,
      cutoff: cutoff,
      category: obese ? "腹部肥満" : "基準内",
      isAbdominalObesity: obese
    };
  }

  /**
   * 腹囲だけからWHOのリスク区分を判定する。
   * @param {"male"|"female"} sex 性別
   * @param {number} waistCm ウエスト周囲径(cm。30〜250)
   * @returns {{ok:true, category:string, level:0|1|2, increasedFromCm:number,
   *            substantialFromCm:number}
   *          |{ok:false, code:"invalid_sex"|"invalid_waist"}}
   *   level: 0=基準内 / 1=リスク増加 / 2=リスクが著しく増加
   */
  function waistRisk(sex, waistCm) {
    if (sex !== "male" && sex !== "female") return { ok: false, code: "invalid_sex" };
    if (!isFiniteNumber(waistCm) || waistCm < MIN_CM || waistCm > MAX_CM) {
      return { ok: false, code: "invalid_waist" };
    }
    var c = WAIST_CUTOFF[sex];
    var level = waistCm > c[1] ? 2 : (waistCm > c[0] ? 1 : 0);
    return {
      ok: true,
      level: level,
      category: level === 2 ? "リスクが著しく増加" : (level === 1 ? "リスク増加" : "基準内"),
      increasedFromCm: c[0],
      substantialFromCm: c[1]
    };
  }

  /**
   * 腹部肥満の境界となるヒップ周囲径(このヒップ以下だと腹部肥満になる)を返す。
   * @param {"male"|"female"} sex 性別
   * @param {number} waistCm ウエスト周囲径(cm)
   * @returns {{ok:true, cutoff:number, hipLimitCm:number}|{ok:false, code:string}}
   *   hipLimitCm: ウエストを保ったままなら、この値以下のヒップで腹部肥満になる(小数第1位)
   */
  function hipLimit(sex, waistCm) {
    if (sex !== "male" && sex !== "female") return { ok: false, code: "invalid_sex" };
    if (!isFiniteNumber(waistCm) || waistCm < MIN_CM || waistCm > MAX_CM) {
      return { ok: false, code: "invalid_waist" };
    }
    var cutoff = WHR_CUTOFF[sex];
    return { ok: true, cutoff: cutoff, hipLimitCm: Math.round((waistCm / cutoff) * 10) / 10 };
  }

  var api = {
    calculate: calculate,
    waistRisk: waistRisk,
    hipLimit: hipLimit
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.WhrCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
