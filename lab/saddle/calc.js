/*
 * 自転車のサドル高さ(股下からの目安)の計算ロジック
 *
 * 根拠:
 * - じてたん「自転車のフィッティング(ポジション出し・サイズ選び)」
 *   https://jitetan.com/bike_fit.html (2026年7月29日参照)
 *   ・サドル高 = 股下 × 0.885。C. Genzling が1978年のツール・ド・フランス出場選手を調査して
 *     導いた係数で、グレッグ・ルモンが広めたため「ルモン方式」とも呼ばれる
 *   ・求まるのは「BB芯(クランク軸の中心)からサドル上面まで、シートチューブに沿った距離」
 *   ・クランク長170mmを前提とした数値である
 *   ・算出値は「設定できる最高の高さ」になる傾向があり、まずここに合わせてから
 *     数ミリ〜10mm程度下げるのが安全
 *
 * 前提:
 * - クランク長が170mmでない場合の補正は、下死点でのペダル軸〜サドル上面の距離
 *  (= サドル高 + クランク長)を一定に保つという幾何的な考え方による。
 *   クランクが1mm長ければサドル高を1mm下げる。これは出典の数式そのものではなく、
 *   170mm前提という記述から導いた一般的な調整方法。
 * - 股下は素足で壁に背をつけて立ち、床から股までを測った値(cm)。
 * - 出る値はあくまで出発点。ペダル・シューズ・クリート・体の柔軟性で適正値は変わる。
 */
