/*
 * 自転車のギア比・速度・ケイデンス 計算ロジック
 *
 * 根拠:
 * - 「ギア比とケイデンスと速度の関係」(若狭路サイクリング)
 *   https://wakasaji-rhc.com/572/ (2026年7月29日参照)
 *   ギア比 = フロント(チェーンリング)の歯数 ÷ リア(スプロケット)の歯数。例: 50T ÷ 25T = 2.0
 *   速度 = ギア比 × ケイデンス × タイヤの周長 × 60
 *   同ページの計算例(タイヤ周長2,100mm):
 *     ギア比2.0 × ケイデンス80rpm × 2.1m × 60分 = 時速20.16km
 *     ギア比3.0 × ケイデンス90rpm × 2.1m × 60分 = 時速34.02km
 *   本ロジックも同じ値になる。
 *
 * 前提と定義:
 * - 速度(km/h)= ギア比 × ケイデンス(rpm)× 周長(m)× 60 ÷ 1000。
 * - 展開長(m)= ギア比 × 周長(m)。クランク1回転で進む距離。
 * - ギアインチ = ギア比 × タイヤ外径(インチ)。外径は入力された周長から
 *   周長 ÷ 円周率 で求める(タイヤを真円とみなす幾何計算)。
 * - タイヤ周長の推定値 = 円周率 ×(リム径mm + タイヤ幅mm × 2)。
 *   ETRTO表記のリム径・タイヤ幅から求める幾何計算で、実測値とは数mm〜数十mm異なる。
 *   正確な周長は実測(タイヤに印を付けて1回転させた距離)を使うこと。
 * - チェーンやハブの滑り、空気圧・荷重によるタイヤのつぶれは考慮しない。
 */
(function (global) {
  "use strict";

  var MAX_TEETH = 200;
  var MAX_CIRCUMFERENCE_MM = 5000;
  var MAX_CADENCE = 300;
  var MAX_SPEED_KMH = 300;
  var MM_PER_INCH = 25.4;

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  /**
   * ギア比・速度・展開長・ギアインチを計算する。
   * @param {number} frontTeeth フロント(チェーンリング)の歯数(1〜200の整数)
   * @param {number} rearTeeth リア(スプロケット)の歯数(1〜200の整数)
   * @param {number} circumferenceMm タイヤの周長(mm。0より大きく5000以下)
   * @param {number} cadenceRpm ケイデンス(1分あたりのクランク回転数。0以上300以下)
   * @returns {{ok:true, ratio:number, speedKmh:number, developmentM:number, gearInch:number,
   *            wheelDiameterInch:number}
   *          |{ok:false, code:"invalid_front"|"invalid_rear"|"invalid_circumference"|"invalid_cadence"}}
   *   ratio は小数第3位、speedKmh・developmentM・gearInch・wheelDiameterInch は
   *   小数第2位で四捨五入する。
   */
  function calculate(frontTeeth, rearTeeth, circumferenceMm, cadenceRpm) {
    if (!isFiniteNumber(frontTeeth) || frontTeeth < 1 || frontTeeth > MAX_TEETH ||
        Math.floor(frontTeeth) !== frontTeeth) {
      return { ok: false, code: "invalid_front" };
    }
    if (!isFiniteNumber(rearTeeth) || rearTeeth < 1 || rearTeeth > MAX_TEETH ||
        Math.floor(rearTeeth) !== rearTeeth) {
      return { ok: false, code: "invalid_rear" };
    }
    if (!isFiniteNumber(circumferenceMm) || circumferenceMm <= 0 || circumferenceMm > MAX_CIRCUMFERENCE_MM) {
      return { ok: false, code: "invalid_circumference" };
    }
    if (!isFiniteNumber(cadenceRpm) || cadenceRpm < 0 || cadenceRpm > MAX_CADENCE) {
      return { ok: false, code: "invalid_cadence" };
    }
    var ratio = frontTeeth / rearTeeth;
    var circM = circumferenceMm / 1000;
    var speed = ratio * cadenceRpm * circM * 60 / 1000;
    var diameterInch = circumferenceMm / Math.PI / MM_PER_INCH;
    return {
      ok: true,
      ratio: Math.round(ratio * 1000) / 1000,
      speedKmh: Math.round(speed * 100) / 100,
      developmentM: Math.round(ratio * circM * 100) / 100,
      gearInch: Math.round(ratio * diameterInch * 100) / 100,
      wheelDiameterInch: Math.round(diameterInch * 100) / 100
    };
  }

  /**
   * 目標速度を出すのに必要なケイデンスを逆算する。
   * @param {number} frontTeeth フロントの歯数(1〜200の整数)
   * @param {number} rearTeeth リアの歯数(1〜200の整数)
   * @param {number} circumferenceMm タイヤの周長(mm。0より大きく5000以下)
   * @param {number} speedKmh 目標の速度(km/h。0以上300以下)
   * @returns {{ok:true, cadenceRpm:number}
   *          |{ok:false, code:"invalid_front"|"invalid_rear"|"invalid_circumference"|"invalid_speed"}}
   *   cadenceRpm は小数第1位で四捨五入。
   */
  function cadenceForSpeed(frontTeeth, rearTeeth, circumferenceMm, speedKmh) {
    var base = calculate(frontTeeth, rearTeeth, circumferenceMm, 0);
    if (!base.ok) return base;
    if (!isFiniteNumber(speedKmh) || speedKmh < 0 || speedKmh > MAX_SPEED_KMH) {
      return { ok: false, code: "invalid_speed" };
    }
    var ratio = frontTeeth / rearTeeth;
    var circM = circumferenceMm / 1000;
    var cadence = speedKmh * 1000 / (ratio * circM * 60);
    return { ok: true, cadenceRpm: Math.round(cadence * 10) / 10 };
  }

  /**
   * ETRTO表記のリム径とタイヤ幅からタイヤ周長を推定する(幾何計算)。
   * @param {number} rimDiameterMm リムのビード座径(mm。例: 700Cは622、26インチMTBは559)。1〜1000
   * @param {number} tireWidthMm タイヤの幅(mm。例: 25)。1〜200
   * @returns {{ok:true, circumferenceMm:number, outerDiameterMm:number}
   *          |{ok:false, code:"invalid_rim"|"invalid_width"}}
   *   周長 = 円周率 ×(リム径 + タイヤ幅 × 2)。1mm単位で四捨五入。
   *   タイヤを真円とみなした推定値のため、実測値とは異なる。
   */
  function circumferenceFromEtrto(rimDiameterMm, tireWidthMm) {
    if (!isFiniteNumber(rimDiameterMm) || rimDiameterMm < 1 || rimDiameterMm > 1000) {
      return { ok: false, code: "invalid_rim" };
    }
    if (!isFiniteNumber(tireWidthMm) || tireWidthMm < 1 || tireWidthMm > 200) {
      return { ok: false, code: "invalid_width" };
    }
    var outer = rimDiameterMm + tireWidthMm * 2;
    return {
      ok: true,
      circumferenceMm: Math.round(Math.PI * outer),
      outerDiameterMm: outer
    };
  }

  var api = {
    calculate: calculate,
    cadenceForSpeed: cadenceForSpeed,
    circumferenceFromEtrto: circumferenceFromEtrto
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.GearRatioCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
