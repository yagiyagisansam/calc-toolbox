/*
 * 坪・平方メートル・畳 変換ロジック
 *
 * 換算値の根拠(一次情報):
 * - 1坪 = 400/121 ㎡(約3.31㎡)。1尺=10/33mの定義から 1坪=(6尺)²=400/121㎡
 *   取引・証明への尺貫法の使用は計量法で禁止されており、坪表記は慣用的な参考値
 *   出典: 計量法(平成4年法律第51号) https://laws.e-gov.go.jp/law/404AC0000000051
 * - 畳1枚 = 1.62㎡(壁心面積ベースの下限基準)
 *   出典: 不動産公正取引協議会連合会「不動産の表示に関する公正競争規約施行規則」
 *   https://www.rftc.jp/koseikyosokiyaku/
 *
 * 前提:
 * - 畳の実寸は地域・種類(京間・中京間・江戸間・団地間)で異なるため、
 *   広告表示基準の1.62㎡/枚による概算
 */
(function (global) {
  "use strict";

  var VALUE_MIN = 0.01;
  var VALUE_MAX = 100000;
  var SQM_PER_TSUBO = 400 / 121;
  var SQM_PER_JO = 1.62;
  var UNITS = ["sqm", "tsubo", "jo"];

  function isFiniteNumber(v) {
    return typeof v === "number" && isFinite(v);
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  /**
   * 面積を3単位へ相互変換する。
   * @param {number} value 面積の値
   * @param {string} fromUnit "sqm"(㎡) | "tsubo"(坪) | "jo"(畳)
   * @returns {{ok: true, sqm: number, tsubo: number, jo: number}
   *          |{ok: false, code: string}}
   *   code: "invalid_value" | "invalid_unit"
   */
  function convert(value, fromUnit) {
    if (!isFiniteNumber(value) || value < VALUE_MIN || value > VALUE_MAX) {
      return { ok: false, code: "invalid_value" };
    }
    if (UNITS.indexOf(fromUnit) === -1) {
      return { ok: false, code: "invalid_unit" };
    }
    var sqm =
      fromUnit === "sqm" ? value :
      fromUnit === "tsubo" ? value * SQM_PER_TSUBO :
      value * SQM_PER_JO;
    return {
      ok: true,
      sqm: round2(sqm),
      tsubo: round2(sqm / SQM_PER_TSUBO),
      jo: round2(sqm / SQM_PER_JO)
    };
  }

  var api = {
    convert: convert,
    VALUE_MIN: VALUE_MIN,
    VALUE_MAX: VALUE_MAX,
    SQM_PER_TSUBO: SQM_PER_TSUBO,
    SQM_PER_JO: SQM_PER_JO
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    global.TsuboCalc = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
