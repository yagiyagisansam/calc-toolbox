/*
 * 身長フィート・インチ換算ロジック
 *
 * 計算方法(定義値):
 * - 1インチ = 2.54cm、1フィート = 12インチ = 30.48cm
 * - cm→フィート表記: インチに直してから12で割り、余りのインチは四捨五入
 *   (四捨五入で12インチになったらフィートへ繰り上げ)
 * - フィート表記→cm: (フィート×12+インチ)×2.54(小数第2位で四捨五入)
 */
(function (global) {
  "use strict";

  var INCH_CM = 2.54;

  function round2(x) { return Math.round(x * 100) / 100; }

  /**
   * cm をフィート・インチ表記に換算する。
   * @param {number} cm 身長(cm)
   * @returns {{ok: true, feet: number, inches: number, totalInches: number}
   *          |{ok: false, code: string}}
   *   inches: 表記用に四捨五入したインチ / totalInches: 換算値そのもの(小数2位)
   */
  function toFeet(cm) {
    if (typeof cm !== "number" || !isFinite(cm) || cm < 30 || cm > 300) {
      return { ok: false, code: "invalid_cm" };
    }
    var inch = cm / INCH_CM;
    var feet = Math.floor(inch / 12);
    var rem = Math.round(inch - feet * 12);
    if (rem === 12) { feet++; rem = 0; }
    return { ok: true, feet: feet, inches: rem, totalInches: round2(inch) };
  }

  /**
   * フィート・インチを cm に換算する。
   */
  function toCm(feet, inches) {
    if (typeof feet !== "number" || !isFinite(feet) || feet !== Math.floor(feet) || feet < 1 || feet > 9) {
      return { ok: false, code: "invalid_feet" };
    }
    if (typeof inches !== "number" || !isFinite(inches) || inches < 0 || inches >= 12) {
      return { ok: false, code: "invalid_inches" };
    }
    return { ok: true, cm: round2((feet * 12 + inches) * INCH_CM) };
  }

  /**
   * 入力値を中心に±5cm(1cm刻み)のフィート・インチ早見表を作る。
   * 換算は toFeet と同じ方式(1インチ=2.54cm、余りインチは四捨五入・12で繰り上げ)。
   * 範囲外(30cm未満・300cm超)になる行は表から除外する。
   * @param {number} cm 中心となる身長(cm、30〜300)
   * @returns {{ok:true, center:number, rows:Array<{cm:number, feet:number, inches:number}>}
   *          |{ok:false, code:string}}  code: "invalid_cm"
   */
  function heightTable(cm) {
    if (typeof cm !== "number" || !isFinite(cm) || cm < 30 || cm > 300) {
      return { ok: false, code: "invalid_cm" };
    }
    var rows = [];
    for (var d = -5; d <= 5; d++) {
      var c = Math.round((cm + d) * 100) / 100;
      if (c < 30 || c > 300) continue;
      var r = toFeet(c);
      if (!r.ok) continue;
      rows.push({ cm: c, feet: r.feet, inches: r.inches });
    }
    return { ok: true, center: cm, rows: rows };
  }

  /**
   * 指定したフィートについて、0〜11インチの各表記をcmに換算した早見表を作る。
   * 換算は toCm と同じ((フィート×12+インチ)×2.54、小数第2位で四捨五入)。
   * @param {number} feet フィート(整数、1〜9)
   * @returns {{ok:true, feet:number, rows:Array<{inches:number, cm:number}>}
   *          |{ok:false, code:string}}  code: "invalid_feet"
   */
  function feetTable(feet) {
    if (typeof feet !== "number" || !isFinite(feet) || feet !== Math.floor(feet) || feet < 1 || feet > 9) {
      return { ok: false, code: "invalid_feet" };
    }
    var rows = [];
    for (var i = 0; i <= 11; i++) {
      rows.push({ inches: i, cm: round2((feet * 12 + i) * INCH_CM) });
    }
    return { ok: true, feet: feet, rows: rows };
  }

  var api = {
    feetTable: feetTable,
    heightTable: heightTable, toFeet: toFeet, toCm: toCm, INCH_CM: INCH_CM };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; }
  else { global.ShinchoCalc = api; }
})(typeof window !== "undefined" ? window : globalThis);