(function (global) {
  "use strict";

  var RATIO_LEMOND = 0.885;   // ルモン(Genzling)方式の係数
  var RATIO_MIN = 0.80;
  var RATIO_MAX = 0.95;
  var RATIO_LOW = 0.875;      // 低めに設定するときによく使われる係数
  var INSEAM_MIN = 50;        // 股下の下限(cm)
  var INSEAM_MAX = 110;       // 股下の上限(cm)
  var CRANK_BASE = 170;       // 係数の前提となるクランク長(mm)
  var CRANK_MIN = 140;
  var CRANK_MAX = 200;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /** 小数第d位に丸める */
  function round(v, d) {
    var f = Math.pow(10, d);
    return Math.round(v * f) / f;
  }

  /**
   * 股下と係数からサドル高(BB中心〜サドル上面)を求める。
   * サドル高(mm) = 股下(cm)× 係数 × 10 −(クランク長(mm) − 170)
   * 表示のぶれを防ぐため、mm は整数、cm は小数第1位に丸める。
   * @param {number} inseamCm 股下(cm、50〜110)
   * @param {number} [ratio=0.885] 掛ける係数(0.80〜0.95)。ルモン方式は0.885
   * @param {number} [crankMm=170] クランク長(mm、140〜200)
   * @returns {{ok:true, heightMm:number, heightCm:number, baseHeightMm:number,
   *            crankAdjustMm:number, pedalToSaddleMm:number, ratio:number, crankMm:number}
   *          |{ok:false, code:"invalid_inseam"|"invalid_ratio"|"invalid_crank"}}
   *   heightMm:        補正後のサドル高(BB中心〜サドル上面、mm)
   *   baseHeightMm:    クランク長補正をしない素の値(股下×係数、mm)
   *   crankAdjustMm:   クランク長による補正量(mm。負の値は下げる方向)
   *   pedalToSaddleMm: 下死点のペダル軸〜サドル上面の距離(mm) = サドル高 + クランク長
   */
  function saddleHeight(inseamCm, ratio, crankMm) {
    var r = ratio === undefined ? RATIO_LEMOND : ratio;
    var c = crankMm === undefined ? CRANK_BASE : crankMm;
    if (!isFiniteNumber(inseamCm) || inseamCm < INSEAM_MIN || inseamCm > INSEAM_MAX) {
      return { ok: false, code: "invalid_inseam" };
    }
    if (!isFiniteNumber(r) || r < RATIO_MIN || r > RATIO_MAX) {
      return { ok: false, code: "invalid_ratio" };
    }
    if (!isFiniteNumber(c) || c < CRANK_MIN || c > CRANK_MAX) {
      return { ok: false, code: "invalid_crank" };
    }
    var baseMm = inseamCm * r * 10;
    var adjust = -(c - CRANK_BASE);
    var heightMm = Math.round(baseMm + adjust);
    return {
      ok: true,
      heightMm: heightMm,
      heightCm: round(heightMm / 10, 1),
      baseHeightMm: Math.round(baseMm),
      crankAdjustMm: round(adjust, 1),
      pedalToSaddleMm: Math.round(heightMm + c),
      ratio: r,
      crankMm: c
    };
  }

  /**
   * よく使われる係数の幅(0.875〜0.885)でサドル高の範囲を出す。
   * 出典は「算出値は設定できる最高の高さになる傾向がある」としており、
   * 低いほうの値から試すのが安全であることを示すための範囲。
   * @param {number} inseamCm 股下(cm、50〜110)
   * @param {number} [crankMm=170] クランク長(mm、140〜200)
   * @returns {{ok:true, lowMm:number, highMm:number, lowRatio:number, highRatio:number}
   *          |{ok:false, code:"invalid_inseam"|"invalid_crank"}}
   */
  function heightRange(inseamCm, crankMm) {
    var low = saddleHeight(inseamCm, RATIO_LOW, crankMm);
    if (!low.ok) return low;
    var high = saddleHeight(inseamCm, RATIO_LEMOND, crankMm);
    if (!high.ok) return high;
    return {
      ok: true,
      lowMm: low.heightMm,
      highMm: high.heightMm,
      lowRatio: RATIO_LOW,
      highRatio: RATIO_LEMOND
    };
  }

  /**
   * いま設定しているサドル高が、股下の何倍にあたるかを逆算する。
   * クランク長の補正を戻したうえで係数に直す。
   * @param {number} inseamCm 股下(cm、50〜110)
   * @param {number} heightMm いまのサドル高(BB中心〜サドル上面、mm、300〜1000)
   * @param {number} [crankMm=170] クランク長(mm、140〜200)
   * @returns {{ok:true, ratio:number, diffFromLemondMm:number}
   *          |{ok:false, code:"invalid_inseam"|"invalid_height"|"invalid_crank"}}
   *   ratio: 換算した係数(小数第4位で丸め)
   *   diffFromLemondMm: ルモン方式(0.885)の値との差(mm、正なら今のほうが高い)
   */
  function ratioFromHeight(inseamCm, heightMm, crankMm) {
    var c = crankMm === undefined ? CRANK_BASE : crankMm;
    if (!isFiniteNumber(inseamCm) || inseamCm < INSEAM_MIN || inseamCm > INSEAM_MAX) {
      return { ok: false, code: "invalid_inseam" };
    }
    if (!isFiniteNumber(heightMm) || heightMm < 300 || heightMm > 1000) {
      return { ok: false, code: "invalid_height" };
    }
    if (!isFiniteNumber(c) || c < CRANK_MIN || c > CRANK_MAX) {
      return { ok: false, code: "invalid_crank" };
    }
    var baseMm = heightMm + (c - CRANK_BASE);
    var lemond = saddleHeight(inseamCm, RATIO_LEMOND, c);
    return {
      ok: true,
      ratio: round(baseMm / (inseamCm * 10), 4),
      diffFromLemondMm: Math.round(heightMm - lemond.heightMm)
    };
  }

  var api = {
    saddleHeight: saddleHeight,
    heightRange: heightRange,
    ratioFromHeight: ratioFromHeight,
    RATIO_LEMOND: RATIO_LEMOND,
    RATIO_LOW: RATIO_LOW,
    CRANK_BASE: CRANK_BASE
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.SaddleCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
