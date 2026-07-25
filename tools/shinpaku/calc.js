/*
 * 目標心拍数計算ロジック(カルボーネン法)
 *
 * 計算方法:
 * - 最大心拍数の推定 = 220 − 年齢
 * - 予備心拍数 = 最大心拍数 − 安静時心拍数
 * - 目標心拍数 = 予備心拍数 × 運動強度(%) + 安静時心拍数(カルボーネン法)
 * - 強度40〜60%が健康づくり・脂肪燃焼の目安、60〜70%が持久力向上の目安
 */
(function (global) {
  "use strict";

  /**
   * 目標心拍数ゾーンを計算する。
   * @param {number} age 年齢(15〜100)
   * @param {number} restHr 安静時心拍数(30〜120拍/分)
   * @returns {{ok: true, maxHr: number, reserve: number,
   *            z40: number, z50: number, z60: number, z70: number}
   *          |{ok: false, code: string}}  code: "invalid_age" | "invalid_rest"
   */
  function zones(age, restHr) {
    if (typeof age !== "number" || !isFinite(age) || age < 15 || age > 100) {
      return { ok: false, code: "invalid_age" };
    }
    if (typeof restHr !== "number" || !isFinite(restHr) || restHr < 30 || restHr > 120) {
      return { ok: false, code: "invalid_rest" };
    }
    var max = 220 - age;
    var reserve = max - restHr;
    function z(p) { return Math.round(reserve * p + restHr); }
    return { ok: true, maxHr: Math.round(max), reserve: Math.round(reserve),
      z40: z(0.4), z50: z(0.5), z60: z(0.6), z70: z(0.7) };
  }

  /**
   * 最大心拍数(220−年齢)に対する割合で、目的別の5ゾーン一覧を計算する。
   * ゾーン境界は最大心拍数の50/60/70/80/90/100%(スマートウォッチ等で使われる一般的な5ゾーンモデル)。
   * 心拍数は四捨五入で整数に丸める。
   * @param {number} age 年齢(15〜100)
   * @returns {{ok:true, maxHr:number, zones:Array<{no:number, label:string, pct:string, lo:number, hi:number}>}
   *          |{ok:false, code:string}}  code: "invalid_age"
   */
  function fiveZones(age) {
    if (typeof age !== "number" || !isFinite(age) || age < 15 || age > 100) {
      return { ok: false, code: "invalid_age" };
    }
    var max = 220 - age;
    var defs = [
      { no: 1, label: "回復(とても楽)", p1: 0.5, p2: 0.6 },
      { no: 2, label: "脂肪燃焼(楽)", p1: 0.6, p2: 0.7 },
      { no: 3, label: "持久力(ややきつい)", p1: 0.7, p2: 0.8 },
      { no: 4, label: "乳酸性作業閾値(きつい)", p1: 0.8, p2: 0.9 },
      { no: 5, label: "最大強度(非常にきつい)", p1: 0.9, p2: 1.0 }
    ];
    var zones = [];
    for (var i = 0; i < defs.length; i++) {
      var d = defs[i];
      zones.push({
        no: d.no,
        label: d.label,
        pct: Math.round(d.p1 * 100) + "〜" + Math.round(d.p2 * 100) + "%",
        lo: Math.round(max * d.p1),
        hi: Math.round(max * d.p2)
      });
    }
    return { ok: true, maxHr: Math.round(max), zones: zones };
  }

  /**
   * 運動中に10秒間数えた脈拍から、1分あたりの心拍数と運動強度(カルボーネン法)を判定する。
   * 強度% = (心拍数 − 安静時心拍数) ÷ (最大心拍数 − 安静時心拍数) × 100(四捨五入、下限0%)。
   * @param {number} age 年齢(15〜100)
   * @param {number} restHr 安静時心拍数(30〜120拍/分)
   * @param {number} count10s 10秒間に数えた脈拍数(5〜40)
   * @returns {{ok:true, bpm:number, pct:number, label:string}
   *          |{ok:false, code:string}}  code: "invalid_age"|"invalid_rest"|"invalid_pulse"
   */
  function pulseCheck(age, restHr, count10s) {
    if (typeof age !== "number" || !isFinite(age) || age < 15 || age > 100) {
      return { ok: false, code: "invalid_age" };
    }
    if (typeof restHr !== "number" || !isFinite(restHr) || restHr < 30 || restHr > 120) {
      return { ok: false, code: "invalid_rest" };
    }
    if (typeof count10s !== "number" || !isFinite(count10s) || count10s < 5 || count10s > 40) {
      return { ok: false, code: "invalid_pulse" };
    }
    var bpm = Math.round(count10s * 6);
    var max = 220 - age;
    var pct = Math.max(0, Math.round(((bpm - restHr) / (max - restHr)) * 100));
    var label;
    if (pct < 40) label = "楽(準備運動の範囲)";
    else if (pct < 60) label = "健康づくり・脂肪燃焼の強度";
    else if (pct < 70) label = "持久力向上の強度(ややきつい)";
    else if (pct < 90) label = "高強度(きつい)";
    else label = "ほぼ全力(長くは続けられない強度)";
    return { ok: true, bpm: bpm, pct: pct, label: label };
  }

  var api = {
    pulseCheck: pulseCheck,
    fiveZones: fiveZones, zones: zones };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.ShinpakuCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
